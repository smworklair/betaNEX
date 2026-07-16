"""
Backend на базе уже готового ai-gateway (../../ai-gateway) — реальный
внешний провайдер (Gemini/OpenAI-совместимый и др., через цепочку
fallback ai-gateway) через HTTP POST /api/v1/ai/ask. Используется как
альтернатива FrankAI, когда нужен настоящий связный ответ, а не
результат учебной RNN — но по умолчанию Nex-pilot всё равно использует
FrankAI (см. config.py).

Требует отдельно запущенный ai-gateway (см. ../../ai-gateway/README.md)
— этот backend сам его не поднимает, только обращается к нему по сети.

Как это соотносится со схемой браузер→nexd→ai-gateway (см. docs/ai/
README.md в корне репозитория и ai-gateway/app/deps.py:
verify_gateway_secret): та схема существует, чтобы БРАУЗЕР не мог
подделать X-Tenant-Id и покататься на чужом бюджете — только nexd, зная
серверный секрет, вправе проставлять этот заголовок от имени настоящей
аутентифицированной сессии. Nex-pilot — не браузер, а такой же
доверенный server-side клиент, как nexd: он тоже подписывает запрос
общим секретом (X-Gateway-Secret, из AI_GATEWAY_SECRET /
Config.ai_gateway_secret) вместо того, чтобы ходить через nexd — и это
согласуется с моделью доверия, а не обходит её: любой обладатель того
же секрета, что и у ai-gateway, признаётся доверенным вызывающим,
независимо от того, Go это nexd или Python-скрипт вроде этого. Если
секрет на стороне ai-gateway не настроен (локальный дев-стенд) —
X-Gateway-Secret просто не отправляется, как и раньше.

httpx импортируется лениво (внутри __init__), а не на уровне модуля,
чтобы FrankAIBackend (используемый по умолчанию) не тянул httpx как
обязательную зависимость Nex-pilot.
"""

from __future__ import annotations

from nexpilot.backends.base import Backend


class GatewayBackend(Backend):
    name = "gateway"

    def __init__(
        self,
        base_url: str,
        tenant_id: str | None = None,
        gateway_secret: str | None = None,
        provider: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        import httpx  # ленивый импорт — см. docstring модуля

        self._base_url = base_url.rstrip("/")
        self._tenant_id = tenant_id
        self._gateway_secret = gateway_secret
        self._provider = provider
        self._client = httpx.AsyncClient(timeout=timeout)

    async def generate(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self._tenant_id:
            headers["X-Tenant-Id"] = self._tenant_id
        if self._gateway_secret:
            # Имя заголовка — то же самое, что и nexd подставляет в
            # internal/platform/httpapi/aiproxy.go (gatewaySecretHeader);
            # должно совпадать дословно с ai-gateway/app/deps.py:
            # GATEWAY_SECRET_HEADER.
            headers["X-Gateway-Secret"] = self._gateway_secret
        body: dict[str, object] = {"message": prompt}
        if self._provider:
            body["provider"] = self._provider
        resp = await self._client.post(f"{self._base_url}/api/v1/ai/ask", json=body, headers=headers)
        resp.raise_for_status()
        return resp.json()["text"]

    async def aclose(self) -> None:
        await self._client.aclose()
