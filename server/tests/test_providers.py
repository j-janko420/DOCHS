import os
os.environ["APP_ENV"] = "test"
os.environ["DORCHS_API_TOKEN"] = "test-token-which-is-long-enough-for-tests"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"

import pytest
from app.config import Settings
from app.providers import ProviderRegistry, ProviderConfigurationError
from app.schemas import ChatRequest

@pytest.mark.asyncio
async def test_missing_provider_key_fails_closed():
    settings = Settings(app_env="test", anthropic_api_key="", dorchs_api_token="test-token-which-is-long-enough-for-tests")
    registry = ProviderRegistry(settings)
    req = ChatRequest(provider="anthropic", messages=[{"role": "user", "content": "test"}])
    with pytest.raises(ProviderConfigurationError):
        await registry.chat(req)

def test_registry_lists_all_supported_adapter_types():
    settings = Settings(app_env="test", dorchs_api_token="test-token-which-is-long-enough-for-tests")
    registry = ProviderRegistry(settings)
    assert set(registry.providers) == {"anthropic", "xai", "openai_compatible"}


from app.providers import AnthropicProvider, ProviderInputError, ProviderRefusal


def _anthropic(monkeypatch, response, base_url="https://api.anthropic.com", fallbacks=True):
    settings = Settings(app_env="test", anthropic_api_key="k", anthropic_base_url=base_url, anthropic_fallbacks=fallbacks,
                        dorchs_api_token="test-token-which-is-long-enough-for-tests")
    provider = AnthropicProvider(settings)
    sent = {}

    async def fake_post(url, headers, payload):
        sent.update(url=url, headers=headers, payload=payload)
        return response

    monkeypatch.setattr(provider, "_post", fake_post)
    return provider, sent


@pytest.mark.asyncio
async def test_anthropic_default_model_and_fallback(monkeypatch):
    provider, sent = _anthropic(monkeypatch, {"content": [{"type": "text", "text": "hi"}], "model": "claude-opus-5-5", "usage": {}})
    result = await provider.chat(ChatRequest(provider="anthropic", messages=[{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]))
    assert result.text == "hi"
    assert sent["payload"]["model"] == "claude-opus-5-5"
    assert sent["payload"]["system"] == "s"
    assert sent["payload"]["fallbacks"] == "default"
    assert sent["headers"]["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert "temperature" not in sent["payload"]


@pytest.mark.asyncio
async def test_anthropic_no_fallback_off_first_party(monkeypatch):
    provider, sent = _anthropic(monkeypatch, {"content": [], "usage": {}}, base_url="https://proxy.example.com")
    await provider.chat(ChatRequest(provider="anthropic", messages=[{"role": "user", "content": "u"}]))
    assert "fallbacks" not in sent["payload"] and "anthropic-beta" not in sent["headers"]


@pytest.mark.asyncio
async def test_anthropic_rejects_temperature(monkeypatch):
    provider, _ = _anthropic(monkeypatch, {})
    with pytest.raises(ProviderInputError):
        await provider.chat(ChatRequest(provider="anthropic", temperature=0.2, messages=[{"role": "user", "content": "u"}]))


@pytest.mark.asyncio
async def test_anthropic_refusal_is_reported_not_returned_as_empty_text(monkeypatch):
    provider, _ = _anthropic(monkeypatch, {"stop_reason": "refusal", "stop_details": {"category": "cyber"}, "content": []})
    with pytest.raises(ProviderRefusal, match="cyber"):
        await provider.chat(ChatRequest(provider="anthropic", messages=[{"role": "user", "content": "u"}]))
