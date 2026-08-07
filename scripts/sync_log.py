#!/usr/bin/env python3
"""Журнал синхронизаций для всех интеграций дашборда.

Одна запись — один запуск сбора данных: когда, сколько длился, чем
закончился, что именно пошло не так. Пишется и при успехе, и при провале:
сбой, о котором нигде не осталось следа, выглядит как «данные почему-то
старые», и разбираться приходится вслепую.

Файл data/sync-log.json читает страница логов и колокольчик в шапке.

Может вызываться как модуль (из сборщика) и как команда — из рабочего
процесса, чтобы дописать запись, когда сборщик упал и записать её не успел.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_PATH = PROJECT_ROOT / "data" / "sync-log.json"

# Сколько записей храним. Больше не нужно: при обновлении раз в 4 часа это
# около двух месяцев истории, а файл целиком грузится в браузер.
MAX_ENTRIES = 400

STATUS_OK = "ok"           # всё получено
STATUS_PARTIAL = "partial" # получено не всё: прервано по лимиту или частично
STATUS_ERROR = "error"     # не получено ничего


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load() -> dict:
    if LOG_PATH.exists():
        try:
            data = json.loads(LOG_PATH.read_text(encoding="utf-8"))
            if isinstance(data.get("entries"), list):
                return data
        except (ValueError, OSError):
            pass
    return {"version": 1, "entries": []}


def save(data: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    data["entries"] = data["entries"][-MAX_ENTRIES:]
    data["updatedAt"] = now_iso()
    LOG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def run_context() -> dict:
    """Откуда запущено. В GitHub Actions есть ссылка на конкретный запуск."""
    run_id = os.getenv("GITHUB_RUN_ID")
    repo = os.getenv("GITHUB_REPOSITORY")
    return {
        "runId": run_id,
        "runUrl": f"https://github.com/{repo}/actions/runs/{run_id}" if run_id and repo else None,
        "trigger": os.getenv("GITHUB_EVENT_NAME") or "local",
    }


def append(*, source: str, status: str, started_at: str, mode: str = "",
           stats: dict | None = None, error: dict | None = None,
           message: str = "") -> dict:
    """Добавляет запись. Возвращает её же — удобно для печати в лог запуска."""
    ctx = run_context()
    entry = {
        "id": f"{ctx['runId'] or 'local'}-{source}-{started_at}",
        "source": source,
        "status": status,
        "mode": mode,
        "startedAt": started_at,
        "finishedAt": now_iso(),
        "message": message,
        "stats": stats or {},
        "error": error,
        **ctx,
    }

    started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    finished = datetime.fromisoformat(entry["finishedAt"].replace("Z", "+00:00"))
    entry["durationSec"] = int((finished - started).total_seconds())

    data = load()
    data["entries"].append(entry)
    save(data)
    return entry


def has_entry_for_run(run_id: str | None, source: str) -> bool:
    """Записал ли уже кто-то результат этого запуска.

    Нужно рабочему процессу: он дописывает запись только если сборщик
    не успел этого сделать — например, был убит по таймауту.
    """
    if not run_id:
        return False
    return any(e.get("runId") == run_id and e.get("source") == source
               for e in load()["entries"])


def main() -> int:
    """Запись из рабочего процесса, когда сборщик завершился аварийно."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="amazon-spapi")
    parser.add_argument("--status", required=True,
                        help="итог шага: success | failure | cancelled")
    parser.add_argument("--mode", default="")
    parser.add_argument("--started-at", default=now_iso())
    parser.add_argument("--message", default="")
    args = parser.parse_args()

    run_id = os.getenv("GITHUB_RUN_ID")
    if has_entry_for_run(run_id, args.source):
        print("Запись об этом запуске уже есть — ничего не добавляем.")
        return 0

    # Сюда попадаем, только если сборщик не дошёл до собственной записи:
    # упал жёстко, был снят по таймауту или отменён.
    reasons = {
        "failure": ("Сборщик завершился аварийно и не оставил записи. "
                    "Обычные причины: истёк refresh_token, отозвана авторизация "
                    "приложения, Amazon отвечал ошибкой дольше, чем длились повторы."),
        "cancelled": ("Запуск был отменён — обычно его вытеснил следующий запуск "
                      "по расписанию. Собранное за этот заход не сохранено."),
        "success": "Шаг завершился успешно, но сборщик не оставил записи.",
    }
    status = STATUS_ERROR if args.status in ("failure", "cancelled") else STATUS_PARTIAL

    entry = append(
        source=args.source,
        status=status,
        started_at=args.started_at,
        mode=args.mode,
        message=reasons.get(args.status, args.status),
        error={"type": f"workflow-{args.status}",
               "detail": "Подробности — в журнале запуска GitHub Actions."},
    )
    print(f"Добавлена запись: {entry['status']} — {entry['message']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
