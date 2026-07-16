"""
FrankAI — учебный прототип собственной языковой модели.

Это НЕ настоящая LLM: символьная (char-level) рекуррентная сеть (vanilla
RNN) на чистом NumPy, обучаемая обратным распространением ошибки во
времени (BPTT) на паре килобайт текста. Подробности, ограничения и
честная оценка качества — в README.md рядом с этим файлом.

Публичный интерфейс — только это:

    from frankai import FrankAI
    engine = FrankAI.load_or_train("weights/frankai_weights.npz", "frankai/data/sample_corpus.txt")
    text = engine.generate("Привет")
"""

from frankai.engine import Engine, FrankAI
from frankai.tokenizer import CharTokenizer

__all__ = ["Engine", "FrankAI", "CharTokenizer"]
