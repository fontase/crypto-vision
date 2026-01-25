"""
AI Provider implementations for XTools.

Supports multiple AI backends:
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)
- Local models (Ollama)
"""

from __future__ import annotations

from xtools.ai.providers.base import AIProvider, AIResponse, ProviderConfig
from xtools.ai.providers.openai import OpenAIProvider
from xtools.ai.providers.anthropic import AnthropicProvider
from xtools.ai.providers.local import LocalProvider, OllamaProvider

__all__ = [
    "AIProvider",
    "AIResponse",
    "ProviderConfig",
    "OpenAIProvider",
    "AnthropicProvider",
    "LocalProvider",
    "OllamaProvider",
]
