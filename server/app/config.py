from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_name: str = "DORCHS API"
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"
    dorchs_api_token: str = "development-only-token-change-me"
    trusted_hosts: str = "localhost,127.0.0.1,testserver"

    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_default_model: str = "claude-sonnet-4-20250514"

    xai_api_key: str = ""
    xai_base_url: str = "https://api.x.ai/v1"
    xai_default_model: str = "grok-3"

    openai_compatible_api_key: str = ""
    openai_compatible_base_url: str = "https://api.openai.com/v1"
    openai_compatible_default_model: str = "gpt-4.1-mini"

    provider_timeout_seconds: float = 45.0
    max_input_chars: int = 30000
    max_messages: int = 40

    @field_validator("app_env")
    @classmethod
    def validate_env(cls, v: str) -> str:
        if v not in {"development", "test", "staging", "production"}:
            raise ValueError("APP_ENV must be development, test, staging, or production")
        return v

    def validate_security(self) -> None:
        if self.app_env == "production":
            token = self.dorchs_api_token
            if not token or len(token) < 32 or token == "development-only-token-change-me":
                raise ValueError("Production requires DORCHS_API_TOKEN with at least 32 characters")

    def allowed_hosts(self) -> list[str]:
        return [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
