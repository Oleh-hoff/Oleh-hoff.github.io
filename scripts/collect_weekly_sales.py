#!/usr/bin/env python3
"""Недельные продажи по площадкам и товарам для раздела «Продажи по неделям».

ПОЧЕМУ ОТЧЁТ ПО ЗАКАЗАМ, А НЕ SALES_AND_TRAFFIC
Напрашивался `GET_SALES_AND_TRAFFIC_REPORT`: у него есть и `parentAsin`, и
готовая недельная нарезка. Но `dateGranularity` делит на недели ТОЛЬКО блок
`salesAndTrafficByDate`; блок `salesAndTrafficByAsin` приходит одним итогом за
весь запрошенный период, даты в его строках нет вообще (проверено живым
запросом 2026-08-19). Недельные продажи в разрезе ASIN означали бы один отчёт
на неделю на площадку — 13 × 13 = 169 отчётов при лимите 3 запроса на 5 минут,
это около пяти часов.

`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` отдаёт строки заказов
разом по всем площадкам одним отчётом, с `asin`, `quantity`, `item-price` и
`sales-channel`. Недели складываем сами.

ПОЧЕМУ СЕМЬИ, А НЕ РОДИТЕЛЬСКИЙ ASIN
У Amazon родитель свой на каждой площадке: у B0854MW97N в DE родитель
B0FCXS9PDP, в NL B0F4DVM11Y, в PL B0F6N6D6N2, а во FR родителя нет совсем.
Фильтр «Parent» по сырому значению давал бы на каждой площадке свой набор.
Поэтому дети, у которых хоть на одной площадке общий родитель, сшиваются в
одну **семью**; идентификатор семьи — самый частый родитель среди площадок.

ВЫХОД
data/weekly-sales.json — агрегаты неделя × площадка × ASIN. Идентификаторов
заказов и данных покупателей в выгрузке нет: репозиторий публичный.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import sync_log  # noqa: E402
from spapi.client import SPAPIClient, SPAPIError  # noqa: E402

OUT_PATH = PROJECT_ROOT / "data" / "weekly-sales.json"

REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL"
MARKETPLACE_DE = "A1PA6795UKMFR9"       # основная площадка аккаунта

# Отчёт по заказам отдаёт максимум 30 дней за запрос. Про превышение Amazon
# НЕ сообщает ошибкой: отчёт получает статус DONE, а в теле вместо таблицы
# лежит одна строка «Date range exceeded. Report can be requested only upto
# 30 days». Разобранный как обычный TSV, он даёт ноль продаж — то есть
# «продаж не было» вместо «выгрузка не удалась». Поэтому окно режется на
# куски, а тело каждого куска проверяется на заголовок.
MAX_REPORT_DAYS = 30

# Колонки, без которых считать нечего. Их отсутствие означает, что пришла не
# таблица, а сообщение Amazon.
REQUIRED_COLUMNS = {"purchase-date", "sales-channel", "asin", "quantity"}

DEFAULT_WEEKS = 14                      # 13 полных недель + текущая неполная

# Канал продажи в отчёте → код площадки. Отчёт пишет витрину («Amazon.de»),
# а не marketplaceId. Регистр у Amazon плавает между отчётами, поэтому
# сравнение идёт по нижнему регистру.
CHANNEL_TO_CODE = {
    "amazon.de": "DE", "amazon.fr": "FR", "amazon.it": "IT", "amazon.es": "ES",
    "amazon.co.uk": "GB", "amazon.nl": "NL", "amazon.com.be": "BE",
    "amazon.ie": "IE", "amazon.pl": "PL", "amazon.se": "SE",
    "amazon.com.tr": "TR", "amazon.ae": "AE", "amazon.sa": "SA",
}

# Площадки, с которых берём названия и связи товаров. Больше — дороже, а
# каталог у аккаунта общий: имя из DE годится как основное для всех.
CATALOG_MARKETPLACES = [
    ("DE", "A1PA6795UKMFR9"), ("FR", "A13V1IB3VIYZZH"), ("IT", "APJ6JRA9NG5V4"),
    ("ES", "A1RKKUPIHCS9HS"), ("GB", "A1F83G8C2ARO7P"), ("NL", "A1805IZSGTT6HS"),
    ("BE", "AMEN7PMS3EDWL"), ("IE", "A28R8C7NBKEWEA"), ("PL", "A1C3SOZRARQ6R3"),
    ("SE", "A2NODRKZP88ZB9"), ("TR", "A33AVAJ2PDY3EV"), ("AE", "A2VIGQ35RCS4UG"),
    ("SA", "A17E79C6D8DWNP"),
]

MARKETPLACE_NAMES = {
    "DE": "Amazon.de", "FR": "Amazon.fr", "IT": "Amazon.it", "ES": "Amazon.es",
    "GB": "Amazon.co.uk", "NL": "Amazon.nl", "BE": "Amazon.com.be",
    "IE": "Amazon.ie", "PL": "Amazon.pl", "SE": "Amazon.se",
    "TR": "Amazon.com.tr", "AE": "Amazon.ae", "SA": "Amazon.sa",
    "other": "Вне Amazon",
}


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Недельная сетка
# --------------------------------------------------------------------------

def week_start(day: date) -> date:
    """Понедельник этой недели.

    Недели ISO, а не воскресные, как в отчётах Amazon: аккаунт европейский, и
    в Seller Central продавец всё равно смотрит календарь, а не отчёт.
    Важно лишь, чтобы граница была одна во всей выгрузке.
    """
    return day - timedelta(days=day.weekday())


def build_weeks(weeks: int, today: date) -> list[dict]:
    """Последние N недель, включая текущую неполную.

    Текущая неделя помечается `partial`. Без пометки последний столбец графика
    читается как обвал продаж, хотя неделя просто ещё не кончилась — на этом
    уже теряли время в разборе промо.
    """
    current = week_start(today)
    first = current - timedelta(weeks=weeks - 1)
    out = []
    cursor = first
    while cursor <= current:
        end = cursor + timedelta(days=6)
        out.append({
            "start": cursor.isoformat(),
            "end": end.isoformat(),
            "partial": end > today,
        })
        cursor += timedelta(weeks=1)
    return out


# --------------------------------------------------------------------------
# Отчёт по заказам
# --------------------------------------------------------------------------

def check_body(text: str) -> None:
    """Убеждается, что пришла таблица, а не сообщение Amazon.

    Отчёт со статусом DONE может содержать одну строку текста вместо данных
    — так Amazon сообщает о превышении окна. Молча разобрать её как пустую
    таблицу нельзя: получится «продаж не было».
    """
    head = text.split("\n", 1)[0]
    columns = set(head.strip().split("\t"))
    if not REQUIRED_COLUMNS <= columns:
        raise ValueError(
            "в теле отчёта нет таблицы заказов. Amazon вернул: "
            + text[:200].strip().replace("\n", " ")
        )


def chunk_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Режет окно на куски не длиннее предела отчёта."""
    windows = []
    cursor = start
    while cursor <= end:
        last = min(cursor + timedelta(days=MAX_REPORT_DAYS - 1), end)
        windows.append((cursor, last))
        cursor = last + timedelta(days=1)
    return windows


