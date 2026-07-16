"""Юнит-тесты сборки системного промпта из контекста страницы."""

from __future__ import annotations

from app.core.context_registry import PageContext, build_context_block


def test_no_context_returns_none() -> None:
    assert build_context_block(None) is None


def test_known_section_uses_registry_prompt() -> None:
    block = build_context_block(PageContext(page="finance"))
    assert "финансовый аналитик" in block.lower()


def test_unknown_section_falls_back_to_generic_prompt_with_title() -> None:
    block = build_context_block(PageContext(page="some-new-page", title="Новый раздел"))
    assert "Новый раздел" in block


def test_facts_and_state_are_appended() -> None:
    block = build_context_block(
        PageContext(page="finance", facts=["Задолженность 248000", "8 должников"], state="открыта вкладка «Должники»")
    )
    assert "Задолженность 248000; 8 должников" in block
    assert "открыта вкладка «Должники»" in block
