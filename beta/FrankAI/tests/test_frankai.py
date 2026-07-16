"""
Юнит-тесты FrankAI: токенизатор, прямой/обратный проход CharRNN,
сэмплирование, сохранение/загрузка весов.

Ничего не мокается — это чистый NumPy без внешних сервисов, поэтому все
тесты реальные, без замен. Обучение в тестах намеренно короткое (мало
итераций, маленькая скрытая размерность) — цель тестов проверить
МЕХАНИКУ (формы тензоров, сходимость на игрушечном примере, детерминизм
save/load), а не получить качественный текст (см. README.md, «Честная
оценка качества»).
"""

from __future__ import annotations

import numpy as np
import pytest

from frankai.engine import FrankAI
from frankai.model import CharRNN
from frankai.tokenizer import CharTokenizer

CORPUS = (
    "Это маленький учебный текст для обучения FrankAI. "
    "FrankAI — это не настоящая большая языковая модель, а простая "
    "рекуррентная сеть, которая учится предсказывать следующий символ."
) * 3


# --- CharTokenizer -----------------------------------------------------


def test_tokenizer_roundtrip() -> None:
    tok = CharTokenizer.from_text("привет мир")
    ids = tok.encode("привет мир")
    assert tok.decode(ids) == "привет мир"


def test_tokenizer_vocab_size_matches_unique_chars() -> None:
    tok = CharTokenizer.from_text("aabbbcccc")
    assert tok.vocab_size == 3  # a, b, c


def test_tokenizer_unknown_char_falls_back_to_space() -> None:
    tok = CharTokenizer.from_text("abc ")  # содержит пробел
    ids = tok.encode("abcxyz")  # x, y, z отсутствуют в словаре
    assert ids[3:] == [tok.char_to_id[" "]] * 3


# --- CharRNN: forward/backward -----------------------------------------


def _tiny_model(seed: int = 0) -> tuple[CharRNN, CharTokenizer]:
    tok = CharTokenizer.from_text(CORPUS)
    model = CharRNN(vocab_size=tok.vocab_size, hidden_size=8, seed=seed)
    return model, tok


def test_forward_step_shapes() -> None:
    model, tok = _tiny_model()
    h0 = model.zero_state()
    assert h0.shape == (8, 1)

    h1, y1 = model.forward_step(tok.encode("Э")[0], h0)
    assert h1.shape == (8, 1)
    assert y1.shape == (tok.vocab_size, 1)
    # tanh ограничивает скрытое состояние строго в (-1, 1)
    assert np.all(h1 > -1) and np.all(h1 < 1)


def test_loss_and_grads_returns_finite_positive_loss() -> None:
    model, tok = _tiny_model()
    ids = tok.encode(CORPUS[:26])
    inputs, targets = ids[:-1], ids[1:]

    loss, grads, h_last = model.loss_and_grads(inputs, targets, model.zero_state())

    assert np.isfinite(loss)
    assert loss > 0
    assert h_last.shape == (8, 1)
    assert set(grads) == {"Wxh", "Whh", "Why", "bh", "by"}
    for name, grad in grads.items():
        assert grad.shape == getattr(model, name).shape
        assert np.all(np.isfinite(grad))


def test_gradient_clipping_bounds_are_respected() -> None:
    """Градиенты обрезаются до [-5, 5] (см. model.py) — иначе ванильная RNN взрывается."""
    model, tok = _tiny_model()
    ids = tok.encode(CORPUS)
    inputs, targets = ids[:-1], ids[1:]

    _, grads, _ = model.loss_and_grads(inputs, targets, model.zero_state())
    for grad in grads.values():
        assert grad.min() >= -5.0
        assert grad.max() <= 5.0


def test_adagrad_step_changes_parameters_and_reduces_loss_on_repeat() -> None:
    """
    Обучающий шаг должен и изменить веса, и — на одном и том же коротком
    фрагменте, повторённом много раз — снизить потерю: простая проверка,
    что градиенты текут в верном направлении (а не просто "что-то не упало").
    """
    model, tok = _tiny_model()
    ids = tok.encode(CORPUS[:26])
    inputs, targets = ids[:-1], ids[1:]

    Wxh_before = model.Wxh.copy()
    first_loss, grads, h = model.loss_and_grads(inputs, targets, model.zero_state())
    model.adagrad_step(grads, learning_rate=0.1)
    assert not np.array_equal(Wxh_before, model.Wxh)

    loss = first_loss
    for _ in range(200):
        loss, grads, h = model.loss_and_grads(inputs, targets, model.zero_state())
        model.adagrad_step(grads, learning_rate=0.1)

    assert loss < first_loss


# --- Сэмплирование -------------------------------------------------------


def test_sample_returns_ids_within_vocab_and_correct_length() -> None:
    model, tok = _tiny_model()
    rng = np.random.default_rng(1)
    ids = model.sample(model.zero_state(), start_id=0, n=15, temperature=0.8, rng=rng)

    assert len(ids) == 15
    assert all(0 <= i < tok.vocab_size for i in ids)


