"""
NexPilot — тонкий слой оркестрации поверх Backend: собрать промпт из
шаблона и памяти диалога, вызвать backend, сохранить обмен в память,
вернуть ответ пользователю.

Это ровно то, что в задании называется "добавляет что-то полезное" —
сам Backend (FrankAI или ai-gateway) ничего не знает ни про историю
диалога, ни про системный промпт; эта забота — уровня выше, здесь.
"""

from __future__ import annotations

from nexpilot.backends.base import Backend
from nexpilot.memory import ConversationMemory
from nexpilot.prompts import PromptTemplate


class NexPilot:
    def __init__(
        self,
        backend: Backend,
        template: PromptTemplate | None = None,
        memory: ConversationMemory | None = None,
    ) -> None:
        self.backend = backend
        self.template = template or PromptTemplate()
        self.memory = memory or ConversationMemory()

    async def ask(self, user_message: str) -> str:
        prompt = self.template.render(self.memory.as_text(), user_message)
        reply = await self.backend.generate(prompt)
        reply = reply.strip() or "(пустой ответ)"
        self.memory.add("user", user_message)
        self.memory.add("assistant", reply)
        return reply
