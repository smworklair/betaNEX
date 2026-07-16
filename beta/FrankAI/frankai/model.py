"""
CharRNN — минимальная ванильная (не LSTM/GRU) рекуррентная сеть для
посимвольного предсказания следующего символа, обучаемая обратным
распространением ошибки во времени (BPTT).

Это реализация "с нуля" на чистом NumPy — намеренно без PyTorch/
TensorFlow, чтобы был виден каждый шаг: прямой проход, ошибка,
градиенты, шаг оптимизатора. По духу и структуре — классический
min-char-rnn (Andrej Karpathy, 2015), адаптированный и прокомментированный
по-русски специально для этого учебного проекта.

ЧТО ЭТО НЕ ТАКОЕ: это не LLM. Нет ни трансформера, ни механизма
внимания (attention), ни миллиардов параметров, ни обучения на
терабайтах текста. Это сеть с одним рекуррентным слоем на несколько
десятков-сотен нейронов, обученная на нескольких килобайтах текста —
результат будет ПОХОЖ на текст (похожая длина "слов", разумные пробелы
и знаки препинания), но почти никогда не будет осмысленным. Это
ожидаемо и является целью прототипа: показать МЕХАНИЗМ языковой модели,
а не создать хорошую модель.
"""

from __future__ import annotations

import numpy as np


class CharRNN:
    def __init__(self, vocab_size: int, hidden_size: int = 128, seed: int = 42) -> None:
        self.vocab_size = vocab_size
        self.hidden_size = hidden_size
        rng = np.random.default_rng(seed)

        # Маленькие случайные веса — стандартный приём против взрыва
        # или затухания активаций в самом начале обучения.
        self.Wxh = rng.standard_normal((hidden_size, vocab_size)) * 0.01  # вход -> скрытое
        self.Whh = rng.standard_normal((hidden_size, hidden_size)) * 0.01  # скрытое -> скрытое
        self.Why = rng.standard_normal((vocab_size, hidden_size)) * 0.01  # скрытое -> выход
        self.bh = np.zeros((hidden_size, 1))
        self.by = np.zeros((vocab_size, 1))

        # Накопители Adagrad — по одному на каждый параметр, для
        # адаптивного шага обучения. Тот же выбор, что у min-char-rnn:
        # на маленьких сетях просто работает без подбора расписания LR.
        self._mem = {name: np.zeros_like(p) for name, p in self._params().items()}

    def _params(self) -> dict[str, np.ndarray]:
        return {"Wxh": self.Wxh, "Whh": self.Whh, "Why": self.Why, "bh": self.bh, "by": self.by}

    def _one_hot(self, idx: int) -> np.ndarray:
        v = np.zeros((self.vocab_size, 1))
        v[idx] = 1.0
        return v

    def zero_state(self) -> np.ndarray:
        return np.zeros((self.hidden_size, 1))

    def forward_step(self, x_id: int, h_prev: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Один шаг: символ на входе + предыдущее скрытое состояние -> новое скрытое состояние и логиты."""
        x = self._one_hot(x_id)
        h = np.tanh(self.Wxh @ x + self.Whh @ h_prev + self.bh)
        y = self.Why @ h + self.by
        return h, y

    @staticmethod
    def _softmax(y: np.ndarray) -> np.ndarray:
        # Вычитаем максимум перед exp — стандартный приём для численной
        # устойчивости (иначе exp от больших чисел даёт inf/NaN).
        e = np.exp(y - np.max(y))
        return e / np.sum(e)

    def loss_and_grads(
        self, input_ids: list[int], target_ids: list[int], h_prev: np.ndarray
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray]:
        """
        Прямой и обратный проход по одному короткому фрагменту текста
        (усечённый BPTT, длина = len(input_ids)). Возвращает суммарную
        потерю, градиенты по всем параметрам и последнее скрытое
        состояние — оно передаётся в следующий фрагмент, так сеть
        "помнит" контекст между фрагментами, не считая градиенты через
        весь текст сразу (что было бы и дорого, и численно неустойчиво
        — классическая проблема ванильных RNN на длинных
        последовательностях).
        """
        xs, hs, ps = {}, {-1: h_prev}, {}
        loss = 0.0

        for t, x_id in enumerate(input_ids):
            xs[t] = self._one_hot(x_id)
            hs[t] = np.tanh(self.Wxh @ xs[t] + self.Whh @ hs[t - 1] + self.bh)
            y = self.Why @ hs[t] + self.by
            ps[t] = self._softmax(y)
            loss += -np.log(ps[t][target_ids[t], 0] + 1e-12)  # +eps — защита от log(0)

        grads = {name: np.zeros_like(p) for name, p in self._params().items()}
        dh_next = np.zeros_like(h_prev)

        for t in reversed(range(len(input_ids))):
            dy = ps[t].copy()
            dy[target_ids[t]] -= 1  # градиент softmax + cross-entropy — классическая формула (p - one_hot)

            grads["Why"] += dy @ hs[t].T
            grads["by"] += dy

            dh = self.Why.T @ dy + dh_next
            dh_raw = (1 - hs[t] ** 2) * dh  # производная tanh: d/dx tanh(x) = 1 - tanh(x)^2

            grads["bh"] += dh_raw
            grads["Wxh"] += dh_raw @ xs[t].T
            grads["Whh"] += dh_raw @ hs[t - 1].T
            dh_next = self.Whh.T @ dh_raw

        # Обрезка градиентов (gradient clipping) — без неё ванильная
        # RNN почти гарантированно "взрывается" (exploding gradients)
        # уже на не очень длинном контексте. Стандартный обязательный
        # элемент любого BPTT-обучения, не специфика этой реализации.
        for grad in grads.values():
            np.clip(grad, -5, 5, out=grad)

        return loss, grads, hs[len(input_ids) - 1]

    def adagrad_step(self, grads: dict[str, np.ndarray], learning_rate: float) -> None:
        params = self._params()
        for name, grad in grads.items():
            self._mem[name] += grad * grad
            params[name] -= learning_rate * grad / np.sqrt(self._mem[name] + 1e-8)

    def sample(
        self,
        seed_h: np.ndarray,
        start_id: int,
        n: int,
        temperature: float,
        rng: np.random.Generator,
    ) -> list[int]:
        """
        Автогенерация n символов, начиная от готового скрытого
        состояния seed_h и последнего известного символа start_id.
        Каждый следующий символ сэмплируется из softmax(логиты /
        температура) — не берётся жадно самый вероятный, иначе сеть
        почти всегда зацикливается на одной и той же короткой фразе.
        """
        h = seed_h
        x_id = start_id
        result: list[int] = []
        for _ in range(n):
            h, y = self.forward_step(x_id, h)
            p = self._softmax(y / max(temperature, 1e-6)).ravel()
            x_id = int(rng.choice(len(p), p=p))
            result.append(x_id)
        return result
