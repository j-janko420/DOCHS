from typing import Literal
from pydantic import BaseModel, Field, field_validator, ConfigDict

Role = Literal["system", "user", "assistant"]

class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Role
    content: str = Field(min_length=1, max_length=30000)

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["anthropic", "xai", "openai_compatible"]
    model: str | None = Field(default=None, min_length=1, max_length=150)
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    max_tokens: int = Field(default=1000, ge=1, le=4096)
    temperature: float | None = Field(default=None, ge=0, le=2)

    @field_validator("messages")
    @classmethod
    def ensure_message_content_size(cls, messages):
        total = sum(len(m.content) for m in messages)
        if total > 30000:
            raise ValueError("Combined message content exceeds configured request limit")
        return messages

class ChatResponse(BaseModel):
    provider: str
    model: str
    text: str
    usage: dict[str, int] = {}