def fetch_chunk(client: SPAPIClient, start: date, end: date) -> str:
    """Один отчёт за окно не длиннее предела. Возвращает тело."""
    report_id = client.create_report(
        REPORT_TYPE,
        [mid for _, mid in CATALOG_MARKETPLACES],
        start=f"{start}T00:00:00Z",
        end=f"{end}T23:59:59Z",
    )
    report = client.wait_for_report(report_id, timeout=1800)
    text = client.report_document(report["reportDocumentId"])
    check_body(text)
    return text


# --------------------------------------------------------------------------
# Разбор и агрегация
# --------------------------------------------------------------------------

def aggregate(texts: list[str], weeks: list[dict]) -> dict:
    """Строки заказов из всех кусков → суммы по неделя × площадка × ASIN."""
    index = {w["start"]: i for i, w in enumerate(weeks)}
    first, last = weeks[0]["start"], weeks[-1]["end"]

    cells: dict[tuple, dict] = defaultdict(
        lambda: {"u": 0, "r": 0.0, "d": 0.0, "o": set()})
    currency_of: dict[str, str] = {}
    unknown_channels: dict[str, int] = defaultdict(int)
    unpriced_units = 0
    skipped_cancelled = 0
    outside_window = 0
    parsed_rows = 0

    for text in texts:
        for row in csv.DictReader(io.StringIO(text), delimiter="\t"):
            parsed_rows += 1

            # Отменённое — не продажа. Статус позиции точнее статуса заказа:
            # в заказе из двух позиций отменить могли только одну.
            if (row.get("item-status") == "Cancelled"
                    or row.get("order-status") == "Cancelled"):
                skipped_cancelled += 1
                continue

            day = (row.get("purchase-date") or "")[:10]
            if not day or day < first or day > last:
                outside_window += 1
                continue

            week = index.get(week_start(date.fromisoformat(day)).isoformat())
            if week is None:
                outside_window += 1
                continue

            channel = (row.get("sales-channel") or "").strip().lower()
            code = CHANNEL_TO_CODE.get(channel)
            if code is None:
                # «Non-Amazon», «Non-Amazon DE» и всё незнакомое — отдельная
                # корзина, а не выброс: иначе итог «по всем площадкам» не
                # сойдётся с суммой столбцов, и объяснить разницу будет нечем.
                unknown_channels[row.get("sales-channel") or "?"] += 1
                code = "other"

            asin = (row.get("asin") or "").strip()
            if not asin:
                continue

            try:
                quantity = int(row.get("quantity") or 0)
            except ValueError:
                quantity = 0
            if quantity <= 0:
                continue

            cell = cells[(week, code, asin)]
            cell["u"] += quantity
            if row.get("amazon-order-id"):
                # Идентификатор нужен только чтобы не посчитать один заказ
                # дважды: в заказе бывает несколько позиций одного ASIN. В
                # выгрузку он не попадает — репозиторий публичный.
                cell["o"].add(row["amazon-order-id"])

            price = (row.get("item-price") or "").strip()
            if not price:
                # Без цены приходят продажи вне Amazon, и только они:
                # проверено на выгрузке за май — все 62 строки без цены имеют
                # канал Non-Amazon, и все строки Non-Amazon без цены. Штуки у
                # них настоящие, поэтому считаем их и признаёмся в разнице
                # отдельным числом, а не прячем расхождение.
                unpriced_units += quantity
                continue

            try:
                cell["r"] += float(price)
                cell["d"] += float(row.get("item-promotion-discount") or 0)
            except ValueError:
                unpriced_units += quantity
                continue

            currency = (row.get("currency") or "").strip()
            if currency:
                currency_of.setdefault(code, currency)

    rows = []
    for (week, code, asin), cell in sorted(cells.items()):
        rows.append({
            "w": week, "m": code, "a": asin,
            "u": cell["u"],
            "r": round(cell["r"], 2),
            "d": round(cell["d"], 2),
            "o": len(cell["o"]),
        })

    return {
        "rows": rows,
        "currencyOf": currency_of,
        "parsedRows": parsed_rows,
        "unpricedUnits": unpriced_units,
        "skippedCancelled": skipped_cancelled,
        "outsideWindow": outside_window,
        "unknownChannels": dict(unknown_channels),
    }


