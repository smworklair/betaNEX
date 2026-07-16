"""
Символьный (char-level) токенизатор.

Почему посимвольный, а не по словам или BPE (как в настоящих LLM):
это радикально упрощает саму токенизацию — алфавит модели это просто
множество символов, встреченных в обучающем тексте, — но платит за это
тем, что сети приходится учить даже "орфографию" с нуля: какие буквы
обычно идут подряд, где бывает пробел и т.п. Для учебного прототипа
это осознанный компромисс: настоящий BPE-токенизатор — отдельная
непростая тема, здесь важнее увидеть весь путь целиком, от текста до
чисел и обратно, а не оптимальное сжатие текста в токены.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CharTokenizer:
    chars: list[str]
    char_to_id: dict[str, int] = field(init=False, repr=False)
    id_to_char: dict[int, str] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.char_to_id = {ch: i for i, ch in enumerate(self.chars)}
        self.id_to_char = dict(enumerate(self.chars))
        # Символ-заглушка для всего, чего нет в словаре — простая, но
        # не единственно возможная стратегия для неизвестных символов;
        # настоящие токенизаторы дробят неизвестное на под-токены (BPE),
        # здесь для простоты просто подменяем на пробел (или на первый
        # символ словаря, если пробела в корпусе почему-то не было).
        self._unk_id = self.char_to_id.get(" ", 0)

    @classmethod
    def from_text(cls, text: str) -> CharTokenizer:
        """Построить словарь из множества символов, встреченных в тексте."""
        return cls(chars=sorted(set(text)))

    @property
    def vocab_size(self) -> int:
        return len(self.chars)

    def encode(self, text: str) -> list[int]:
        return [self.char_to_id.get(ch, self._unk_id) for ch in text]

    def decode(self, ids: list[int]) -> str:
        return "".join(self.id_to_char.get(i, "") for i in ids)
