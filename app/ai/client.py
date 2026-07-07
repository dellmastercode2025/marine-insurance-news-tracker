"""Provider-agnostic LLM client layer.

OpenAI is the primary provider for the MVP. The interface is minimal
(structured + text) so Anthropic or Azure OpenAI can be added later by
implementing LLMClient and registering it in get_llm_client().

API keys come from environment variables only and never leave the backend.
"""
from __future__ import annotations

import abc
import logging
from typing import TypeVar

from pydantic import BaseModel

from app.config import get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Raised when the provider returns an unusable response."""


class LLMClient(abc.ABC):
    @abc.abstractmethod
    async def structured(
        self, system: str, user: str, output_model: type[T], model: str | None = None
    ) -> T:
        """Return validated structured output conforming to output_model."""

    @abc.abstractmethod
    async def text(self, system: str, user: str, model: str | None = None) -> str:
        """Return a plain-text (Markdown) completion."""


class OpenAIClient(LLMClient):
    def __init__(self) -> None:
        from openai import AsyncOpenAI

        settings = get_settings()
        if not settings.openai_api_key:
            raise LLMError("OPENAI_API_KEY is not set")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._default_model = settings.openai_model

    async def structured(
        self, system: str, user: str, output_model: type[T], model: str | None = None
    ) -> T:
        model = model or self._default_model
        try:
            # Native OpenAI structured outputs (json_schema strict mode).
            completion = await self._client.beta.chat.completions.parse(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format=output_model,
                temperature=0.1,
            )
            parsed = completion.choices[0].message.parsed
            if parsed is None:
                raise LLMError("OpenAI returned no parsed content (refusal or empty)")
            return parsed
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001 - fall back for models without json_schema
            log.warning("Structured-output parse failed (%s); falling back to json_object", exc)
            return await self._structured_via_json_mode(system, user, output_model, model)

    async def _structured_via_json_mode(
        self, system: str, user: str, output_model: type[T], model: str
    ) -> T:
        schema_hint = (
            "\n\nRespond with a single JSON object that validates against this JSON Schema:\n"
            + str(output_model.model_json_schema())
        )
        response = await self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system + schema_hint},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        content = response.choices[0].message.content
        if not content:
            raise LLMError("OpenAI returned empty content")
        return output_model.model_validate_json(content)

    async def text(self, system: str, user: str, model: str | None = None) -> str:
        response = await self._client.chat.completions.create(
            model=model or self._default_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
        )
        content = response.choices[0].message.content
        if not content:
            raise LLMError("OpenAI returned empty content")
        return content


_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    global _client
    if _client is None:
        provider = get_settings().llm_provider
        if provider == "openai":
            _client = OpenAIClient()
        else:
            # Anthropic / Azure OpenAI slots in here later.
            raise LLMError(f"Unsupported LLM_PROVIDER: {provider}")
    return _client


def set_llm_client(client: LLMClient | None) -> None:
    """Override the client (used by tests to inject a fake)."""
    global _client
    _client = client
