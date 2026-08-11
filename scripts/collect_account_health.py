#!/usr/bin/env python3
"""Проверка состояния аккаунта Amazon для раздела «Проверка аккаунта».

ЧТО ДОСТУПНО, А ЧТО НЕТ
Из одиннадцати запрошенных проверок через SP-API выполнимы не все. Проверено
живыми запросами, а не по документации:

  доступно      Stranded inventory, статусы товаров, Account Health,
                отзывы о продавце, показатели FBA, цены конкурентов
  недоступно    виджет Actions на Home, Performance Notifications в виде
                истории, входящие Messages, Customer Reviews, кейсы поддержки

Недоступные проверки НЕ выбрасываются: они попадают в выгрузку со статусом
`unavailable` и причиной. Молча пропустить их нельзя — тогда дашборд создаёт
ложное впечатление, что аккаунт проверен целиком.

ВЫХОД
data/account-health.json — по одной записи на проверку.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import sync_log  # noqa: E402
from spapi.client import SPAPIClient, SPAPIError  # noqa: E402
from spapi.config import Config  # noqa: E402

OUT_PATH = PROJECT_ROOT / "data" / "account-health.json"
PREV_LISTINGS = PROJECT_ROOT / "data" / "listings-snapshot.json"

MARKETPLACE = "A1PA6795UKMFR9"   # Amazon.de — основная площадка аккаунта

# Свежий отчёт можно взять готовым: Amazon генерирует часть из них сам.
# Пересоздавать имеет смысл, только если готовый устарел.
MAX_REPORT_AGE_HOURS = 12

STATUS_OK = "ok"
STATUS_WARN = "warn"
STATUS_ERROR = "error"
STATUS_UNAVAILABLE = "unavailable"

# Статусы показателей Amazon, которые действительно означают нарушение.
# Всё остальное (GOOD, NONE, NOT_APPLICABLE) проблемой не считается.
PROBLEM_STATUSES = {"FAIR", "POOR", "AT_RISK", "CRITICAL", "DEFICIENT", "UNHEALTHY"}


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Работа с отчётами
# --------------------------------------------------------------------------

def latest_report(client: SPAPIClient, report_type: str) -> dict | None:
    """Самый свежий готовый отчёт этого типа, если он не устарел."""
    try:
        resp = client.get("/reports/2021-06-30/reports", params={
            "reportTypes": report_type,
            "processingStatuses": "DONE",
            "pageSize": 10,
            "marketplaceIds": MARKETPLACE,
        })
    except SPAPIError:
        return None

    reports = resp.get("reports") or []
    if not reports:
        return None

    reports.sort(key=lambda r: r.get("createdTime", ""), reverse=True)
    newest = reports[0]
    created = newest.get("createdTime", "")
    try:
        age = now() - datetime.fromisoformat(created.replace("Z", "+00:00"))
        if age > timedelta(hours=MAX_REPORT_AGE_HOURS):
            return None
    except ValueError:
        return None
    return newest


def fetch_report(client: SPAPIClient, report_type: str, wait: int = 600) -> str | None:
    """Текст отчёта: берём готовый или заказываем новый и ждём.

    Пустая строка — данных нет, и это нормальный ответ, а не сбой: Amazon
    отменяет отчёт со статусом CANCELLED, когда возвращать нечего. Отчёт по
    зависшим запасам отменяется именно тогда, когда таких запасов нет, —
    трактовать это как ошибку значит пугать пользователя на пустом месте.
    None — настоящая неудача.
    """
    report = latest_report(client, report_type)

    if report is None:
        try:
            report_id = client.create_report(report_type, [MARKETPLACE])
        except SPAPIError as e:
            print(f"      заказ отчёта отклонён: {e}")
            return None
        try:
            report = client.wait_for_report(report_id, timeout=wait)
        except SPAPIError as e:
            if "CANCELLED" in str(e):
                print("      данных нет (Amazon отменил пустой отчёт)")
                return ""
            print(f"      отчёт не готов: {e}")
            return None

    doc_id = report.get("reportDocumentId")
    if not doc_id:
        return None
    try:
        return client.report_document(doc_id)
    except SPAPIError as e:
        print(f"      скачивание не удалось: {e}")
        return None


def parse_table(text: str) -> list[dict]:
    """Отчёты Amazon приходят как TSV с заголовком в первой строке."""
    if not text:
        return []
    sample = text[:4096]
    delimiter = "\t" if sample.count("\t") >= sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]


def pick(row: dict, *names: str) -> str:
    """Имена колонок у Amazon разнятся по площадкам — берём первое совпавшее."""
    lowered = {k.lower().replace("-", "_").replace(" ", "_"): v for k, v in row.items()}
    for name in names:
        key = name.lower().replace("-", "_").replace(" ", "_")
        if key in lowered and lowered[key] != "":
            return lowered[key]
    return ""


# --------------------------------------------------------------------------
# Проверки
# --------------------------------------------------------------------------

def check_stranded(client: SPAPIClient) -> dict:
    """п.2 — товары, лежащие на складе без активного объявления."""
    text = fetch_report(client, "GET_STRANDED_INVENTORY_UI_DATA")
    if text is None:
        return dict(status=STATUS_ERROR, message="Отчёт не удалось получить.")

    rows = parse_table(text)
    items = [{
        "asin": pick(r, "asin"),
        "sku": pick(r, "sku", "seller_sku"),
        "title": pick(r, "item_name", "product_name")[:120],
        "quantity": pick(r, "afn_fulfillable_quantity", "quantity"),
        "reason": pick(r, "stranded_reason", "reason", "status_primary"),
    } for r in rows]
    items = [i for i in items if i["asin"] or i["sku"]]

    return dict(
        status=STATUS_WARN if items else STATUS_OK,
        count=len(items),
        items=items[:50],
        message=(f"На складе {len(items)} позиций без активного объявления — "
                 "они не продаются, но занимают место и копят плату за хранение."
                 if items else "Зависших запасов нет."),
    )


def check_listing_status(client: SPAPIClient) -> dict:
    """п.3 — товары, у которых статус перестал быть активным.

    Само по себе состояние «неактивен» ни о чём не говорит: важно, что
    изменилось с прошлой проверки. Поэтому храним снимок и сравниваем.
    """
    text = fetch_report(client, "GET_MERCHANT_LISTINGS_ALL_DATA")
    if text is None:
        return dict(status=STATUS_ERROR, message="Отчёт не удалось получить.")

    rows = parse_table(text)
    current: dict[str, dict] = {}
    for r in rows:
        sku = pick(r, "seller_sku", "sku")
        if not sku:
            continue
        current[sku] = {
            "asin": pick(r, "asin1", "asin"),
            "title": pick(r, "item_name")[:120],
            "status": (pick(r, "status", "listing_status") or "unknown").lower(),
            "quantity": pick(r, "quantity"),
        }

    previous = {}
    if PREV_LISTINGS.exists():
        try:
            previous = json.loads(PREV_LISTINGS.read_text()).get("listings", {})
        except (ValueError, OSError):
            previous = {}

    changed = []
    for sku, item in current.items():
        was = (previous.get(sku) or {}).get("status")
        if was and was != item["status"] and was == "active":
            changed.append({**item, "sku": sku, "previousStatus": was})

    inactive_now = sum(1 for i in current.values() if i["status"] != "active")

    PREV_LISTINGS.parent.mkdir(parents=True, exist_ok=True)
    PREV_LISTINGS.write_text(json.dumps({
        "takenAt": iso(now()), "listings": current,
    }, ensure_ascii=False), encoding="utf-8")

    first_run = not previous
    return dict(
        status=STATUS_WARN if changed else STATUS_OK,
        count=len(changed),
        items=changed[:50],
        extra={"total": len(current), "inactive": inactive_now, "firstRun": first_run},
        message=("Снимок статусов сделан впервые — сравнивать пока не с чем, "
                 f"следующая проверка покажет изменения. Всего товаров {len(current)}, "
                 f"неактивных {inactive_now}." if first_run else
                 (f"{len(changed)} товаров перестали быть активными с прошлой проверки."
                  if changed else "Ни один активный товар не сменил статус.")),
    )


def check_account_health(client: SPAPIClient) -> dict:
    """п.4 — показатели здоровья аккаунта."""
    text = fetch_report(client, "GET_V2_SELLER_PERFORMANCE_REPORT")
    if text is None:
        return dict(status=STATUS_ERROR, message="Отчёт не удалось получить.")

    try:
        data = json.loads(text)
    except ValueError:
        return dict(status=STATUS_ERROR, message="Отчёт пришёл в неожиданном формате.")

    section = (data.get("performanceMetrics") or [{}])[0]

    # Значение метрики лежит в `rate` у долевых показателей и в счётчике
    # с суффиксом Count у штучных. Единого поля Amazon не даёт.
    def value_of(metric: dict):
        if "rate" in metric:
            return metric["rate"]
        for key, val in metric.items():
            if key.endswith("Count") and key != "orderCount":
                return val
        return None

    metrics, problems = [], []
    for name, value in section.items():
        if name.endswith("List") or not isinstance(value, dict):
            continue
        # Order Defect Rate разбит на FBA и собственную доставку
        branches = ({k: v for k, v in value.items() if isinstance(v, dict) and "status" in v}
                    or {"": value})
        for suffix, metric in branches.items():
            status = str(metric.get("status", "")).upper()
            if not status:
                continue
            entry = {
                "name": name + (f" ({suffix.upper()})" if suffix else ""),
                "value": value_of(metric),
                "target": metric.get("targetValue"),
                "condition": metric.get("targetCondition"),
                "status": status,
            }
            metrics.append(entry)
            # Проблемой считаем только явно плохие статусы. «Не как GOOD» —
            # негодная проверка: NONE означает отсутствие данных, и по нему
            # отчёт с рейтингом 1000 из 1000 объявлялся неисправным.
            if status in PROBLEM_STATUSES:
                problems.append(entry)

    rating = section.get("accountHealthRating") or {}
    warnings = section.get("warningStates") or []
    statuses = [s.get("status") for s in (data.get("accountStatuses") or [])]
    suspended = [s for s in statuses if s and s.upper() != "NORMAL"]

    severity = (STATUS_ERROR if suspended or problems
                else STATUS_WARN if warnings else STATUS_OK)

    return dict(
        status=severity,
        count=len(problems) + len(warnings) + len(suspended),
        items=metrics[:40],
        extra={
            "ahrScore": rating.get("ahrScore"),
            "ahrStatus": rating.get("ahrStatus"),
            "accountStatus": statuses[0] if statuses else None,
            "warnings": warnings[:10],
            "problemMetrics": [p["name"] for p in problems],
        },
        message=(f"Аккаунт под ограничениями: {', '.join(suspended)}." if suspended
                 else f"{len(problems)} показателей вне нормы." if problems
                 else f"{len(warnings)} предупреждений." if warnings
                 else f"Все {len(metrics)} показателей в норме, "
                      f"рейтинг {rating.get('ahrScore')} ({rating.get('ahrStatus')})."),
    )


def check_feedback(client: SPAPIClient, days: int = 30) -> dict:
    """п.5 — отзывы о продавце за последние дни."""
    text = fetch_report(client, "GET_SELLER_FEEDBACK_DATA")
    if text is None:
        return dict(status=STATUS_ERROR, message="Отчёт не удалось получить.")

    rows = parse_table(text)
    since = (now() - timedelta(days=days)).date().isoformat()

    recent, negative = [], 0
    for r in rows:
        date = pick(r, "date", "feedback_date")[:10]
        if date and date < since:
            continue
        try:
            rating = int(float(pick(r, "rating", "feedback_rating") or 0))
        except ValueError:
            rating = 0
        if rating and rating <= 3:
            negative += 1
        recent.append({
            "date": date,
            "rating": rating,
            "comment": pick(r, "comments", "feedback_comment")[:200],
            "orderId": "",     # идентификатор заказа в публичный файл не кладём
        })

    return dict(
        status=STATUS_WARN if negative else STATUS_OK,
        count=len(recent),
        items=sorted(recent, key=lambda x: x["date"], reverse=True)[:30],
        extra={"negative": negative, "days": days},
        message=(f"За {days} дней {len(recent)} отзывов, из них негативных {negative}."
                 if recent else f"Новых отзывов за {days} дней нет."),
    )


def check_fba(client: SPAPIClient) -> dict:
    """п.10 — показатели FBA: индекс запасов, излишки, залежавшийся товар."""
    text = fetch_report(client, "GET_FBA_INVENTORY_PLANNING_DATA")
    if text is None:
        return dict(status=STATUS_ERROR, message="Отчёт не удалось получить.")

    rows = parse_table(text)
    problems = []
    for r in rows:
        excess = pick(r, "excess_units", "estimated_excess_units")
        aged = pick(r, "inv_age_365_plus_days", "inv_age_271_to_365_days")
        try:
            excess_n = float(excess or 0)
            aged_n = float(aged or 0)
        except ValueError:
            excess_n = aged_n = 0
        if excess_n > 0 or aged_n > 0:
            problems.append({
                "asin": pick(r, "asin"),
                "sku": pick(r, "sku", "seller_sku"),
                "title": pick(r, "product_name", "item_name")[:120],
                "excessUnits": int(excess_n),
                "agedUnits": int(aged_n),
            })

    problems.sort(key=lambda x: -(x["excessUnits"] + x["agedUnits"]))
    return dict(
        status=STATUS_WARN if problems else STATUS_OK,
        count=len(problems),
        items=problems[:50],
        message=(f"{len(problems)} позиций с излишками или залежавшимся запасом — "
                 "по ним начисляется повышенная плата за хранение."
                 if problems else "Проблем с запасами FBA нет."),
    )


def unavailable(reason: str, workaround: str = "") -> dict:
    return dict(status=STATUS_UNAVAILABLE, count=0, items=[],
                message=reason, extra={"workaround": workaround})


# --------------------------------------------------------------------------

CHECKS = [
    ("actions", "п.1", None),
    ("stranded", "п.2", check_stranded),
    ("listingStatus", "п.3", check_listing_status),
    ("accountHealth", "п.4", check_account_health),
    ("feedback", "п.5", check_feedback),
    ("performanceNotifications", "п.6", None),
    ("pricingHealth", "п.7", None),
    ("messages", "п.8", None),
    ("customerReviews", "п.9", None),
    ("fbaPerformance", "п.10", check_fba),
    ("cases", "п.11", None),
]

UNAVAILABLE_REASONS = {
    "actions": ("Виджет Actions на главной Seller Central не выведен в API — "
                "он собирает сигналы из других разделов.",
                "Его содержимое воспроизводится проверками 2, 3, 4 и 10."),
    "performanceNotifications": (
        "История Performance Notifications через API не читается.",
        "Notifications API работает только на отправку новых событий и требует "
        "приёмника в AWS; прошлые уведомления получить нельзя."),
    "pricingHealth": ("Виджет Pricing Health в API не выведен.",
                      "Доступен Product Pricing API — конкурентную цену можно "
                      "сравнивать с нашей самостоятельно, это отдельная работа."),
    "messages": ("Входящие сообщения через API не читаются.",
                 "Messaging API умеет только отправлять письма покупателю по заказу."),
    "customerReviews": ("Отзывы о товарах Amazon через API не отдаёт.",
                        "Публичного доступа к Customer Reviews нет ни в одной версии SP-API."),
    "cases": ("Обращения в поддержку через API недоступны.",
              "Публичного API для кейсов Seller Central не существует."),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="выполнить только указанную проверку")
    args = parser.parse_args()

    started_at = sync_log.now_iso()
    client = SPAPIClient(Config.from_env())

    if client.config.sandbox:
        print("ОСТАНОВКА: конфигурация в режиме sandbox.")
        return 1

    print("=" * 70)
    print("Проверка состояния аккаунта Amazon")
    print("=" * 70)

    results, failures = [], 0
    for key, item, fn in CHECKS:
        if args.only and args.only != key:
            continue

        if fn is None:
            reason, workaround = UNAVAILABLE_REASONS[key]
            print(f"  — {item:5} {key:26} недоступно через API")
            results.append({"id": key, "item": item, "checkedAt": iso(now()),
                            **unavailable(reason, workaround)})
            continue

        print(f"  · {item:5} {key:26} …", flush=True)
        try:
            outcome = fn(client)
        except SPAPIError as e:
            outcome = dict(status=STATUS_ERROR, count=0, items=[],
                           message=f"Amazon вернул ошибку: {e}")
        except Exception as e:                                    # noqa: BLE001
            outcome = dict(status=STATUS_ERROR, count=0, items=[],
                           message=f"Проверка не выполнена: {type(e).__name__}: {e}")

        if outcome["status"] == STATUS_ERROR:
            failures += 1
        print(f"    {outcome['status']:12} {outcome.get('message', '')[:80]}")
        results.append({"id": key, "item": item, "checkedAt": iso(now()), **outcome})

    # При выборочном запуске обновляем только затронутые проверки. Иначе
    # `--only` затирает файл одной записью, и остальные десять исчезают —
    # ровно это и случилось при первой отладке.
    if args.only and OUT_PATH.exists():
        try:
            previous = json.loads(OUT_PATH.read_text()).get("checks", [])
        except (ValueError, OSError):
            previous = []
        fresh = {r["id"] for r in results}
        merged = [r for r in previous if r["id"] not in fresh] + results
        order = [key for key, _, _ in CHECKS]
        results = sorted(merged, key=lambda r: order.index(r["id"])
                         if r["id"] in order else len(order))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "generatedAt": iso(now()),
        "marketplace": MARKETPLACE,
        "checks": results,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    done = [r for r in results if r["status"] != STATUS_UNAVAILABLE]
    warns = sum(1 for r in done if r["status"] == STATUS_WARN)
    print()
    print(f"Выполнено проверок: {len(done)}, с замечаниями: {warns}, "
          f"с ошибкой: {failures}, недоступно: {len(results) - len(done)}")
    print(f"Записано: {OUT_PATH.relative_to(PROJECT_ROOT)}")

    sync_log.append(
        source="amazon-account",
        status=(sync_log.STATUS_ERROR if failures and not done
                else sync_log.STATUS_PARTIAL if failures else sync_log.STATUS_OK),
        started_at=started_at,
        mode="account-health",
        stats={"checks": len(done), "warnings": warns,
               "unavailable": len(results) - len(done)},
        message=(f"Проверок выполнено {len(done)}, с замечаниями {warns}."
                 if not failures else
                 f"Проверок выполнено {len(done)}, не удалось {failures}."),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