# --------------------------------------------------------------------------
# Каталог: названия и семьи вариаций
# --------------------------------------------------------------------------

def fetch_catalog(client: SPAPIClient, asins: list[str]) -> tuple[dict, dict]:
    """Названия товаров и связи «ребёнок → родитель» по каждой площадке.

    Один запрос на ASIN сразу по всем площадкам: `marketplaceIds` принимает
    список, и `relationships` возвращается блоком на каждую площадку.
    """
    ids = ",".join(mid for _, mid in CATALOG_MARKETPLACES)
    by_id = {mid: code for code, mid in CATALOG_MARKETPLACES}

    info: dict[str, dict] = {}
    parents: dict[str, dict[str, str]] = {}

    for i, asin in enumerate(asins, 1):
        try:
            item = client.get(f"/catalog/2022-04-01/items/{asin}", {
                "marketplaceIds": ids,
                "includedData": "relationships,summaries",
            })
        except SPAPIError as e:
            # Товар мог быть удалён из каталога — продажи по нему остаются.
            print(f"    {asin}: каталог не ответил ({e.status})")
            info[asin] = {"name": asin, "brand": ""}
            continue

        name, brand = "", ""
        for summary in item.get("summaries", []):
            code = by_id.get(summary.get("marketplaceId"))
            if summary.get("itemName") and (not name or code == "DE"):
                name = summary["itemName"]
                brand = summary.get("brand") or brand
        info[asin] = {"name": name or asin, "brand": brand}

        found = {}
        for block in item.get("relationships", []):
            code = by_id.get(block.get("marketplaceId"))
            for rel in block.get("relationships", []):
                for parent in rel.get("parentAsins") or []:
                    if code:
                        found[code] = parent
        if found:
            parents[asin] = found

        if i % 10 == 0:
            print(f"    каталог: {i}/{len(asins)}", flush=True)
        time.sleep(0.55)      # лимит getCatalogItem — 2 запроса в секунду

    return info, parents


