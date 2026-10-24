import hmac
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Header, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from .config import get_settings, Settings
from .schemas import ChatRequest, ChatResponse, ExtractRequest, ExtractResponse, SuggestMappingRequest, SuggestMappingResponse
from .dochs import build_messages, clean_transcription, extract_instruction, parse_mapping
from fastapi.middleware.cors import CORSMiddleware
from .providers import ProviderRegistry, ProviderConfigurationError, ProviderInputError, ProviderRefusal, ProviderRequestError

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
# The DOCHS web app runs on another origin (e.g. GitHub Pages); allow only listed origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
    max_age=600,
)

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
    except (ProviderInputError, ProviderRefusal) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProviderRequestError as exc:
        logger.warning("AI provider request failed: %s", str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/dochs/suggest-mapping", response_model=SuggestMappingResponse, dependencies=[Depends(require_token)])
async def suggest_mapping(body: SuggestMappingRequest, request: Request):
    """Suggest DOCHS fields for the columns of an uploaded schedule (reviewed by the user)."""
    chat_request = ChatRequest(provider=body.provider, model=body.model, messages=build_messages(body.headers, body.samples), max_tokens=2000)
    try:
        result = await request.app.state.providers.chat(chat_request)
    except ProviderConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ProviderInputError, ProviderRefusal) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProviderRequestError as exc:
        logger.warning("AI provider request failed: %s", str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    mapping, notes = parse_mapping(result.text, len(body.headers))
    return SuggestMappingResponse(provider=result.provider, model=result.model, mapping=mapping, notes=notes)


@app.post("/v1/dochs/extract", response_model=ExtractResponse, dependencies=[Depends(require_token)])
async def extract(body: ExtractRequest, request: Request):
    """Transcribe a scanned PDF or image for new-project intake. The web app runs its own extraction and cross-checks on the text."""
    raw_len = len(body.data_base64) * 3 // 4
    if body.media_type != "application/pdf" and raw_len > 5_000_000:
        raise HTTPException(status_code=413, detail="Images are limited to 5 MB; reduce the resolution or upload a PDF")
    if raw_len > 15_000_000:
        raise HTTPException(status_code=413, detail="Files are limited to 15 MB")
    try:
        result = await request.app.state.providers.read_file(body.provider, body.model, body.media_type, body.data_base64, extract_instruction(body.role))
    except ProviderConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ProviderInputError, ProviderRefusal) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProviderRequestError as exc:
        logger.warning("AI provider request failed: %s", str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    text, notes = clean_transcription(result.text)
    return ExtractResponse(provider=result.provider, model=result.model, text=text, notes=notes)
