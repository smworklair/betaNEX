"""
Простой чат-REPL для Nex-pilot: читает строки из stdin, печатает ответ.

Запуск:
    python -m nexpilot.cli                      # backend по умолчанию — frankai
    python -m nexpilot.cli --backend gateway     # через ai-gateway (нужен запущенный сервис)

Пустая строка, "exit" или "quit" — выход из REPL.
"""

from __future__ import annotations

import argparse
import asyncio

from frankai import FrankAI

from nexpilot.assistant import NexPilot
from nexpilot.backends.base import Backend
from nexpilot.backends.frankai_backend import FrankAIBackend
from nexpilot.config import Config, load_config


def _build_backend(backend_name: str, cfg: Config) -> Backend:
    if backend_name == "gateway":
        from nexpilot.backends.gateway_backend import GatewayBackend

        secret_note = ", с секретом" if cfg.ai_gateway_secret else ""
        provider_note = f", provider={cfg.ai_gateway_provider}" if cfg.ai_gateway_provider else ""
        print(f"[nexpilot] backend=gateway, ai-gateway на {cfg.ai_gateway_url}{secret_note}{provider_note}")
        return GatewayBackend(
            base_url=cfg.ai_gateway_url,
            tenant_id=cfg.ai_gateway_tenant_id,
            gateway_secret=cfg.ai_gateway_secret,
            provider=cfg.ai_gateway_provider,
        )

    print(f"[nexpilot] backend=frankai, веса: {cfg.frankai_weights_path}")
    engine = FrankAI.load_or_train(cfg.frankai_weights_path, cfg.frankai_corpus_path)
    print("[nexpilot] FrankAI готов.")
    return FrankAIBackend(engine, max_new_tokens=cfg.frankai_max_new_tokens)


async def _main_async(backend_name: str) -> None:
    cfg = load_config()
    backend = _build_backend(backend_name, cfg)
    pilot = NexPilot(backend)

    print(f"Nex-pilot (backend={backend.name}). Пустая строка, 'exit' или 'quit' — выход.")
    while True:
        try:
            user_message = input("Вы: ").strip()
        except EOFError:
            break
        if not user_message or user_message.lower() in {"exit", "quit"}:
            break
        reply = await pilot.ask(user_message)
        print(f"Nex-pilot: {reply}")

    aclose = getattr(backend, "aclose", None)
    if aclose is not None:
        await aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Nex-pilot — чат-REPL поверх FrankAI или ai-gateway")
    parser.add_argument("--backend", choices=["frankai", "gateway"], default=None)
    args = parser.parse_args()

    backend_name = args.backend or load_config().backend
    asyncio.run(_main_async(backend_name))


if __name__ == "__main__":
    main()
