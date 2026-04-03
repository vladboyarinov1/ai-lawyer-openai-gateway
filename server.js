const crypto = require("node:crypto");
const express = require("express");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function readPositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name] ?? String(fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function extractBearerToken(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function safeTokenEquals(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

const PORT = readPositiveNumberEnv("PORT", 8080);
const REQUEST_TIMEOUT_MS = readPositiveNumberEnv("REQUEST_TIMEOUT_MS", 125000);
const BODY_LIMIT = process.env.BODY_LIMIT?.trim() || "5mb";
const OPENAI_BASE_URL = trimTrailingSlashes(
  process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com"
);
const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");
const AI_GATEWAY_TOKEN = requireEnv("AI_GATEWAY_TOKEN");

const ALLOWED_ROUTES = new Map([
  ["GET", new Set(["/models"])],
  ["POST", new Set(["/chat/completions", "/embeddings", "/responses"])],
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const app = express();
app.disable("x-powered-by");

app.get("/", (_req, res) => {
  res.json({
    service: "ai-lawyer-openai-gateway",
    status: "ok",
    openaiBaseUrl: OPENAI_BASE_URL,
  });
});

app.get("/healthz", (_req, res) => {
  res.json({
    service: "ai-lawyer-openai-gateway",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use("/v1", (req, res, next) => {
  const token = extractBearerToken(req.get("authorization"));
  if (!token || !safeTokenEquals(token, AI_GATEWAY_TOKEN)) {
    return res.status(401).json({ error: { message: "Unauthorized" } });
  }

  next();
});

app.use("/v1", express.raw({ type: "*/*", limit: BODY_LIMIT }));

app.use("/v1", async (req, res) => {
  const pathname = req.path || "/";
  const allowedForMethod = ALLOWED_ROUTES.get(req.method.toUpperCase());

  if (!allowedForMethod || !allowedForMethod.has(pathname)) {
    return res.status(404).json({
      error: {
        message: `Unsupported route: ${req.method.toUpperCase()} ${pathname}`,
      },
    });
  }

  const upstreamUrl = new URL(`/v1${pathname}`, OPENAI_BASE_URL);
  if (req.url.includes("?")) {
    upstreamUrl.search = req.url.slice(req.url.indexOf("?"));
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${OPENAI_API_KEY}`);

  const contentType = req.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const openAiOrganization = req.get("openai-organization");
  if (openAiOrganization) {
    headers.set("OpenAI-Organization", openAiOrganization);
  }

  const openAiProject = req.get("openai-project");
  if (openAiProject) {
    headers.set("OpenAI-Project", openAiProject);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD" || !req.body?.length
          ? undefined
          : req.body,
      signal: abortController.signal,
    });

    for (const [key, value] of upstreamResponse.headers) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        continue;
      }

      res.setHeader(key, value);
    }

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    res.status(upstreamResponse.status).send(payload);
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const status = isAbort ? 504 : 502;
    const message = isAbort
      ? `OpenAI upstream timed out after ${REQUEST_TIMEOUT_MS}ms`
      : error instanceof Error
        ? error.message
        : "OpenAI upstream request failed";

    res.status(status).json({
      error: {
        message,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[ai-lawyer-openai-gateway] listening on 0.0.0.0:${PORT} -> ${OPENAI_BASE_URL}`
  );
});