def test_sample_is_deterministic_given_same_rng_seed() -> None:
    model, _ = _tiny_model()
    ids_a = model.sample(model.zero_state(), start_id=0, n=20, temperature=0.8, rng=np.random.default_rng(42))
    ids_b = model.sample(model.zero_state(), start_id=0, n=20, temperature=0.8, rng=np.random.default_rng(42))
    assert ids_a == ids_b


def test_lower_temperature_reduces_sampling_diversity() -> None:
    """
    softmax(logits/T): чем меньше T, тем ближе распределение к one-hot по
    argmax; чем больше T, тем ближе к равномерному. Модель со случайной
    (нетренированной) инициализацией даёт слишком маленький разброс
    логитов (±0.001), поэтому для показательности теста логиты заданы
    вручную (Why=0, by — с явным фаворитом) — так свойство проверяется
    напрямую, а не зависит от масштаба случайных весов при инициализации.
    """
    vocab_size, hidden_size = 5, 3
    model = CharRNN(vocab_size=vocab_size, hidden_size=hidden_size, seed=0)
    model.Why[:] = 0.0
    model.by[:] = np.array([[5.0], [-5.0], [-5.0], [-5.0], [-5.0]])
    h0 = model.zero_state()

    low_temp_ids = [
        model.sample(h0, start_id=0, n=1, temperature=0.2, rng=np.random.default_rng(seed))[0]
        for seed in range(30)
    ]
    high_temp_ids = [
        model.sample(h0, start_id=0, n=1, temperature=50.0, rng=np.random.default_rng(seed))[0]
        for seed in range(30)
    ]

    assert len(set(low_temp_ids)) < len(set(high_temp_ids))
    assert low_temp_ids.count(0) > high_temp_ids.count(0)


# --- FrankAI: обучение, генерация ----------------------------------------


def test_train_raises_on_corpus_shorter_than_seq_length() -> None:
    with pytest.raises(ValueError):
        FrankAI.train("коротко", seq_length=100, iterations=1, verbose=False)


def test_train_produces_usable_engine_and_generate_returns_requested_length() -> None:
    engine = FrankAI.train(CORPUS, hidden_size=8, seq_length=10, iterations=20, verbose=False)
    text = engine.generate("Это", max_new_tokens=30)
    assert isinstance(text, str)
    assert len(text) == 30  # каждый сэмплированный id декодируется ровно в один символ словаря


def test_generate_with_empty_prompt_does_not_crash() -> None:
    engine = FrankAI.train(CORPUS, hidden_size=8, seq_length=10, iterations=5, verbose=False)
    text = engine.generate("", max_new_tokens=10)
    assert len(text) == 10


# --- Сохранение / загрузка весов -----------------------------------------


def test_save_load_roundtrip_preserves_weights_and_vocab(tmp_path) -> None:
    engine = FrankAI.train(CORPUS, hidden_size=8, seq_length=10, iterations=20, verbose=False)
    weights_path = tmp_path / "weights.npz"
    engine.save(str(weights_path))
    assert weights_path.is_file()

    loaded = FrankAI.load(str(weights_path))

    assert loaded.tokenizer.chars == engine.tokenizer.chars
    assert loaded.model.hidden_size == engine.model.hidden_size
    assert loaded.model.vocab_size == engine.model.vocab_size
    for name in ("Wxh", "Whh", "Why", "bh", "by"):
        np.testing.assert_array_equal(getattr(loaded.model, name), getattr(engine.model, name))


def test_save_load_roundtrip_is_deterministic_for_generation(tmp_path) -> None:
    """
    Два свежих экземпляра, загруженных из одного файла весов, с одним и
    тем же дефолтным seed рандомайзера (см. FrankAI.__init__) обязаны
    генерировать идентичный текст — иначе save/load теряет что-то важное
    (веса, словарь, seed).
    """
    engine = FrankAI.train(CORPUS, hidden_size=8, seq_length=10, iterations=20, verbose=False)
    weights_path = tmp_path / "weights.npz"
    engine.save(str(weights_path))

    a = FrankAI.load(str(weights_path))
    b = FrankAI.load(str(weights_path))

    assert a.generate("Привет", max_new_tokens=40) == b.generate("Привет", max_new_tokens=40)


def test_load_or_train_creates_and_then_reuses_weights_file(tmp_path) -> None:
    weights_path = tmp_path / "weights.npz"
    corpus_path = tmp_path / "corpus.txt"
    corpus_path.write_text(CORPUS, encoding="utf-8")

    assert not weights_path.exists()
    engine1 = FrankAI.load_or_train(str(weights_path), str(corpus_path), hidden_size=8, seq_length=10, iterations=10, verbose=False)
    assert weights_path.is_file()

    # Второй вызов должен ЗАГРУЗИТЬ уже готовые веса, а не обучать заново —
    # проверяем это через идентичность весов, а не только "не упало".
    engine2 = FrankAI.load_or_train(str(weights_path), str(corpus_path), hidden_size=999, seq_length=999, iterations=999999, verbose=False)
    np.testing.assert_array_equal(engine1.model.Wxh, engine2.model.Wxh)
