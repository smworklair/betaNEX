"""
Память диалога — то, что делает Nex-pilot "ассистентом", а не голым
вызовом generate() один раз без контекста.

Хранится только в памяти процесса (список последних реплик); при
перезапуске теряется — персистентность (файл/БД) в задачу этого
учебного прототипа не входит.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Turn:
    role: str  # "user" | "assistant"
    text: str


@dataclass
class ConversationMemory:
    # Больше реплик — не значит лучше: FrankAI (маленький char-RNN) всё
    # равно "забывает" длинный контекст уже через несколько десятков
    # символов, так что раздувать историю сверх нескольких последних
    # реплик для него бессмысленно, а для gateway-backend просто дороже.
    max_turns: int = 6
    turns: list[Turn] = field(default_factory=list)

    def add(self, role: str, text: str) -> None:
        self.turns.append(Turn(role, text))
        if len(self.turns) > self.max_turns:
            self.turns = self.turns[-self.max_turns :]

    def as_text(self) -> str:
        """Плоский текст истории — то, что понимает FrankAI (он не умеет в структуру messages)."""
        lines = [f"{'Пользователь' if t.role == 'user' else 'Nex-pilot'}: {t.text}" for t in self.turns]
        return "\n".join(lines)

    def clear(self) -> None:
        self.turns = []
