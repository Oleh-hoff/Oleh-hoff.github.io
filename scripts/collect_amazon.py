#!/usr/bin/env python3
"""Сбор продаж и расходов Amazon для CRM-дашборда «Анализ продаж».

ИСТОЧНИК
Finances API (listFinancialEvents) — единственный. Выручка и комиссии
приходят из одних и тех же событий, поэтому сходятся между собой. Склейка
Orders API с отчётом по комиссиям дала бы два ряда, которые не бьются:
у заказа своя дата, у комиссии — дата проводки.

ЧТО НА ВЫХОДЕ
crm/data/finance.json — агрегаты по (дата × площадка × валюта × статья).
Никаких идентификаторов заказов, покупателей и адресов: дашборд их не
показывает, а значит и хранить их незачем.

РЕЖИМЫ
  --from 2026-01-01     первичная выгрузка с начала года
  --resume              продолжить историю с места обрыва
  --incremental         добор нового (для крона раз в 4 часа)

Отметок прогресса две, и путать их нельзя: `lastPostedBefore` — докуда
добор догнал текущий момент, `reachedThrough` — докуда доехала выгрузка
истории. Добор двигает только первую: иначе он затирает прогресс истории,
следующий --resume начинает с сегодняшнего дня, и дыра остаётся навсегда.

Проводки, тип которых не описан в CATEGORIES, не теряются: они попадают
в статью «other» с сохранением исходного имени, и их видно в сводке.
Так новая комиссия Amazon не исчезнет из отчёта молча.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import sync_log  # noqa: E402
from spapi.client import SPAPIClient, SPAPIError  # noqa: E402
from spapi.config import Config  # noqa: E402

OUT_PATH = PROJECT_ROOT / "data" / "finance.json"
STATE_PATH = PROJECT_ROOT / "data" / "collector-state.json"

# Все площадки европейского региона, где продавец активен.
MARKETPLACES = {
    "A1PA6795UKMFR9": ("DE", "Amazon.de"),
    "A13V1IB3VIYZZH": ("FR", "Amazon.fr"),
    "APJ6JRA9NG5V4":  ("IT", "Amazon.it"),
    "A1RKKUPIHCS9HS": ("ES", "Amazon.es"),
    "A1F83G8C2ARO7P": ("GB", "Amazon.co.uk"),
    "A1805IZSGTT6HS": ("NL", "Amazon.nl"),
    "AMEN7PMS3EDWL":  ("BE", "Amazon.com.be"),
    "A28R8C7NBKEWEA": ("IE", "Amazon.ie"),
    "A1C3SOZRARQ6R3": ("PL", "Amazon.pl"),
    "A2NODRKZP88ZB9": ("SE", "Amazon.se"),
    "A33AVAJ2PDY3EV": ("TR", "Amazon.com.tr"),
    "A2VIGQ35RCS4UG": ("AE", "Amazon.ae"),
    "A17E79C6D8DWNP": ("SA", "Amazon.sa"),
}
# Событие приносит название площадки, а не её идентификатор
BY_NAME = {name.lower(): code for code, name in MARKETPLACES.values()}

# --------------------------------------------------------------------------
# Классификация статей.
#
# Ключ — тип начисления или комиссии как его называет Amazon, значение —
# статья нашего отчёта. Имена сверены с реальными ответами API, а не взяты
# из документации: в выгрузке встречаются типы, которых в справочнике нет.
# --------------------------------------------------------------------------
CATEGORIES = {
    # --- доход ---
    "Principal": "revenue",
    "Tax": "revenue_tax",
    "ShippingCharge": "revenue_shipping",
    "ShippingTax": "revenue_tax",
    "GiftWrap": "revenue_shipping",
    "GiftWrapTax": "revenue_tax",
    "GiftWrapChargeback": "fee_other",

    # --- комиссия за продажу (Referral Fee) ---
    "Commission": "fee_referral",
    "FixedClosingFee": "fee_referral",
    "VariableClosingFee": "fee_referral",
    "RenewedProgramFee": "fee_referral",
    "RefundCommission": "fee_referral",

    # --- логистика FBA ---
    "FBAPerUnitFulfillmentFee": "fee_fba",
    "FBAPerOrderFulfillmentFee": "fee_fba",
    "FBAWeightBasedFee": "fee_fba",
    "FBATransportationFee": "fee_fba",
    "ShippingChargeback": "fee_fba",
    "ShippingHB": "fee_fba",

    # --- размещение запасов (Placement Fee) ---
    "FBAInboundPlacementServiceFee": "fee_placement",
    "FBAInboundConvenienceFee": "fee_placement",

    # --- хранение ---
    "FBAStorageFee": "fee_storage",
    "StorageFee": "fee_storage",
    "FBALongTermStorageFee": "fee_storage",
    "StorageRenewalBilling": "fee_storage",
    "FBAAgedInventorySurcharge": "fee_storage",
    "FBADisposalFee": "fee_storage",
    "FBARemovalFee": "fee_storage",

    # --- доставка товара на склад Amazon ---
    # Обнаружены в реальной выгрузке, в справочнике типов их нет.
    "FBAInternationalInboundFreightFee": "fee_inbound",
    "FBAInternationalInboundFreightTaxAndDuty": "fee_inbound",
    "FBAInboundTransportationFee": "fee_inbound",
    "FBAInboundTransportationProgramFee": "fee_inbound",

    # --- участие в акциях и купоны ---
    "CouponPerformanceFee": "fee_promo",
    "CouponParticipationFee": "fee_promo",
    "DealParticipationFee": "fee_promo",
    "DealPerformanceFee": "fee_promo",
    "LightningDealFee": "fee_promo",

    # --- прочие сборы ---
    "DigitalServicesFee": "fee_other",
    "DigitalServicesFeeFBA": "fee_other",
    "Subscription": "fee_other",
    "SubscriptionFee": "fee_other",
    "HighVolumeListingFee": "fee_other",
}

# Статьи в порядке показа в отчёте
CATEGORY_ORDER = [
    "revenue", "revenue_shipping", "revenue_tax",
    "fee_referral", "fee_fba", "fee_placement", "fee_storage",
    "fee_inbound", "fee_ads", "fee_promo", "fee_other",
    "refund", "reimbursement", "adjustment", "other",
]


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def classify(type_name: str, default: str = "other") -> str:
    return CATEGORIES.get(type_name, default)


class Collector:
    def __init__(self, client: SPAPIClient, verbose: bool = True):
        self.client = client
        self.verbose = verbose
        # (дата, площадка, валюта, статья, тип) → сумма
        self.postings: dict[tuple, float] = defaultdict(float)
        self.unknown_types: dict[str, float] = defaultdict(float)
        self.pages = 0
        self.events = 0
        # Дошли ли до конца запрошенного диапазона. От этого зависит,
        # можно ли помечать выгрузку завершённой.
        self.reached_end = False

    # -- вспомогательное -------------------------------------------------
    def log(self, message: str) -> None:
        if self.verbose:
            print(message, flush=True)

    def add(self, date: str, marketplace: str, amount_obj: dict | None,
            type_name: str, category: str | None = None) -> None:
        """Регистрирует одну проводку. Пустые и нулевые суммы отбрасываем."""
        if not amount_obj:
            return
        try:
            value = float(amount_obj.get("CurrencyAmount") or 0)
        except (TypeError, ValueError):
            return
        if value == 0:
            return

        currency = amount_obj.get("CurrencyCode") or "?"
        cat = category or classify(type_name)
        if cat == "other":
            self.unknown_types[type_name] += value

        self.postings[(date, marketplace, currency, cat, type_name)] += value

    @staticmethod
    def date_of(event: dict, fallback: str) -> str:
        posted = event.get("PostedDate") or event.get("postedDate") or ""
        return posted[:10] if posted else fallback

    @staticmethod
    def marketplace_of(event: dict) -> str:
        name = (event.get("MarketplaceName") or "").strip().lower()
        return BY_NAME.get(name, name.upper() or "?")

    # -- разбор групп событий --------------------------------------------
    def parse_shipment_like(self, events: list, sign: float, fallback_date: str,
                            refund: bool) -> None:
        """ShipmentEventList и RefundEventList устроены одинаково."""
        for event in events or []:
            date = self.date_of(event, fallback_date)
            mp = self.marketplace_of(event)

            for item in event.get("ShipmentItemList") or []:
                for charge in item.get("ItemChargeList") or []:
                    self.add(date, mp, charge.get("ChargeAmount"),
                             charge.get("ChargeType", "?"),
                             "refund" if refund else None)
                for fee in item.get("ItemFeeList") or []:
                    self.add(date, mp, fee.get("FeeAmount"), fee.get("FeeType", "?"))
                for promo in item.get("PromotionList") or []:
                    self.add(date, mp, promo.get("PromotionAmount"),
                             "Promotion", "fee_other")

            # Сборы уровня заказа и отгрузки — мимо позиций
            for bucket in ("ShipmentFeeList", "OrderFeeList"):
                for fee in event.get(bucket) or []:
                    self.add(date, mp, fee.get("FeeAmount"), fee.get("FeeType", "?"))

    def parse_service_fees(self, events: list, fallback_date: str) -> None:
        """ServiceFeeEventList — здесь живут хранение, подписка, размещение."""
        for event in events or []:
            date = self.date_of(event, fallback_date)
            mp = self.marketplace_of(event)
            reason = event.get("FeeReason") or ""
            for fee in event.get("FeeList") or []:
                type_name = fee.get("FeeType") or reason or "ServiceFee"
                category = classify(type_name)
                if category == "other" and reason:
                    category = classify(reason)      # тип пуст — судим по причине
                self.add(date, mp, fee.get("FeeAmount"), type_name, category)

    def parse_adjustments(self, events: list, fallback_date: str) -> None:
        """AdjustmentEventList — возмещения Amazon и корректировки."""
        for event in events or []:
            date = self.date_of(event, fallback_date)
            mp = self.marketplace_of(event)
            adj_type = event.get("AdjustmentType") or "Adjustment"
            # Возмещение за утерянный или повреждённый товар — это доход
            category = "reimbursement" if "REIMBURSEMENT" in adj_type.upper() \
                or "WAREHOUSE_DAMAGE" in adj_type.upper() else "adjustment"
            self.add(date, mp, event.get("AdjustmentAmount"), adj_type, category)

    def parse_ads(self, events: list, fallback_date: str) -> None:
        for event in events or []:
            date = self.date_of(event, fallback_date)
            self.add(date, "?", event.get("transactionValue"),
                     event.get("transactionType") or "ProductAds", "fee_ads")

    def parse_simple(self, events: list, fallback_date: str, amount_key: str,
                     type_name: str, category: str) -> None:
        for event in events or []:
            date = self.date_of(event, fallback_date)
            mp = self.marketplace_of(event)
            self.add(date, mp, event.get(amount_key), type_name, category)

    def parse_group(self, groups: dict, fallback_date: str) -> None:
        self.parse_shipment_like(groups.get("ShipmentEventList"), 1, fallback_date, False)
        self.parse_shipment_like(groups.get("RefundEventList"), -1, fallback_date, True)
        self.parse_shipment_like(groups.get("GuaranteeClaimEventList"), -1, fallback_date, True)
        self.parse_shipment_like(groups.get("ChargebackEventList"), -1, fallback_date, True)
        self.parse_service_fees(groups.get("ServiceFeeEventList"), fallback_date)
        self.parse_adjustments(groups.get("AdjustmentEventList"), fallback_date)
        self.parse_ads(groups.get("ProductAdsPaymentEventList"), fallback_date)
        self.parse_simple(groups.get("SAFETReimbursementEventList"), fallback_date,
                          "ReimbursedAmount", "SAFETReimbursement", "reimbursement")
        self.parse_simple(groups.get("ServiceProviderCreditEventList"), fallback_date,
                          "TransactionAmount", "ServiceProviderCredit", "adjustment")

        for group in groups.values():
            if isinstance(group, list):
                self.events += len(group)

    # -- выгрузка --------------------------------------------------------
    def fetch_window(self, start: datetime, end: datetime) -> None:
        """Одно окно дат с постраничным обходом.

        Лимит listFinancialEvents — 0.5 запроса в секунду. Клиент сам
        отрабатывает 429, но лучше не доводить: пауза дешевле ретрая.
        """
        params = {
            "PostedAfter": iso(start),
            "PostedBefore": iso(end),
            "MaxResultsPerPage": 100,
        }
        fallback = start.date().isoformat()
        token = None

        while True:
            # С NextToken другие параметры слать нельзя — API вернёт ошибку
            query = {"NextToken": token} if token else params
            try:
                response = self.client.get("/finances/v0/financialEvents", params=query)
            except SPAPIError as e:
                self.log(f"      ошибка на странице {self.pages + 1}: {e}")
                raise

            payload = response.get("payload", {})
            self.parse_group(payload.get("FinancialEvents", {}) or {}, fallback)
            self.pages += 1

            token = payload.get("NextToken")
            if not token:
                break
            time.sleep(2.0)

    def run(self, start: datetime, end: datetime, chunk_days: int = 15,
            checkpoint=None, max_chunks: int | None = None) -> None:
        """Год режем на окна: короткая цепочка токенов переживает сбой сети.

        После каждого окна вызываем checkpoint. Выгрузка за год идёт часами,
        и обрыв на середине не должен обнулять уже собранное.
        """
        cursor = start
        total_chunks = max(1, (end - start).days // chunk_days + 1)
        index = 0

        while cursor < end:
            stop = min(cursor + timedelta(days=chunk_days), end)
            index += 1
            self.log(f"  [{index}/{total_chunks}] {cursor.date()} → {stop.date()}")
            self.fetch_window(cursor, stop)
            self.log(f"        страниц: {self.pages}, событий: {self.events}, "
                     f"проводок: {len(self.postings)}")
            if checkpoint:
                checkpoint(stop)
            cursor = stop

            # Обрыв длинной выгрузки стоит дорого: результат коммитится только
            # после выхода из скрипта, поэтому многочасовой запуск, снятый
            # планировщиком, теряет всё. Ограничение делает запуск коротким,
            # а год добирается за несколько заходов.
            if max_chunks and index >= max_chunks:
                self.log(f"  Достигнут предел в {max_chunks} окон за запуск. "
                         f"Собрано до {stop.date()}, продолжить: --resume")
                return

            time.sleep(2.0)

        self.reached_end = True

    # -- результат -------------------------------------------------------
    def to_rows(self) -> list[dict]:
        rows = [
            {"date": d, "marketplace": mp, "currency": cur,
             "category": cat, "type": t, "amount": round(v, 2)}
            for (d, mp, cur, cat, t), v in sorted(self.postings.items())
            if round(v, 2) != 0
        ]
        return rows


def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except (ValueError, OSError):
            pass
    return {}


def main() -> int:
    # Время старта нужно журналу: длительность запуска — первый признак того,
    # что Amazon начал отвечать медленно или упираться в лимиты.
    started_at = sync_log.now_iso()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", help="начальная дата YYYY-MM-DD")
    parser.add_argument("--incremental", action="store_true",
                        help="добрать с последней отметки")
    parser.add_argument("--resume", action="store_true",
                        help="продолжить прерванную выгрузку с последнего сохранённого окна")
    parser.add_argument("--overlap-days", type=int, default=3,
                        help="перекрытие при доборе: проводки приходят задним числом")
    parser.add_argument("--chunk-days", type=int, default=15)
    parser.add_argument("--max-chunks", type=int, default=None,
                        help="сколько окон обработать за один запуск "
                             "(остальное — следующим --resume)")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    state = load_state()

    # Продолжение и добор оба дописывают к уже собранному, а не затирают его
    merge_with_existing = args.incremental or args.resume

    if args.resume:
        reached = state.get("reachedThrough")
        if not reached:
            print("Нет отметки прерванной выгрузки — запускайте с --from.")
            return 1
        # Перекрытие в одно окно: последнее сохранение могло случиться
        # раньше, чем окно закрылось полностью
        start = datetime.fromisoformat(reached.replace("Z", "+00:00")) \
            - timedelta(days=1)
    elif args.incremental:
        last = state.get("lastPostedBefore")
        if not last:
            print("Нет отметки предыдущего запуска — сначала выгрузка с --from.")
            return 1
        start = datetime.fromisoformat(last.replace("Z", "+00:00")) \
            - timedelta(days=args.overlap_days)
    elif args.start:
        start = datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc)
    else:
        start = datetime(now.year, 1, 1, tzinfo=timezone.utc)

    # Finances не отдаёт события за последние две минуты — просим с запасом
    end = now - timedelta(minutes=5)

    print("=" * 70)
    print(f"Сбор финансовых событий Amazon: {start.date()} → {end.date()}")
    mode_name = ("добор нового" if args.incremental
                 else "продолжение истории" if args.resume
                 else "полная выгрузка")
    print(f"Режим: {mode_name}"
          + (f", не больше {args.max_chunks} окон" if args.max_chunks else ""))
    print("=" * 70)

    mode_key = ("incremental" if args.incremental
                else "resume" if args.resume else "full")

    try:
        client = SPAPIClient(Config.from_env())
    except (RuntimeError, ValueError) as e:
        sync_log.append(
            source="amazon-spapi", status=sync_log.STATUS_ERROR,
            started_at=started_at, mode=mode_key,
            message="Не удалось прочитать настройки подключения к Amazon.",
            error={"type": type(e).__name__, "detail": str(e)})
        print(f"ОСТАНОВКА: {e}")
        return 1

    if client.config.sandbox:
        sync_log.append(
            source="amazon-spapi", status=sync_log.STATUS_ERROR,
            started_at=started_at, mode=mode_key,
            message="Подключение настроено на песочницу — реальных данных там нет.",
            error={"type": "sandbox-mode",
                   "detail": "Переменная окружения SPAPI_ENV не равна production."})
        print("ОСТАНОВКА: конфигурация в режиме sandbox, реальных данных там нет.")
        print("Задайте SPAPI_ENV=production.")
        return 1

    collector = Collector(client)
    started = time.time()

    # Строки предыдущих запусков, к которым дописываемся. Даты, попавшие в
    # текущее окно, берутся из свежей выгрузки — Amazon правит проводки
    # задним числом, и старое значение за тот же день устарело.
    base_rows: list[dict] = []
    if merge_with_existing and OUT_PATH.exists():
        try:
            base_rows = json.loads(OUT_PATH.read_text()).get("rows", [])
            print(f"Продолжаем поверх {len(base_rows)} уже собранных строк.")
        except (ValueError, OSError):
            print("Прежний файл нечитаем — собираем заново.")

    def merged_rows() -> list[dict]:
        fresh = collector.to_rows()
        if not base_rows:
            return fresh
        fresh_dates = {r["date"] for r in fresh}
        kept = [r for r in base_rows if r["date"] not in fresh_dates]
        return sorted(kept + fresh, key=lambda r: (r["date"], r["marketplace"], r["type"]))

    def write_snapshot(reached: datetime) -> None:
        """Сохранение после каждого окна.

        Пишет и данные, и отметку достигнутой даты: без отметки прерванную
        выгрузку нельзя продолжить с места обрыва, а только начать заново.
        """
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        rows_now = merged_rows()
        OUT_PATH.write_text(json.dumps({
            "source": "spapi-finances",
            "generatedAt": iso(datetime.now(timezone.utc)),
            "complete": False,
            "periodStart": min((r["date"] for r in rows_now),
                               default=start.date().isoformat()),
            "periodEnd": reached.date().isoformat(),
            "marketplaces": {code: name for code, name in MARKETPLACES.values()},
            "categoryOrder": CATEGORY_ORDER,
            "rows": rows_now,
        }, ensure_ascii=False, indent=1), encoding="utf-8")

        # Отметку истории двигает только историческая выгрузка. Добор её
        # не трогает: иначе следующий --resume начнёт с сегодняшнего дня,
        # и дыра в истории останется навсегда — ровно это и произошло.
        if not args.incremental:
            saved = load_state()
            saved.update({
                "reachedThrough": iso(reached),
                "complete": False,
                "lastRunAt": iso(datetime.now(timezone.utc)),
                "pages": collector.pages,
            })
            STATE_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=1),
                                  encoding="utf-8")

    interrupted: SPAPIError | None = None
    try:
        collector.run(start, end, chunk_days=args.chunk_days,
                      checkpoint=write_snapshot, max_chunks=args.max_chunks)
    except SPAPIError as e:
        interrupted = e
        print(f"\nВыгрузка прервана: {e}")
        if not collector.postings:
            sync_log.append(
                source="amazon-spapi", status=sync_log.STATUS_ERROR,
                started_at=started_at, mode=mode_key,
                message="Amazon не отдал ни одной проводки — данные не обновлены.",
                error={"type": "SPAPIError", "http": e.status,
                       "path": e.path, "detail": str(e)})
            return 1
        print("Сохраняю то, что успели собрать.")

    rows = merged_rows()
    if base_rows:
        print(f"Слияние: было {len(base_rows)} строк, стало {len(rows)}.")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "source": "spapi-finances",
        "generatedAt": iso(now),
        "complete": collector.reached_end,
        "periodStart": min((r["date"] for r in rows), default=start.date().isoformat()),
        "periodEnd": max((r["date"] for r in rows), default=end.date().isoformat()),
        "marketplaces": {code: name for code, name in MARKETPLACES.values()},
        "categoryOrder": CATEGORY_ORDER,
        "rows": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # Две независимые отметки, и путать их нельзя:
    #   lastPostedBefore — докуда добор догнал текущий момент;
    #   reachedThrough   — докуда доехала выгрузка истории.
    # Добор двигает только первую, иначе затирает прогресс истории.
    final_state = load_state()
    final_state.update({
        "lastPostedBefore": iso(end),
        "lastRunAt": iso(now),
        "pages": collector.pages,
        "events": collector.events,
    })
    if not args.incremental:
        final_state["reachedThrough"] = iso(end) if collector.reached_end \
            else final_state.get("reachedThrough")
        final_state["complete"] = collector.reached_end

    STATE_PATH.write_text(json.dumps(final_state, ensure_ascii=False, indent=1),
                          encoding="utf-8")

    elapsed = time.time() - started
    print("\n" + "=" * 70)
    print(f"Готово за {elapsed / 60:.1f} мин · страниц {collector.pages} · "
          f"событий {collector.events} · строк {len(rows)}")
    print(f"Записано: {OUT_PATH.relative_to(PROJECT_ROOT)}")

    if collector.unknown_types:
        print("\nТипы, которых нет в классификаторе (попали в «прочее»):")
        for name, value in sorted(collector.unknown_types.items(), key=lambda x: -abs(x[1])):
            print(f"   {name:44} {value:12.2f}")

    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row["category"]] += row["amount"]
    print("\nИтоги по статьям (сумма всех валют, без пересчёта):")
    for category in CATEGORY_ORDER:
        if category in totals:
            print(f"   {category:22} {totals[category]:14.2f}")

    # Запись в журнал. «Успешно» ставим только когда данные действительно
    # получены целиком: заход, оборвавшийся по лимиту окон или по ошибке
    # Amazon, — это «частично», и в интерфейсе он не должен выглядеть
    # зелёной галочкой.
    days = len({row["date"] for row in rows})
    stats = {
        "pages": collector.pages,
        "events": collector.events,
        "rows": len(rows),
        "days": days,
        "periodStart": min((r["date"] for r in rows), default=None),
        "periodEnd": max((r["date"] for r in rows), default=None),
        "historyComplete": collector.reached_end,
        "unknownTypes": sorted(collector.unknown_types),
    }

    if interrupted is not None:
        status = sync_log.STATUS_PARTIAL
        message = "Amazon прервал выгрузку — сохранено то, что успели получить."
        error = {"type": "SPAPIError", "http": interrupted.status,
                 "path": interrupted.path, "detail": str(interrupted)}
    elif not collector.reached_end:
        status = sync_log.STATUS_PARTIAL
        message = (f"Заход дошёл до {stats['periodEnd']} и остановился по лимиту окон. "
                   "История добирается следующим запуском в режиме resume.")
        error = None
    else:
        status = sync_log.STATUS_OK
        message = (f"Получено {len(rows)} проводок за {days} дн. "
                   f"({stats['periodStart']} — {stats['periodEnd']}).")
        error = None

    entry = sync_log.append(
        source="amazon-spapi", status=status, started_at=started_at,
        mode=mode_key, stats=stats, error=error, message=message)
    print(f"\nВ журнал записано: {entry['status']} — {entry['message']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
