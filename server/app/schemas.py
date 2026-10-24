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


class SuggestMappingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["anthropic", "xai", "openai_compatible"]
    model: str | None = Field(default=None, min_length=1, max_length=150)
    headers: list[str] = Field(min_length=1, max_length=80)
    samples: list[list[str]] = Field(default_factory=list, max_length=5)

    @field_validator("headers")
    @classmethod
    def headers_bounded(cls, headers):
        if any(len(h) > 200 for h in headers):
            raise ValueError("A column header is longer than 200 characters")
        return headers

    @field_validator("samples")
    @classmethod
    def samples_bounded(cls, samples):
        if any(len(row) > 80 or any(len(c) > 200 for c in row) for row in samples):
            raise ValueError("Sample rows are limited to 80 cells of 200 characters")
        return samples

class SuggestMappingResponse(BaseModel):
    provider: str
    model: str
    mapping: list[str]
    notes: list[str]


MediaType = Literal["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]

class ExtractRequest(BaseModel):
    """A scanned PDF or image to transcribe for DORSCH new-project intake."""
    model_config = ConfigDict(extra="forbid")
    provider: Literal["anthropic", "xai", "openai_compatible"]
    model: str | None = Field(default=None, min_length=1, max_length=150)
    role: Literal["layout", "schedule", "hardware"]
    file_name: str = Field(default="", max_length=200)
    media_type: MediaType
    # base64 of at most ~15 MB (images over 5 MB are refused by the endpoint)
    data_base64: str = Field(min_length=8, max_length=20_500_000)

class ExtractResponse(BaseModel):
    provider: str
    model: str
    text: str
    notes: list[str]
