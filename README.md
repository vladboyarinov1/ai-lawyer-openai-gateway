# AI Lawyer OpenAI Gateway

OpenAI-compatible proxy for deploying outside the RU app perimeter.

## Purpose

This service accepts authenticated requests from `ai-lawyer-backend` and forwards a limited subset of the OpenAI API to the real upstream.

Supported routes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `POST /v1/responses`

Health endpoint:

- `GET /healthz`

## Environment

```env
PORT=8080
OPENAI_API_KEY=sk-...
AI_GATEWAY_TOKEN=replace-with-long-random-token
OPENAI_BASE_URL=https://api.openai.com
REQUEST_TIMEOUT_MS=125000
BODY_LIMIT=5mb
```

## Local run

```bash
npm install
npm start
```

## Railway

Deploy as a dedicated service and set a private random `AI_GATEWAY_TOKEN`.

Backend should point to it with:

```env
AI_GATEWAY_URL=https://your-gateway.up.railway.app
AI_GATEWAY_TOKEN=replace-with-the-same-token
```

## Security

- Do not expose this URL in the browser.
- Do not reuse `OPENAI_API_KEY` as the inbound gateway token.
- Rotate `AI_GATEWAY_TOKEN` independently from the OpenAI key.
