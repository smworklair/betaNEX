"""
CLI для обучения FrankAI на текстовом корпусе и сохранения весов.

Обычно этого делать вручную не нужно — FrankAI.load_or_train() обучает
модель автоматически при первом использовании (см. engine.py). Этот
скрипт нужен, если хочется:
- обучить дольше/с другими параметрами, чем дефолт load_or_train;
- пересчитать веса после изменения корпуса;
- просто посмотреть на процесс обучения отдельно от Nex-pilot.

Пример:
    python scripts/train.py --iterations 15000
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # чтобы `import frankai` работало без pip install -e

from frankai.engine import FrankAI


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Обучить FrankAI на текстовом корпусе")
    parser.add_argument("--corpus", default=str(root / "frankai" / "data" / "sample_corpus.txt"))
    parser.add_argument("--out", default=str(root / "weights" / "frankai_weights.npz"))
    parser.add_argument("--hidden-size", type=int, default=128)
    parser.add_argument("--seq-length", type=int, default=25)
    parser.add_argument("--iterations", type=int, default=8000)
    parser.add_argument("--learning-rate", type=float, default=0.1)
    args = parser.parse_args()

    corpus = Path(args.corpus).read_text(encoding="utf-8")
    print(f"[train] корпус: {args.corpus}")
    print(f"[train] длина: {len(corpus)} символов, алфавит: {len(set(corpus))} уникальных символов")

    started = time.monotonic()
    engine = FrankAI.train(
        corpus,
        hidden_size=args.hidden_size,
        seq_length=args.seq_length,
        iterations=args.iterations,
        learning_rate=args.learning_rate,
    )
    print(f"[train] обучение заняло {time.monotonic() - started:.1f} c")

    engine.save(args.out)
    print(f"[train] веса сохранены в {args.out}")

    print("[train] пример генерации (temperature=0.8):")
    print(engine.generate("Привет", max_new_tokens=150))


if __name__ == "__main__":
    main()
