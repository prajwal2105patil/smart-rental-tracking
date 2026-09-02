"""
Put the database back to the state the demo script describes.

    cd starter
    export DATABASE_URL="postgresql://postgres.<ref>:<password>@...pooler.supabase.com:5432/postgres"
    python db/restore_baseline.py            # restore
    python db/restore_baseline.py --check    # report drift, change nothing

WHY THIS EXISTS. Once the API reads from Postgres, `POST /reset` no longer returns the
demo to its opening state: reset reloads from the store, and the store is the database,
which remembers every check-in anyone has done. That is the write-back working correctly
and it is exactly what makes a rehearsal destructive - each practice run moves the
headline figures off the numbers printed in pitch/value_model.md.

Run this immediately before presenting, then restart the API so it re-reads.

WHAT IT TOUCHES. Only what drifts:

  events          rows whose event_id is not in seed_events.json are deleted
  assets          every mutable column reset from seed_assets.json
  hire_requests   emptied

Telemetry, the catalogue tables, the source manifest and app_users are never touched -
nothing in the demo mutates them, so there is nothing to restore. The delete is scoped
by primary key against the seed file rather than by date or by a "looks like test data"
guess, so it cannot take a row the demo shipped with.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
from datetime import date, datetime
from decimal import Decimal

try:
    import psycopg2
    from psycopg2.extras import Json, execute_batch
except ImportError:                                       # pragma: no cover
    sys.exit("psycopg2 is not installed.  pip install psycopg2-binary")

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / "data"

# The columns a demo can actually change. Identity, telemetry counters and the rate are
# included because a usage log or a config change moves them too.
MUTABLE = [
    "site_id", "operator_id", "on_rent", "check_out_date", "check_in_date",
    "engine_hours_day", "idle_hours_day", "operating_days",
    "cumulative_operating_hours", "hours_since_service", "day_rate", "condition_grade",
]


def seed(name: str) -> list:
    path = DATA / name
    if not path.exists():
        sys.exit(f"{path} is missing — cannot restore without the seed files.")
    return json.loads(path.read_text(encoding="utf-8"))


def connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit(
            "\nDATABASE_URL is not set, so there is no database to restore.\n"
            "  If you are running the API on the JSON seeds, they are already pristine —\n"
            "  nothing writes to them, so there is nothing to do.\n"
        )
    return psycopg2.connect(url)


def main() -> None:
    check_only = "--check" in sys.argv
    events, assets = seed("seed_events.json"), seed("seed_assets.json")
    keep = tuple(e["event_id"] for e in events)

    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("select count(*) from events where event_id not in %s", (keep,))
    stray = cur.fetchone()[0]
    cur.execute("select count(*) from hire_requests")
    requests = cur.fetchone()[0]

    def same(want, got) -> bool:
        """Compare a seed value against what Postgres hands back.

        Naive string comparison reports every row as drifted on a clean database:
        the driver returns Decimal('1.50') where the seed holds 1.5, and date objects
        where the seed holds "2025-04-01". Normalise both sides before judging.
        """
        if want is None or got is None:
            return want is None and got is None
        if isinstance(got, (int, float, Decimal)) or isinstance(want, (int, float)):
            try:
                return abs(float(want) - float(got)) < 1e-9
            except (TypeError, ValueError):
                pass
        if isinstance(got, (date, datetime)):
            return str(want) == got.isoformat()[:len(str(want))]
        return str(want) == str(got)

    # An asset has drifted when any mutable column no longer matches its seeded payload.
    seeded = {a["equipment_id"]: a for a in assets}
    cur.execute("select equipment_id, " + ",".join(MUTABLE) + " from assets")
    drifted = []
    for row in cur.fetchall():
        want = seeded.get(row[0])
        if not want:
            continue
        for col, got in zip(MUTABLE, row[1:]):
            if not same(want.get(col), got):
                drifted.append(row[0])
                break

    print(f"drift against the seed baseline:")
    print(f"  events not in the seed   {stray:>4}")
    print(f"  assets changed           {len(drifted):>4}"
          f"{'   ' + ', '.join(sorted(drifted)[:6]) if drifted else ''}")
    print(f"  hire requests raised     {requests:>4}")

    if check_only:
        print("\n--check: nothing was changed.")
        conn.close()
        return

    if not (stray or drifted or requests):
        print("\nAlready at the baseline. Nothing to do.")
        conn.close()
        return

    cur.execute("delete from events where event_id not in %s", (keep,))
    removed = cur.rowcount

    execute_batch(
        cur,
        "update assets set " + ",".join(f"{c}=%s" for c in MUTABLE)
        + ", payload=%s where equipment_id=%s",
        [tuple([a.get(c) for c in MUTABLE] + [Json(a), a["equipment_id"]]) for a in assets],
        page_size=100,
    )

    cur.execute("delete from hire_requests")
    cleared = cur.rowcount

    conn.commit()
    print(f"\nremoved {removed} event(s) · reset {len(assets)} asset rows · "
          f"cleared {cleared} hire request(s)")

    for table in ("assets", "telemetry", "events", "hire_requests"):
        cur.execute(f"select count(*) from {table}")
        print(f"  {table:<16}{cur.fetchone()[0]:>6}")

    print("\nRestart the API so it re-reads the restored database:")
    print("  cd api && python -m uvicorn main:app --port 8000")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
