"""
Юнит-тесты сборки итогового системного промпта в AIService: явный
`system` побеждает контекст; при отсутствии обоих используется
DEFAULT_SYSTEM_PROMPT; иначе — DEFAULT_SYSTEM_PROMPT + инструкция
раздела из context_registry.py.
"""

from __future__ import annotations

from app.core.context_registry import PageContext
from app.services.ai_service import DEFAULT_SYSTEM_PROMPT, _resolve_system


def test_explicit_system_wins_over_context() -> None:
    result = _resolve_system("МОЙ ПРОМПТ", PageContext(page="finance"))
    assert result == "МОЙ ПРОМПТ"


def test_no_system_no_context_uses_default() -> None:
    assert _resolve_system(None, None) == DEFAULT_SYSTEM_PROMPT


def test_context_without_explicit_system_is_appended_to_default() -> None:
    result = _resolve_system(None, PageContext(page="finance", facts=["долг 248K"]))
    assert result.startswith(DEFAULT_SYSTEM_PROMPT)
    assert "финансовый аналитик" in result.lower()
    assert "долг 248K" in result