def build_families(asins: list[str], parents: dict[str, dict[str, str]]) -> dict:
    """Сшивает детей в семьи вариаций.

    Родитель у Amazon свой на каждой площадке, поэтому «семья» — это класс
    эквивалентности: два ASIN в одной семье, если хоть на одной площадке у
    них общий родитель. Товар без родителя нигде — семья из самого себя.
    """
    parent_of: dict[str, str] = {}

    def find(x: str) -> str:
        while parent_of.setdefault(x, x) != x:
            parent_of[x] = parent_of[parent_of[x]]
            x = parent_of[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent_of[ra] = rb

    for asin in asins:
        find(asin)
    # Родительский ASIN участвует в объединении как обычный узел: два ребёнка
    # с общим родителем через него и склеиваются.
    for child, by_market in parents.items():
        for parent in set(by_market.values()):
            union(child, parent)

    groups: dict[str, list[str]] = defaultdict(list)
    for asin in asins:
        groups[find(asin)].append(asin)

    families = {}
    for members in groups.values():
        members.sort()
        # Идентификатор семьи — самый частый родитель среди площадок: он
        # устойчив и совпадает с тем, что продавец видит в Seller Central
        # на основной витрине. Если родителя нет вообще — сам ASIN.
        counts: dict[str, int] = defaultdict(int)
        for member in members:
            for parent in (parents.get(member) or {}).values():
                counts[parent] += 1
        family_id = (max(sorted(counts), key=lambda p: counts[p])
                     if counts else members[0])
        families[family_id] = {
            "asins": members,
            "parents": {m: parents.get(m, {}) for m in members if parents.get(m)},
        }
    return families


# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weeks", type=int, default=DEFAULT_WEEKS,
                        help=f"сколько недель собирать (по умолчанию {DEFAULT_WEEKS})")
    parser.add_argument("--no-catalog", action="store_true",
                        help="не ходить в каталог: названия и семьи взять из прошлой выгрузки")
    parser.add_argument("--source-file", action="append", metavar="TSV",
                        help="разобрать сохранённый TSV вместо запроса; можно повторять")
    args = parser.parse_args()

    started_at = sync_log.now_iso()
    today = now().date()
    weeks = build_weeks(args.weeks, today)
    window_start = date.fromisoformat(weeks[0]["start"])
    window_end = min(date.fromisoformat(weeks[-1]["end"]), today)

    print(f"Окно: {weeks[0]['start']} — {weeks[-1]['end']} ({len(weeks)} недель)")

    client = None
    try:
        if args.source_file:
            texts = [Path(f).read_text(encoding="utf-8", errors="replace")
                     for f in args.source_file]
            for text in texts:
                check_body(text)
            report_id = "files:" + ",".join(Path(f).name for f in args.source_file)
            print(f"  из файлов: {len(texts)}")
        else:
            client = SPAPIClient()
            windows = chunk_windows(window_start, window_end)
            print(f"  окно режется на {len(windows)} отчётов "
                  f"(предел Amazon — {MAX_REPORT_DAYS} дней на запрос)")
            texts = []
            for n, (chunk_start, chunk_end) in enumerate(windows, 1):
                print(f"  отчёт {n}/{len(windows)}: {chunk_start} — {chunk_end} …",
                      flush=True)
                texts.append(fetch_chunk(client, chunk_start, chunk_end))
            report_id = f"{len(windows)} chunks"

        result = aggregate(texts, weeks)
        print(f"  разобрано строк заказов: {result['parsedRows']}, "
              f"строк агрегата: {len(result['rows'])}, "
              f"отменённых пропущено: {result['skippedCancelled']}, "
              f"вне окна: {result['outsideWindow']}")

        # Пустой результат — это сбой выгрузки, а не «продаж не было». У
        # аккаунта с оборотом ноль продаж за квартал невозможен, а записанный
        # пустой файл выглядит в дашборде как честный ноль.
        if not result["rows"]:
            raise ValueError(
                f"выгрузка пустая: разобрано {result['parsedRows']} строк заказов, "
                "ни одна не попала в окно. Файл не перезаписан.")
        if result["unknownChannels"]:
            print(f"  каналы вне Amazon: {result['unknownChannels']}")
        if result["unpricedUnits"]:
            print(f"  штук без цены (Unshipped): {result['unpricedUnits']}")

        asins = sorted({row["a"] for row in result["rows"]})
        print(f"  товаров в продажах: {len(asins)}")

        previous = {}
        if OUT_PATH.exists():
            try:
                previous = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                previous = {}

        if args.no_catalog and previous.get("asins"):
            info = {a: previous["asins"].get(a, {"name": a, "brand": ""}) for a in asins}
            families = previous.get("families", {})
        else:
            if client is None:
                client = SPAPIClient()
            print("  каталог: названия и связи вариаций…", flush=True)
            info, parents = fetch_catalog(client, asins)
            families = build_families(asins, parents)

        family_of = {a: fid for fid, fam in families.items() for a in fam["asins"]}
        for asin, meta in info.items():
            meta["family"] = family_of.get(asin, asin)

        # Название семьи — по её самому продаваемому товару: у вариаций
        # названия отличаются только цветом и размером, и любое годится,
        # но выбранное по продажам совпадает с тем, что продавец узнаёт.
        units_by_asin: dict[str, int] = defaultdict(int)
        for row in result["rows"]:
            units_by_asin[row["a"]] += row["u"]
        for fid, family in families.items():
            lead = max(family["asins"], key=lambda a: (units_by_asin[a], a))
            family["label"] = info.get(lead, {}).get("name", fid)
            family["brand"] = info.get(lead, {}).get("brand", "")

        marketplaces = {}
        for code in sorted({row["m"] for row in result["rows"]}):
            marketplaces[code] = {
                "name": MARKETPLACE_NAMES.get(code, code),
                "currency": result["currencyOf"].get(code, ""),
            }

        payload = {
            "source": "spapi-orders-report",
            "reportId": report_id,
            "generatedAt": iso(now()),
            "periodStart": weeks[0]["start"],
            "periodEnd": weeks[-1]["end"],
            "weeks": weeks,
            "marketplaces": marketplaces,
            "families": families,
            "asins": info,
            "rows": result["rows"],
            # Расхождение между штуками и деньгами показываем числом, а не
            # умалчиваем: иначе сумма в евро не сойдётся со штуками, и
            # объяснить это будет нечем.
            "unpricedUnits": result["unpricedUnits"],
            "unknownChannels": result["unknownChannels"],
        }

        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                            encoding="utf-8")

        total_units = sum(row["u"] for row in result["rows"])
        print(f"\nШтук за период: {total_units:,}".replace(",", " "))
        print(f"Площадок: {len(marketplaces)}, семей вариаций: {len(families)}")
        print(f"Записано: {OUT_PATH.relative_to(PROJECT_ROOT)}")

        sync_log.append(
            source="amazon-weekly-sales",
            status=sync_log.STATUS_OK,
            started_at=started_at,
            mode=f"{len(weeks)}w",
            stats={"weeks": len(weeks), "rows": len(result["rows"]),
                   "units": total_units, "asins": len(asins),
                   "marketplaces": len(marketplaces)},
            message=f"Недельные продажи за {len(weeks)} недель: "
                    f"{total_units} шт. по {len(marketplaces)} площадкам.",
        )
        return 0

    except Exception as e:                                        # noqa: BLE001
        # Ловим всё, а не только ошибки SP-API: отсутствующие секреты дают
        # RuntimeError ещё до первого запроса, и без записи в журнале такой
        # сбой выглядит в интерфейсе как «данные почему-то старые».
        print(f"ОШИБКА: {type(e).__name__}: {e}", file=sys.stderr)
        sync_log.append(
            source="amazon-weekly-sales",
            status=sync_log.STATUS_ERROR,
            started_at=started_at,
            mode=f"{args.weeks}w",
            message="Недельные продажи собрать не удалось.",
            error={"type": type(e).__name__, "detail": str(e)[:400]},
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
