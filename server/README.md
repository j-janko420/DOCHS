# DOCHS API server

A Docker-based web API for DOCHS (DoorChisolution), with a secure multi-provider AI connector. Designed by i3 Design.

This server is optional. The DOCHS web app (`../dochs`) runs fully without it. When connected, the server adds AI-assisted features, which are reviewed by the user before they change any data.

## DOCHS integration

- **`POST /v1/dochs/suggest-mapping`**
  - Takes the column headers of an uploaded door schedule, plus up to 5 sample rows.
  - Returns a suggested DOCHS field for each column.
  - The model's answer is parsed and checked against the fixed field list in `app/dochs.py`, with one use per field. Unknown fields are dropped and listed in `notes`.
  - The web app checks the answer again, merges it with its own automatic matching, and shows it for review before import.
  - A DOCHS test keeps the field list identical to `dochs/src/core/importer.ts`.
- **Connecting the web app:** in DOCHS go to **Project data > AI server**, enter the server URL and token, then use **Test connection**. The token is stored only in that browser. Provider API keys never leave the server.
- **CORS:** set `ALLOWED_ORIGINS` to the web app's origin(s), e.g. `https://j-janko420.github.io`. Requests from other origins are refused by the browser.
- **Claude defaults:**
  - The default model is `claude-opus-5-5`.
  - `temperature` is rejected with a clear message for Anthropic, because current Claude models refuse sampling parameters.
  - A request declined by Claude's safety system comes back as HTTP 422 with the category. It is not returned as an empty answer.
  - On the first-party Claude API, declined requests are retried server-side on Anthropic's recommended fallback model (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Set `ANTHROPIC_FALLBACKS=false` to turn this off.

The environment variable `DORCHS_API_TOKEN` keeps its original name for compatibility with existing deployments.

## Included
- FastAPI service with `/health/live`, `/health/ready`, `/v1/providers`, `/v1/ai/chat` and `/v1/dochs/suggest-mapping`
- Provider adapters for Anthropic Claude, xAI Grok, and OpenAI-compatible APIs
- API keys supplied only through server-side environment variables
- Request validation, bounded request sizes, timeout handling, and sanitized provider errors
- Docker image, Compose configuration, non-root runtime, health check
- Unit tests for health, provider listing, request validation, and connector routing
- `.env.example`; no real credentials included

## Important scope
This is a deployable API foundation, not a complete CAD/drawing automation product. It does not yet extract PDF/CAD geometry or generate production-ready shop drawings. Those require separate, validated engineering modules. AI responses are untrusted suggestions and must not be treated as approved engineering data.

## Requirements
- Docker Engine and Docker Compose plugin
- API key for each provider you intend to use
- For local tests without Docker: Python 3.12+

## Run locally with Docker
1. Copy the sample environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and set a strong `DORCHS_API_TOKEN`. Add provider API keys only for providers you plan to use.
3. Build and start:
   ```bash
   docker compose up --build -d
   ```
4. Check service:
   ```bash
   curl http://localhost:8080/health/live
   curl http://localhost:8080/health/ready
   ```
5. Open API docs locally at `http://localhost:8080/docs`.

## Test
```bash
python -m venv .venv
# macOS/Linux:
. .venv/bin/activate
# Windows PowerShell:
# .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
```

Tests use mocked provider responses and do not need real API keys or internet access.

## Example request
```bash
curl -X POST http://localhost:8080/v1/ai/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DORCHS_API_TOKEN" \
  -d '{
    "provider": "anthropic",
    "model": "claude-opus-5-5",
    "messages": [{"role":"user","content":"Summarize these non-sensitive project notes."}],
    "max_tokens": 500
  }'
```
Replace the model with one available to your provider account. The API does not promise that a given model identifier will remain available.

## Providers
- `anthropic`: calls Anthropic Messages API.
- `xai`: calls xAI Chat Completions API.
- `openai_compatible`: calls a configurable OpenAI-compatible endpoint. Configure `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, and `OPENAI_COMPATIBLE_DEFAULT_MODEL`.

The `provider` field is explicit. This avoids hidden provider routing and makes billing predictable.

## Cloud deployment checklist
1. Deploy to a supported Linux cloud VM or container service with Docker support.
2. Put the service behind a managed HTTPS reverse proxy/load balancer. Do not expose port 8080 directly to the public internet.
3. Set secrets in your cloud secret manager or deployment environment, not in source control.
4. Set `DORCHS_API_TOKEN` to a unique random secret of at least 32 characters.
5. Configure firewall rules to allow only the reverse proxy to reach the container.
6. Use a persistent log destination and set retention limits.
7. Configure TLS, monitoring, alerts, backups for future persistent services, and a patching schedule.
8. Run tests and a security review in staging before production.
9. Rotate secrets after suspected exposure and periodically according to your policy.

Example token generation:
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## Configuration
See `.env.example`. The API refuses to start in production mode without a strong API token.

## Security notes
- Do not send credentials, private keys, or sensitive personal information to AI providers unless your organization has approved that data flow.
- The bearer token is a shared service token. For a multi-user commercial release, replace it with managed identity/OIDC, per-user authorization, tenant isolation, quotas, and audit logging.
- Provider output is untrusted. Never execute model-generated code or commands automatically.
- Set `TRUSTED_HOSTS` to your public domain(s) for deployment.
- Rate limiting at the ingress/API gateway is recommended; add distributed rate limiting before a public multi-tenant launch.
- The readiness endpoint reports configuration readiness, not that all providers are reachable.
