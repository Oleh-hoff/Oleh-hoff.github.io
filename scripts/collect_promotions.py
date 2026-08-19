#!/usr/bin/env python3
"""Купоны и дилы — для отметок на графике продаж по неделям.

ЧТО СОБИРАЕТСЯ
  GET_COUPON_PERFORMANCE_REPORT     купоны: срок, ASIN, скидка, выкупы
  GET_PROMOTION_PERFORMANCE_REPORT  дилы: срок, ASIN, тип, штуки, выручка

Оба требуют роль Brand Analytics / Selling Partner Insights — у приложения
она есть (проверено 2026-08-04). Оба отдают JSON.

ОДНА ПЛОЩАДКА НА ЗАПРОС
В отличие от отчёта по заказам, эти принимают ровно один marketplaceId.
Список из тринадцати даёт отчёт со статусом FATAL и телом
`{"reportRequestError":"Required number of marketplaces should be 1 but
actual was 13."}` — то есть причина лежит в теле отчёта, а не в ответе API.
Поэтому площадки обходятся по одной, а тело FATAL читается ради причины.

ОКНО ЗАПРОСА ШИРЕ ОКНА ДАННЫХ
Отчёты фильтруют кампании по дате **старта**, а не по пересечению с
периодом. Кампания, начавшаяся до окна и дожившая до него, в выборку по
точным датам не попала бы — и неделя осталась бы без отметки, хотя акция шла.
Поэтому старт запрашивается с запасом назад.

ОТМЕНЁННОЕ НЕ СОБЫТИЕ
У дилов бывает статус CANCELED. Отметить им неделю значит показать акцию,
которой не было. В выгрузку идут только состоявшиеся.

ВЫХОД
data/promotions.json — по записи на кампанию: срок, площадка, ASIN, тип.
Персональных данных нет, названия кампаний публичны.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import sync_log  # noqa: E402
from spapi.client import SPAPIClient, SPAPIError  # noqa: E402

OUT_PATH = PROJECT_ROOT / "data" / "promotions.json"
SALES_PATH = PROJECT_ROOT / "data" / "weekly-sales.json"

COUPON_REPORT = "GET_COUPON_PERFORMANCE_REPORT"
DEAL_REPORT = "GET_PROMOTION_PERFORMANCE_REPORT"

# Насколько раньше окна данных искать старты кампаний. Дил живёт дни, купон —
# недели; сорока дней хватает, чтобы поймать всё, что дотянулось до периода.
START_LOOKBACK_DAYS = 40

DEFAULT_WEEKS = 14

MARKETPLACES = [
    ("DE", "A1PA6795UKMFR9"), ("FR", "A13V1IB3VIYZZH"), ("IT", "APJ6JRA9NG5V4"),
    ("ES", "A1RKKUPIHCS9HS"), ("GB", "A1F83G8C2ARO7P"), ("NL", "A1805IZSGTT6HS"),
    ("BE", "AMEN7PMS3EDWL"), ("IE", "A28R8C7NBKEWEA"), ("PL", "A1C3SOZRARQ6R3"),
    ("SE", "A2NODRKZP88ZB9"), ("TR", "A33AVAJ2PDY3EV"), ("AE", "A2VIGQ35RCS4UG"),
    ("SA", "A17E79C6D8DWNP"),
]
CODE_BY_ID = {mid: code for code, mid in MARKETPLACES}

# Статусы дилов, при которых акция действительно шла. Всё прочее — замысел,
# а не событие.
LIVE_DEAL_STATUSES = {"APPROVED", "RUNNING", "COMPLETED", "ACTIVE"}

KIND_BY_TYPE = {"BEST_DEAL": "best_deal", "LIGHTNING_DEAL": "lightning_deal"}


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def run_report(client: SPAPIClient, report_type: str, options: dict,
               marketplace_id: str) -> dict:
    """Заказывает отчёт по одной площадке и возвращает разобранное тело.

    При FATAL тело отчёта всё равно скачивается: причина отказа лежит именно
    там, а сообщение «отчёт завершился со статусом FATAL» само по себе не
    объясняет ничего.
    """
    body = {
        "reportType": report_type,
        "marketplaceIds": [marketplace_id],
        "reportOptions": options,
    }
    report_id = client.post("/reports/2021-06-30/reports", body)["reportId"]

    try:
        report = client.wait_for_report(report_id, timeout=900)
    except SPAPIError:
        report = client.get(f"/reports/2021-06-30/reports/{report_id}")
        detail = ""
        if report.get("reportDocumentId"):
            try:
                body_text = client.report_document(report["reportDocumentId"])
                detail = (json.loads(body_text).get("reportRequestError")
                          or body_text[:200])
            except (SPAPIError, ValueError, KeyError):
                detail = ""
        raise SPAPIError(0, detail or f"статус {report.get('processingStatus')}",
                         f"{report_type} / {marketplace_id}") from None

    return json.loads(client.report_document(report["reportDocumentId"]))


def day_of(value: str | None) -> str | None:
    return value[:10] if value else None


def collect_coupons(client: SPAPIClient, start: date, end: date,
                    marketplace_id: str) -> list[dict]:
    data = run_report(client, COUPON_REPORT, {
        "couponStartDateFrom": f"{start}T00:00:00Z",
        "couponStartDateTo": f"{end}T00:00:00Z",
    }, marketplace_id)

    out = []
    for coupon in data.get("coupons", []):
        asins = [a.get("asin") for a in coupon.get("asins", []) if a.get("asin")]
        if not asins:
            continue
        discount = coupon.get("discountAmount")
        out.append({
            "id": coupon.get("couponId"),
            "kind": "coupon",
            "name": coupon.get("name") or "",
            "m": CODE_BY_ID.get(coupon.get("marketplaceId"), coupon.get("marketplaceId")),
            "start": day_of(coupon.get("startDateTime")),
            "end": day_of(coupon.get("endDateTime")),
            "asins": sorted(set(asins)),
            "units": coupon.get("redemptions"),
            "sales": coupon.get("sales"),
            "currency": coupon.get("currencyCode"),
            # Глубина скидки в подсказке: «10%» и «€1» ведут себя совершенно
            # по-разному, и без неё отметки на графике неразличимы
            "discount": (f"{discount:g}%" if coupon.get("discountType") == "PERCENT_OFF_LIST_PRICE"
                         else f"{discount:g}" if discount is not None else None),
            "discountKind": coupon.get("discountType"),
        })
    return out


def collect_deals(client: SPAPIClient, start: date, end: date,
                  marketplace_id: str) -> tuple[list[dict], int]:
    data = run_report(client, DEAL_REPORT, {
        "promotionStartDateFrom": f"{start}T00:00:00Z",
        "promotionStartDateTo": f"{end}T00:00:00Z",
    }, marketplace_id)

    out = []
    skipped = 0
    for deal in data.get("promotions", []):
        status = (deal.get("status") or "").upper()
        if status not in LIVE_DEAL_STATUSES:
            # Отменённый дил не шёл: отметка о нём соврала бы про неделю
            skipped += 1
            continue

        asins = [p.get("asin") for p in deal.get("includedProducts", []) if p.get("asin")]
        if not asins:
            continue
        out.append({
            "id": deal.get("promotionId"),
            "kind": KIND_BY_TYPE.get(deal.get("type"), "deal"),
            "type": deal.get("type"),
            "name": deal.get("promotionName") or "",
            "m": CODE_BY_ID.get(deal.get("marketplaceId"), deal.get("marketplaceId")),
            "start": day_of(deal.get("startDateTime")),
            "end": day_of(deal.get("endDateTime")),
            "asins": sorted(set(asins)),
            "units": deal.get("unitsSold"),
            "sales": deal.get("revenue"),
            "currency": deal.get("revenueCurrencyCode"),
        })
    return out, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weeks", type=int, default=DEFAULT_WEEKS)
    parser.add_argument("--marketplace", action="append",
                        help="код площадки; по умолчанию все")
    args = parser.parse_args()

    started_at = sync_log.now_iso()
    today = now().date()

    # Окно данных совпадает с разделом продаж — иначе отметки лягут не на те
    # недели. Берём его из самой выгрузки, если она есть.
    window_end = today
    window_start = week_start(today) - timedelta(weeks=args.weeks - 1)
    if SALES_PATH.exists():
        try:
            sales = json.loads(SALES_PATH.read_text(encoding="utf-8"))
            window_start = date.fromisoformat(sales["periodStart"])
            window_end = date.fromisoformat(sales["periodEnd"])
        except (ValueError, OSError, KeyError):
            pass

    search_from = window_start - timedelta(days=START_LOOKBACK_DAYS)

    # По умолчанию — только площадки, где есть продажи: на остальных и акций
    # быть не может, а каждый лишний код это два отчёта.
    default_codes = [code for code, _ in MARKETPLACES]
    if SALES_PATH.exists():
        try:
            sold = set(json.loads(SALES_PATH.read_text(encoding="utf-8"))["marketplaces"])
            known = [code for code, _ in MARKETPLACES if code in sold]
            if known:
                default_codes = known
        except (ValueError, OSError, KeyError):
            pass

    codes = args.marketplace or default_codes
    targets = [(code, mid) for code, mid in MARKETPLACES if code in codes]

    print(f"Окно данных: {window_start} — {window_end}")
    print(f"Старты кампаний ищем с {search_from} (запас {START_LOOKBACK_DAYS} дней назад)")
    print(f"Площадок: {len(targets)} — {', '.join(code for code, _ in targets)}")

    try:
        client = SPAPIClient()

        coupons: list[dict] = []
        deals: list[dict] = []
        skipped = 0
        failures: list[str] = []

        for code, mid in targets:
            # Площадка без Brand Analytics или без акций не должна ронять
            # остальные: одна отметка лучше, чем ноль отметок из-за соседа.
            try:
                got = collect_coupons(client, search_from, window_end, mid)
                coupons.extend(got)
                print(f"  {code}: купонов {len(got)}", flush=True)
            except SPAPIError as e:
                failures.append(f"{code}/купоны: {e}")
                print(f"  {code}: купоны не получены — {e}", flush=True)

            try:
                got, cancelled = collect_deals(client, search_from, window_end, mid)
                deals.extend(got)
                skipped += cancelled
                print(f"  {code}: дилов {len(got)}, отменённых {cancelled}", flush=True)
            except SPAPIError as e:
                failures.append(f"{code}/дилы: {e}")
                print(f"  {code}: дилы не получены — {e}", flush=True)

        if failures and not coupons and not deals:
            raise SPAPIError(0, "; ".join(failures[:3]), "промо")

        # В выгрузку идёт только то, что пересекается с окном данных: кампания,
        # закончившаяся до начала периода, ни одной недели не отмечает.
        campaigns = [c for c in coupons + deals
                     if c["start"] and c["end"]
                     and c["end"] >= window_start.isoformat()
                     and c["start"] <= window_end.isoformat()]
        campaigns.sort(key=lambda c: (c["start"], c["kind"], c["name"]))

        kinds = sorted({c["kind"] for c in campaigns})
        markets = sorted({c["m"] for c in campaigns})
        print(f"\nПопало в окно: {len(campaigns)} кампаний")
        print(f"Типы: {kinds}")
        print(f"Площадки: {markets}")

        payload = {
            "source": "spapi-promotions",
            "generatedAt": iso(now()),
            "periodStart": window_start.isoformat(),
            "periodEnd": window_end.isoformat(),
            "searchFrom": search_from.isoformat(),
            "kinds": kinds,
            "marketplaces": markets,
            "cancelledSkipped": skipped,
            "failures": failures,
            "campaigns": campaigns,
        }
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"Записано: {OUT_PATH.relative_to(PROJECT_ROOT)}")

        if failures:
            print(f"\nНе получено с части площадок: {len(failures)}")
            for line in failures:
                print(f"  · {line}")

        sync_log.append(
            source="amazon-promotions",
            # Частичный сбор помечается как partial, а не ok: иначе пропавшая
            # площадка выглядит как «акций там не было».
            status=sync_log.STATUS_PARTIAL if failures else sync_log.STATUS_OK,
            started_at=started_at,
            mode=f"{len(targets)}mp",
            stats={"campaigns": len(campaigns), "coupons": len(coupons),
                   "deals": len(deals), "marketplaces": len(markets)},
            message=(f"Кампаний в окне: {len(campaigns)} "
                     f"(купонов {len(coupons)}, дилов {len(deals)})."
                     + (f" Не ответили: {len(failures)}." if failures else "")),
            error=({"type": "partial-marketplaces",
                    "detail": "; ".join(failures)[:400]} if failures else None),
        )
        return 0

    except Exception as e:                                        # noqa: BLE001
        print(f"ОШИБКА: {type(e).__name__}: {e}", file=sys.stderr)
        sync_log.append(
            source="amazon-promotions",
            status=sync_log.STATUS_ERROR,
            started_at=started_at,
            mode="promotions",
            message="Купоны и дилы собрать не удалось — отметок на графике не будет.",
            error={"type": type(e).__name__, "detail": str(e)[:400]},
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
