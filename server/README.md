# DORCHS Deployment Starter

Docker-based web API starter for DORCHS, with a secure, extensible multi-provider AI connector.

## Included
- FastAPI service with `/health/live`, `/health/ready`, `/v1/providers`, and `/v1/ai/chat`
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
    "model": "claude-sonnet-4-20250514",
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
