from dataclasses import dataclass
from typing import Any
import httpx
from .config import Settings
from .schemas import ChatRequest

class ProviderConfigurationError(Exception):
    pass

class ProviderRequestError(Exception):
    pass

class ProviderInputError(Exception):
    """The request is valid in general but not accepted by the chosen provider."""

class ProviderRefusal(Exception):
    """The provider's safety system declined the request (HTTP 200 with a refusal)."""

@dataclass
class ProviderResult:
    provider: str
    model: str
    text: str
    usage: dict[str, int]

class AIProvider:
    name: str
    def __init__(self, settings: Settings):
        self.settings = settings

    async def chat(self, request: ChatRequest) -> ProviderResult:
        raise NotImplementedError

    def _client(self, base_url: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(self.settings.provider_timeout_seconds),
            follow_redirects=False,
            headers={"User-Agent": "DORCHS/1.0"},
        )

    async def _post(self, url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict:
        try:
            async with self._client(url) as client:
                response = await client.post("", headers=headers, json=payload)
                if response.status_code >= 400:
                    # Do not pass upstream body back: it can contain sensitive provider details.
                    raise ProviderRequestError(f"Provider returned HTTP {response.status_code}")
                data = response.json()
                if not isinstance(data, dict):
                    raise ProviderRequestError("Provider returned an invalid response")
                return data
        except httpx.TimeoutException as exc:
            raise ProviderRequestError("Provider request timed out") from exc
        except httpx.RequestError as exc:
            raise ProviderRequestError("Could not connect to provider") from exc
        except ValueError as exc:
            raise ProviderRequestError("Provider returned invalid JSON") from exc

class AnthropicProvider(AIProvider):
    name = "anthropic"
    async def chat(self, request: ChatRequest) -> ProviderResult:
        key = self.settings.anthropic_api_key
        if not key:
            raise ProviderConfigurationError("Anthropic API key is not configured")
        if request.temperature is not None:
            # Current Claude models reject sampling parameters with a 400.
            raise ProviderInputError("temperature is not supported by current Claude models; omit it")
        model = request.model or self.settings.anthropic_default_model
        messages = [{"role": m.role, "content": m.content} for m in request.messages if m.role != "system"]
        systems = [m.content for m in request.messages if m.role == "system"]
        payload: dict[str, Any] = {"model": model, "max_tokens": request.max_tokens, "messages": messages}
        if systems:
            payload["system"] = "\n\n".join(systems)
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        # Server-side refusal fallback exists only on the first-party Claude API.
        if self.settings.anthropic_fallbacks and self.settings.anthropic_base_url.rstrip("/") == "https://api.anthropic.com":
            headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
            payload["fallbacks"] = "default"
        data = await self._post(self.settings.anthropic_base_url + "/v1/messages", headers, payload)
        if data.get("stop_reason") == "refusal":
            details = data.get("stop_details") or {}
            category = details.get("category") if isinstance(details, dict) else None
            raise ProviderRefusal("The provider declined this request" + (f" ({category})" if category else ""))
        text = "\n".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
        usage = data.get("usage", {})
        return ProviderResult(self.name, data.get("model", model), text, {
            "input_tokens": int(usage.get("input_tokens", 0)),
            "output_tokens": int(usage.get("output_tokens", 0)),
        })

class OpenAICompatibleProvider(AIProvider):
    def __init__(self, settings: Settings, name: str, base_url: str, api_key: str, default_model: str):
        super().__init__(settings)
        self.name, self.base_url, self.api_key, self.default_model = name, base_url, api_key, default_model

    async def chat(self, request: ChatRequest) -> ProviderResult:
        if not self.api_key:
            raise ProviderConfigurationError(f"{self.name} API key is not configured")
        model = request.model or self.default_model
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "max_tokens": request.max_tokens,
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        data = await self._post(
            self.base_url.rstrip("/") + "/chat/completions",
            {"Authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            payload,
        )
        try:
            text = data["choices"][0]["message"]["content"]
            if not isinstance(text, str):
                raise TypeError
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderRequestError("Provider returned an unexpected response shape") from exc
        usage = data.get("usage") or {}
        return ProviderResult(self.name, data.get("model", model), text, {
            "input_tokens": int(usage.get("prompt_tokens", 0)),
            "output_tokens": int(usage.get("completion_tokens", 0)),
        })

class ProviderRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.providers: dict[str, AIProvider] = {
            "anthropic": AnthropicProvider(settings),
            "xai": OpenAICompatibleProvider(
                settings, "xai", settings.xai_base_url, settings.xai_api_key, settings.xai_default_model
            ),
            "openai_compatible": OpenAICompatibleProvider(
                settings, "openai_compatible", settings.openai_compatible_base_url,
                settings.openai_compatible_api_key, settings.openai_compatible_default_model
            ),
        }

    def configured(self) -> list[dict[str, Any]]:
        checks = {
            "anthropic": bool(self.settings.anthropic_api_key),
            "xai": bool(self.settings.xai_api_key),
            "openai_compatible": bool(self.settings.openai_compatible_api_key),
        }
        return [{"id": name, "configured": checks[name]} for name in self.providers]

    async def chat(self, request: ChatRequest) -> ProviderResult:
        provider = self.providers.get(request.provider)
        if not provider:
            raise ProviderConfigurationError("Unsupported provider")
        return await provider.chat(request)
