"""
Простой шаблон промпта: системная преамбула + история диалога + новый
вопрос пользователя, собранные в один текстовый блок.

ВАЖНАЯ ОГОВОРКА (особенно при backend=frankai): для маленькой char-RNN
без instruction-tuning этот шаблон не заставит модель "следовать
инструкциям" по-настоящему — FrankAI не понимает, что такое "системная
роль" или "инструкция", он просто продолжает поданный текст в похожем
стиле. Шаблон здесь задаёт лишь текстовый КОНТЕКСТ (та же идея, что у
ORG_CONTEXT в web/src/llm.ts настоящего NEX, только там его "понимает"
настоящая LLM, а тут — заведомо нет). Смысл этого модуля — показать
МЕХАНИЗМ промпт-шаблонов и то, как в него вплетается память диалога, а
не получить от FrankAI содержательные ответы. При backend=gateway тот
же шаблон уходит к настоящей LLM через ai-gateway, и там уже отработает
по-настоящему.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_SYSTEM_PREAMBLE = (
    "Ты — Nex-pilot, учебный ассистент поверх FrankAI. Отвечай коротко и по-русски."
)


@dataclass
class PromptTemplate:
    system_preamble: str = DEFAULT_SYSTEM_PREAMBLE

    def render(self, history_text: str, user_message: str) -> str:
        parts = [self.system_preamble]
        if history_text:
            parts.append(history_text)
        parts.append(f"Пользователь: {user_message}")
        parts.append("Nex-pilot:")
        return "\n".join(parts)
