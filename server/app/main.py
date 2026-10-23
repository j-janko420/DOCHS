import hmac
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from .config import get_settings, Settings
from .schemas import ChatRequest, ChatResponse
from .providers import ProviderRegistry, ProviderConfigurationError, ProviderRequestError

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger("dorchs")
settings.validate_security()

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.providers = ProviderRegistry(settings)
    yield

app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan, docs_url="/docs" if settings.app_env != "production" else None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts())

async def require_token(authorization: str | None = Header(default=None), cfg: Settings = Depends(get_settings)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    supplied = authorization[7:]
    if not hmac.compare_digest(supplied, cfg.dorchs_api_token):
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.get("/health/live")
async def live():
    return {"status": "alive"}

@app.get("/health/ready")
async def ready(request: Request):
    registry = getattr(request.app.state, "providers", None)
    return {"status": "ready" if registry else "starting", "provider_count": len(registry.providers) if registry else 0}

@app.get("/v1/providers", dependencies=[Depends(require_token)])
async def providers(request: Request):
    return {"providers": request.app.state.providers.configured()}

@app.post("/v1/ai/chat", response_model=ChatResponse, dependencies=[Depends(require_token)])
async def chat(body: ChatRequest, request: Request):
    cfg = get_settings()
    if sum(len(m.content) for m in body.messages) > cfg.max_input_chars:
        raise HTTPException(status_code=413, detail="Request content too large")
    if len(body.messages) > cfg.max_messages:
        raise HTTPException(status_code=422, detail="Too many messages")
    try:
        result = await request.app.state.providers.chat(body)
        return ChatResponse(provider=result.provider, model=result.model, text=result.text, usage=result.usage)
    except ProviderConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ProviderRequestError as exc:
        logger.warning("AI provider request failed: %s", str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
