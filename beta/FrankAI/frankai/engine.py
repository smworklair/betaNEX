"""
Единый интерфейс "движка генерации текста" (Engine) и его конкретная
реализация — FrankAI.

Зачем интерфейс: другой код (в первую очередь Nex-pilot, см.
../Nex-pilot/nexpilot/backends/frankai_backend.py) должен уметь вызвать
generate(prompt) -> text, не зная деталей устройства сети. Тот же
приём, что и LLMProvider в ai-gateway (../../ai-gateway/app/providers/base.py)
— общий контракт, реализация подставляется.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

from frankai.model import CharRNN
from frankai.tokenizer import CharTokenizer


class Engine(ABC):
    """Единый интерфейс для любого "движка" генерации текста в этом проекте."""

    @abstractmethod
    def generate(self, prompt: str, *, max_new_tokens: int = 200, temperature: float | None = None) -> str: ...


class FrankAI(Engine):
    """
    Учебный прототип собственной языковой модели: токенизатор +
    символьная RNN (frankai.model.CharRNN), обёрнутые в удобный API.

    Использование:

        engine = FrankAI.load_or_train("weights/frankai_weights.npz", "frankai/data/sample_corpus.txt")
        text = engine.generate("Привет")

    См. README.md для честной оценки того, что этот прототип умеет и
    чего не умеет.
    """

    def __init__(self, tokenizer: CharTokenizer, model: CharRNN, temperature: float = 0.8, seed: int = 7) -> None:
        self.tokenizer = tokenizer
        self.model = model
        self.temperature = temperature
        self._rng = np.random.default_rng(seed)

    # --- обучение -----------------------------------------------------

    @classmethod
    def train(
        cls,
        corpus: str,
        *,
        hidden_size: int = 128,
        seq_length: int = 25,
        iterations: int = 4000,
        learning_rate: float = 0.1,
        seed: int = 42,
        verbose: bool = True,
    ) -> FrankAI:
        """
        Обучить новую модель на тексте corpus "с нуля".

        Метод обучения — усечённый BPTT: текст режется на короткие
        фрагменты длиной seq_length, сеть обучается на каждом фрагменте
        по очереди, скрытое состояние переносится из фрагмента в
        фрагмент (см. CharRNN.loss_and_grads). Это тот же метод, что у
        классического min-char-rnn — простой, но достаточный для
        учебного корпуса в несколько килобайт.
        """
        if len(corpus) < seq_length + 1:
            raise ValueError(f"корпус слишком короткий для seq_length={seq_length}: {len(corpus)} символов")

        tokenizer = CharTokenizer.from_text(corpus)
        model = CharRNN(vocab_size=tokenizer.vocab_size, hidden_size=hidden_size, seed=seed)
        data_ids = tokenizer.encode(corpus)

        h = model.zero_state()
        pos = 0
        # "Сглаженная" потеря для лога — экспоненциальное скользящее
        # среднее, а не сырое значение с каждой итерации: сырое скачет
        # слишком сильно между соседними маленькими фрагментами текста,
        # тренд виден хуже.
        smooth_loss = -np.log(1.0 / tokenizer.vocab_size) * seq_length

        for it in range(iterations):
            if pos + seq_length + 1 >= len(data_ids):
                # Дошли до конца корпуса — начинаем новый проход по
                # тексту заново, сбросив память (иначе следующий кусок
                # "приклеился" бы к обрывку текста с конца прошлого прохода).
                h = model.zero_state()
                pos = 0

            inputs = data_ids[pos : pos + seq_length]
            targets = data_ids[pos + 1 : pos + seq_length + 1]

            loss, grads, h = model.loss_and_grads(inputs, targets, h)
            model.adagrad_step(grads, learning_rate)
            smooth_loss = smooth_loss * 0.999 + loss * 0.001

            if verbose and (it % max(1, iterations // 10) == 0 or it == iterations - 1):
                print(f"[frankai] обучение {it + 1}/{iterations}, потеря ~ {smooth_loss:.2f}")

            pos += seq_length

        return cls(tokenizer=tokenizer, model=model)

    # --- генерация ------------------------------------------------------

    def generate(self, prompt: str, *, max_new_tokens: int = 200, temperature: float | None = None) -> str:
        """
        Сгенерировать продолжение текста после prompt.

        Механика: сначала промпт "прогревает" скрытое состояние сети
        (сеть последовательно читает символы промпта, ничего не
        генерируя), затем сеть генерирует max_new_tokens новых символов
        один за другим, каждый раз подавая свой предыдущий вывод обратно
        на вход (авторегрессия) — тот же принцип, что и у настоящих LLM,
        просто на несравнимо более простой сети.
        """
        temperature = self.temperature if temperature is None else temperature
        prompt = prompt if prompt else " "

        h = self.model.zero_state()
        ids = self.tokenizer.encode(prompt)
        for x_id in ids[:-1]:
            h, _ = self.model.forward_step(x_id, h)

        generated_ids = self.model.sample(h, ids[-1], max_new_tokens, temperature, self._rng)
        return self.tokenizer.decode(generated_ids)

    # --- сохранение / загрузка -------------------------------------------

    def save(self, path: str) -> None:
        """Сохранить веса сети И словарь токенизатора в один .npz-файл."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            Wxh=self.model.Wxh,
            Whh=self.model.Whh,
            Why=self.model.Why,
            bh=self.model.bh,
            by=self.model.by,
            hidden_size=self.model.hidden_size,
            vocab_size=self.model.vocab_size,
            # Словарь токенизатора хранится тут же, одной строкой — без
            # него загруженные веса нельзя было бы правильно превратить
            # обратно в текст (номера символов зависят от порядка chars).
            vocab="".join(self.tokenizer.chars),
        )

    @classmethod
    def load(cls, path: str) -> FrankAI:
        data = np.load(path, allow_pickle=False)
        tokenizer = CharTokenizer(chars=list(data["vocab"].item()))
        model = CharRNN(vocab_size=int(data["vocab_size"]), hidden_size=int(data["hidden_size"]))
        model.Wxh, model.Whh, model.Why = data["Wxh"], data["Whh"], data["Why"]
        model.bh, model.by = data["bh"], data["by"]
        return cls(tokenizer=tokenizer, model=model)

    @classmethod
    def load_or_train(cls, weights_path: str, corpus_path: str, **train_kwargs: object) -> FrankAI:
        """
        Точка входа "просто работает": если файл весов уже есть —
        загружаем его (мгновенно); если нет — обучаем на корпусе
        corpus_path с нуля и сохраняем результат, чтобы повторный
        запуск был мгновенным. Так Nex-pilot (и любой другой вызывающий
        код) может просто попросить готовую модель, не заботясь о том,
        обучена она уже или нет.
        """
        if Path(weights_path).is_file():
            return cls.load(weights_path)
        corpus = Path(corpus_path).read_text(encoding="utf-8")
        engine = cls.train(corpus, **train_kwargs)  # type: ignore[arg-type]
        engine.save(weights_path)
        return engine
