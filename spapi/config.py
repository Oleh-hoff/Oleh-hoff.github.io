"""Загрузка конфигурации SP-API из окружения и `*.env` файлов.

Секреты читаются только сюда и дальше живут в памяти процесса.
Ничего из этого модуля не должно попадать в логи целиком — для показа
значений есть `mask()`.
"""
from __future__ import annotations

import glob
import os
import re
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

ENDPOINTS = {
    "na": "https://sellingpartnerapi-na.amazon.com",
    "eu": "https://sellingpartnerapi-eu.amazon.com",
    "fe": "https://sellingpartnerapi-fe.amazon.com",
}
SANDBOX_ENDPOINTS = {
    "na": "https://sandbox.sellingpartnerapi-na.amazon.com",
    "eu": "https://sandbox.sellingpartnerapi-eu.amazon.com",
    "fe": "https://sandbox.sellingpartnerapi-fe.amazon.com",
}
LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"


def mask(value: str | None, keep: int = 4) -> str:
    """Безопасное представление секрета для вывода в лог или в чат."""
    if not value:
        return "<пусто>"
    if len(value) <= keep:
        return f"<скрыто, {len(value)} симв.>"
    return f"{value[:keep]}…<скрыто, {len(value)} симв.>"


# Форматы кредов из guides/onboarding-step-5-make-your-first-call-to-the-sp-api-sandbox.md.
# Проверяем до сетевого вызова: LWA на любую подмену отвечает одинаковым
# «invalid_client», по которому не видно, что именно перепутано.
CRED_FORMATS = {
    "SPAPI_CLIENT_ID": (
        re.compile(r"^amzn1\.application-oa2-client\.[0-9a-fA-F]+$"),
        "amzn1.application-oa2-client.<hex>",
    ),
    "SPAPI_CLIENT_SECRET": (
        re.compile(r"^amzn1\.oa2-cs\.v1\.[0-9a-fA-F]+$"),
        "amzn1.oa2-cs.v1.<hex>",
    ),
    "SPAPI_REFRESH_TOKEN": (
        re.compile(r"^Atzr\|[\w\-=+/|]+$"),
        "Atzr|<...>",
    ),
}

# Идентификаторы, которые часто путают с нужными: тот же портал, соседняя строка.
LOOKALIKES = {
    re.compile(r"^amzn1\.sp\.solution\."): (
        "это Application ID (Solution ID) — он используется только в уведомлениях "
        "(notificationMetadata.applicationId) и для LWA не подходит"
    ),
    re.compile(r"^amzn1\.application\.[0-9a-fA-F]+$"): (
        "это App ID из LWA-консоли, а не Client identifier"
    ),
}


def check_credential_formats(cfg: "Config") -> list[str]:
    """Сверяет форму кредов с документированной. Возвращает список замечаний.

    В тексте замечаний — только имя переменной, ожидаемый формат и длина.
    Само значение не раскрывается (RULES.md §1.1).
    """
    problems = []
    values = {
        "SPAPI_CLIENT_ID": cfg.client_id,
        "SPAPI_CLIENT_SECRET": cfg.client_secret,
        "SPAPI_REFRESH_TOKEN": cfg.refresh_token,
    }
    for name, value in values.items():
        pattern, expected = CRED_FORMATS[name]
        if pattern.match(value):
            continue
        note = f"{name}: формат не совпадает с ожидаемым `{expected}` (длина {len(value)})"
        for lookalike, explanation in LOOKALIKES.items():
            if lookalike.match(value):
                note += f"\n      → похоже, {explanation}"
                break
        problems.append(note)
    return problems


def load_env_files(root: Path = PROJECT_ROOT) -> list[str]:
    """Загружает все `*.env` из корня проекта в os.environ.

    Пользователь может назвать файл как угодно, лишь бы он оканчивался на `.env`.
    Разделителем считается `=` или пробел — руками пишут и так, и так.
    Уже установленные переменные окружения имеют приоритет и не перетираются.
    Возвращает имена загруженных файлов (не их содержимое).
    """
    loaded = []
    candidates = sorted(glob.glob(str(root / "*.env"))) + sorted(glob.glob(str(root / ".env")))
    for path in dict.fromkeys(candidates):
        if os.path.basename(path) == ".env.example":
            continue
        for raw in Path(path).read_text(encoding="utf-8").splitlines():
            line = raw.strip().removeprefix("export ").strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
            else:
                key, _, val = line.partition(" ")
            if not val.strip():
                continue
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
        loaded.append(os.path.basename(path))
    return loaded


@dataclass
class Config:
    client_id: str
    client_secret: str
    refresh_token: str
    region: str
    marketplace_id: str
    seller_id: str
    sandbox: bool

    @property
    def endpoint(self) -> str:
        table = SANDBOX_ENDPOINTS if self.sandbox else ENDPOINTS
        return table[self.region]

    @classmethod
    def from_env(cls) -> "Config":
        load_env_files()
        region = (os.getenv("SPAPI_REGION") or "na").strip().lower()
        if region not in ENDPOINTS:
            raise ValueError(f"SPAPI_REGION должен быть na|eu|fe, получено: {region!r}")

        missing = [k for k in ("SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN")
                   if not os.getenv(k)]
        if missing:
            raise RuntimeError(
                "Не заданы обязательные переменные: " + ", ".join(missing) +
                ".\nПоложите их в файл `*.env` в корне проекта (шаблон — .env.example)."
            )

        return cls(
            client_id=os.environ["SPAPI_CLIENT_ID"],
            client_secret=os.environ["SPAPI_CLIENT_SECRET"],
            refresh_token=os.environ["SPAPI_REFRESH_TOKEN"],
            region=region,
            marketplace_id=os.getenv("SPAPI_MARKETPLACE_ID", "ATVPDKIKX0DER"),
            seller_id=os.getenv("SPAPI_SELLER_ID", ""),
            sandbox=(os.getenv("SPAPI_ENV", "sandbox").strip().lower() != "production"),
        )

    def describe(self) -> str:
        """Человекочитаемая сводка БЕЗ раскрытия секретов."""
        return (
            f"region={self.region}  endpoint={self.endpoint}\n"
            f"marketplace={self.marketplace_id}  env={'sandbox' if self.sandbox else 'production'}\n"
            f"client_id={mask(self.client_id, 24)}\n"
            f"client_secret={mask(self.client_secret, 0)}\n"
            f"refresh_token={mask(self.refresh_token, 5)}"
        )
