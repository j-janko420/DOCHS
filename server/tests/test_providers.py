import os
os.environ["APP_ENV"] = "test"
os.environ["DORCHS_API_TOKEN"] = "test-token-which-is-long-enough-for-tests"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost"

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
