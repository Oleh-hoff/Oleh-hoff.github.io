#!/usr/bin/env python3
"""Курсы валют для перевода продаж в евро.

ЗАЧЕМ ОТДЕЛЬНЫЙ ИСТОЧНИК
В данных Amazon курса нет ни в одном отчёте: суммы приходят в валюте площадки
и никогда не конвертируются. Чтобы показать «всё в евро», курс приходится
брать со стороны.

ПОЧЕМУ ЕЦБ
Справочные курсы Европейского центробанка публикуются ежедневно, бесплатно и
без ключа, и это тот же ориентир, которым пользуется бухгалтерия в еврозоне.
Совпадения с выплатами Amazon он не даёт и дать не может — Amazon конвертирует
по своему курсу на момент выплаты. Об этом честно сказано в интерфейсе:
перевод в евро подписан как оценка, а не как факт.

Курсы выходят только по рабочим дням. Для выходных берётся ближайший
предыдущий рабочий день — это стандартная практика, а не приближение.

ВЫХОД
data/fx-rates.json — по одной записи на дату: сколько единиц валюты за евро.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import sync_log  # noqa: E402

OUT_PATH = PROJECT_ROOT / "data" / "fx-rates.json"

# 90 дней покрывают квартал, который показывает дашборд. Полный исторический
# ряд ЕЦБ — это архив на несколько мегабайт, и он здесь не нужен.
HIST_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"

NS = {"gesmes": "http://www.gesmes.org/xml/2002-08-01",
      "ecb": "http://www.ecb.int/vocabulary/2002-08-01/eurofxref"}

# Валюты, в которых у продавца есть продажи. Тянуть все сорок нет смысла:
# файл читает браузер.
WANTED = ["GBP", "SEK", "PLN", "TRY", "USD", "CZK", "HUF", "RON", "DKK", "NOK", "CHF"]

USER_AGENT = "amazon-crm-dashboard/1.0 (+https://oleh-hoff.github.io)"


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def parse(xml_text: str) -> dict[str, dict[str, float]]:
    """XML ЕЦБ → {дата: {валюта: курс}}. Курс — единиц валюты за один евро."""
    root = ET.fromstring(xml_text)
    out: dict[str, dict[str, float]] = {}

    # Внешний Cube содержит по Cube на дату, внутри — по Cube на валюту
    for day in root.iter("{%s}Cube" % NS["ecb"]):
        date = day.get("time")
        if not date:
            continue
        rates = {}
        for item in day:
            currency = item.get("currency")
            rate = item.get("rate")
            if currency and rate and currency in WANTED:
                try:
                    rates[currency] = float(rate)
                except ValueError:
                    continue
        if rates:
            out[date] = rates
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daily-only", action="store_true",
                        help="взять только курс за последний день")
    args = parser.parse_args()

    started_at = sync_log.now_iso()

    try:
        rates: dict[str, dict[str, float]] = {}

        if not args.daily_only:
            print("ЕЦБ: исторический ряд за 90 дней…", flush=True)
            rates.update(parse(fetch(HIST_URL)))

        print("ЕЦБ: курс за последний день…", flush=True)
        rates.update(parse(fetch(DAILY_URL)))

        if not rates:
            raise ValueError("ЕЦБ не вернул ни одного курса")

        dates = sorted(rates)
        currencies = sorted({c for day in rates.values() for c in day})
        print(f"  дат: {len(dates)} ({dates[0]} → {dates[-1]}), валют: {len(currencies)}")

        payload = {
            "source": "ecb-eurofxref",
            "base": "EUR",
            "note": "Единиц валюты за один евро. Справочные курсы ЕЦБ, "
                    "только рабочие дни. С выплатами Amazon не совпадают.",
            "generatedAt": iso(datetime.now(timezone.utc)),
            "periodStart": dates[0],
            "periodEnd": dates[-1],
            "currencies": currencies,
            "rates": {date: rates[date] for date in dates},
        }

        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"Записано: {OUT_PATH.relative_to(PROJECT_ROOT)}")

        sync_log.append(
            source="amazon-fx",
            status=sync_log.STATUS_OK,
            started_at=started_at,
            mode="ecb",
            stats={"rates": len(dates), "days": len(dates)},
            message=f"Курсы ЕЦБ за {len(dates)} дней, валют {len(currencies)}.",
        )
        return 0

    except Exception as e:                                        # noqa: BLE001
        # Курс — вспомогательные данные: без него дашборд работает, просто
        # без перевода в евро. Но молчать о сбое нельзя, иначе перевод
        # незаметно застрянет на позавчерашнем курсе.
        print(f"ОШИБКА: {type(e).__name__}: {e}", file=sys.stderr)
        sync_log.append(
            source="amazon-fx",
            status=sync_log.STATUS_ERROR,
            started_at=started_at,
            mode="ecb",
            message="Курсы валют получить не удалось — перевод в евро покажет "
                    "прежние курсы или будет недоступен.",
            error={"type": type(e).__name__, "detail": str(e)[:400]},
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
