"""
Тесты лимитов размера запроса — защита от неограниченных history/facts/
system и от гигантских тел запроса (см. app/api/schemas.py и
app/core/limits.py). Без этих лимитов клиент мог бы прислать сколь
угодно большой payload — рост стоимости вызова провайдера и,
в пределе, DoS по памяти процесса.
"""

from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.api.schemas import AskRequest, ChatMessageIn, PageContext
from app.core.limits import MAX_BODY_BYTES, MaxBodySizeMiddleware


def test_message_over_limit_rejected() -> None:
    with pytest.raises(ValidationError):
        AskRequest(message="x" * 8001)


def test_system_over_limit_rejected() -> None:
    with pytest.raises(ValidationError):
        AskRequest(message="hi", system="x" * 20001)


def test_history_too_many_items_rejected() -> None:
    with pytest.raises(ValidationError):
        AskRequest(message="hi", history=[ChatMessageIn(role="user", content="x") for _ in range(51)])


def test_history_item_over_limit_rejected() -> None:
    with pytest.raises(ValidationError):
        ChatMessageIn(role="user", content="x" * 8001)


def test_facts_item_over_limit_rejected() -> None:
    with pytest.raises(ValidationError):
        PageContext(page="p", facts=["x" * 501])


def test_facts_too_many_items_rejected() -> None:
    with pytest.raises(ValidationError):
        PageContext(page="p", facts=["x"] * 51)


def test_within_limits_accepted() -> None:
    req = AskRequest(
        message="x" * 8000,
        system="x" * 20000,
        history=[ChatMessageIn(role="user", content="x" * 8000) for _ in range(50)],
        context=PageContext(page="p", facts=["x" * 500] * 50),
    )
    assert len(req.history) == 50


def _app_with_body_limit() -> Starlette:
    async def echo(request: Request) -> PlainTextResponse:
        body = await request.body()
        return PlainTextResponse(f"len={len(body)}")

    app = Starlette(routes=[Route("/echo", echo, methods=["POST"])])
    app.add_middleware(MaxBodySizeMiddleware)
    return app


def test_body_within_limit_passes() -> None:
    client = TestClient(_app_with_body_limit())
    res = client.post("/echo", content=b"x" * 1000)
    assert res.status_code == 200


def test_body_over_limit_rejected_before_reading() -> None:
    client = TestClient(_app_with_body_limit())
    res = client.post("/echo", content=b"x" * (MAX_BODY_BYTES + 1))
    assert res.status_code == 413
