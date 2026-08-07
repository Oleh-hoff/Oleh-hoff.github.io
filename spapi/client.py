"""Минимальный клиент Amazon SP-API на стандартной библиотеке.

Модель авторизации (проверено по docs/amazon-sp-api/guides/connecting-to-the-selling-partner-api.md):
AWS SigV4 не используется — достаточно LWA access-токена в заголовке `x-amz-access-token`.
"""
from __future__ import annotations

import gzip
import io
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request

from .config import LWA_TOKEN_URL, Config

USER_AGENT = "less1-spapi-client/0.1 (Language=Python/3)"
MAX_RETRIES = 5


class SPAPIError(RuntimeError):
    """Ошибка вызова SP-API с разобранным телом ответа."""

    def __init__(self, status: int, body: str, path: str):
        self.status = status
        self.body = body
        self.path = path
        super().__init__(self._format())

    def _format(self) -> str:
        detail = self.body
        try:
            parsed = json.loads(self.body)
            errors = parsed.get("errors")
            if errors:
                detail = "; ".join(
                    f"[{e.get('code')}] {e.get('message')}"
                    + (f" ({e['details']})" if e.get("details") else "")
                    for e in errors
                )
        except (ValueError, AttributeError, TypeError):
            pass
        return f"HTTP {self.status} на {self.path}: {detail}"


class SPAPIClient:
    def __init__(self, config: Config | None = None):
        self.config = config or Config.from_env()
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    # --- авторизация -----------------------------------------------------
    def access_token(self) -> str:
        """LWA access-токен с кешем. TTL — 1 час, обновляем за 60 с до конца."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        payload = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": self.config.refresh_token,
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
        }).encode()

        req = urllib.request.Request(
            LWA_TOKEN_URL,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            # Тело ошибки LWA может содержать эхо client_id — наружу его не отдаём.
            raise SPAPIError(e.code, "не удалось обменять refresh_token на access_token "
                                     "(проверьте SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET / "
                                     "SPAPI_REFRESH_TOKEN)", LWA_TOKEN_URL) from None

        self._token = data["access_token"]
        self._token_expires_at = time.time() + int(data.get("expires_in", 3600))
        return self._token

    def token_expires_in(self) -> float:
        """Сколько секунд осталось жить текущему access-токену."""
        return max(0.0, self._token_expires_at - time.time())

    # --- вызовы API ------------------------------------------------------
    def request(self, method: str, path: str, params: dict | None = None,
                body: dict | None = None, rdt: str | None = None) -> dict:
        """Вызов операции SP-API с ретраями на 429 и 5xx."""
        url = self.config.endpoint + path
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)

        payload = json.dumps(body).encode() if body is not None else None

        for attempt in range(MAX_RETRIES):
            req = urllib.request.Request(url, data=payload, method=method.upper())
            req.add_header("x-amz-access-token", rdt or self.access_token())
            req.add_header("User-Agent", USER_AGENT)
            req.add_header("Accept", "application/json")
            if payload is not None:
                req.add_header("Content-Type", "application/json")

            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read().decode()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                raw = e.read().decode(errors="replace")
                if e.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES - 1:
                    # Экспоненциальный backoff с джиттером — см. RULES.md §4.
                    delay = (2 ** attempt) + random.random()
                    time.sleep(delay)
                    continue
                raise SPAPIError(e.code, raw, path) from None
            except urllib.error.URLError as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep((2 ** attempt) + random.random())
                    continue
                raise SPAPIError(0, f"сетевая ошибка: {e.reason}", path) from None

        raise SPAPIError(0, "исчерпаны попытки", path)

    def get(self, path: str, params: dict | None = None, rdt: str | None = None) -> dict:
        return self.request("GET", path, params=params, rdt=rdt)

    def post(self, path: str, body: dict, rdt: str | None = None) -> dict:
        return self.request("POST", path, body=body, rdt=rdt)

    # --- Reports API -----------------------------------------------------
    # Контракт сверен по models/reports-api-model/reports_2021-06-30.json.
    def create_report(self, report_type: str, marketplace_ids: list[str],
                      start: str | None = None, end: str | None = None) -> str:
        """Ставит отчёт в очередь, возвращает reportId.

        Это POST, но не мутация данных продавца — только заказ выгрузки.
        """
        body: dict = {"reportType": report_type, "marketplaceIds": marketplace_ids}
        if start:
            body["dataStartTime"] = start
        if end:
            body["dataEndTime"] = end
        return self.post("/reports/2021-06-30/reports", body)["reportId"]

    def wait_for_report(self, report_id: str, timeout: float = 900,
                        on_poll=None) -> dict:
        """Ждёт готовности отчёта. Опрос редкий: лимит getReport — 2 rps, но
        отчёт всё равно делается минутами, частить бессмысленно."""
        deadline = time.time() + timeout
        delay = 5.0
        while True:
            report = self.get(f"/reports/2021-06-30/reports/{report_id}")
            status = report.get("processingStatus")
            if on_poll:
                on_poll(status)
            if status == "DONE":
                return report
            if status in ("CANCELLED", "FATAL"):
                raise SPAPIError(0, f"отчёт завершился со статусом {status}",
                                 f"/reports/2021-06-30/reports/{report_id}")
            if time.time() > deadline:
                raise SPAPIError(0, f"отчёт не готов за {timeout:.0f} с "
                                    f"(последний статус {status})", report_id)
            time.sleep(delay)
            delay = min(delay * 1.5, 30.0)

    def report_document(self, document_id: str) -> str:
        """Скачивает и распаковывает тело отчёта.

        URL presigned — идёт без заголовка авторизации, токен туда слать нельзя.
        """
        doc = self.get(f"/reports/2021-06-30/documents/{document_id}")
        req = urllib.request.Request(doc["url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read()
        if doc.get("compressionAlgorithm") == "GZIP":
            raw = gzip.decompress(raw)
        # Отчёты Amazon приходят в cp1252 для EU-площадок; utf-8 как основной вариант.
        for encoding in ("utf-8", "cp1252", "latin-1"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    # --- удобные обёртки -------------------------------------------------
    def marketplace_participations(self) -> dict:
        """Sellers API: список магазинов, в которых участвует продавец.

        Стандартная проверка «связь есть и авторизация валидна».
        """
        return self.get("/sellers/v1/marketplaceParticipations")
