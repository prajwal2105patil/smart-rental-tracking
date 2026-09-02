"""
Push everything this project holds into Supabase (PostgreSQL).

    cd starter
    export DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
    python db/load_supabase.py            # creates the schema, then loads
    python db/load_supabase.py --verify   # counts only, changes nothing

Idempotent: every table is upserted on its primary key, so running it twice leaves the
same rows rather than duplicates. Telemetry is the exception - it has no natural key, so
it is replaced wholesale for the assets being loaded.

Nothing here is required for the demo to run. The API reads Postgres when DATABASE_URL
is set and the JSON seeds when it is not, and both paths return identical records.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

try:
    import psycopg2
    from psycopg2.extras import Json, execute_batch
except ImportError:                                       # pragma: no cover
    sys.exit("psycopg2 is not installed.  pip install psycopg2-binary")

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / "data"
SCHEMA = HERE / "schema.sql"


def read(name: str) -> list:
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        sys.exit(
            "\nDATABASE_URL is not set.\n\n"
            "  In Supabase: Project Settings -> Database -> Connection string -> URI\n"
            "  It looks like:\n"
            "    postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres\n\n"
            "  Then:  export DATABASE_URL=\"...\"  &&  python db/load_supabase.py\n"
        )
    return psycopg2.connect(url)


def upsert(cur, table: str, key: str, cols: list[str], rows: list[tuple]) -> int:
    if not rows:
        return 0
    placeholders = ",".join(["%s"] * len(cols))
    updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != key)
    sql = (f"insert into {table} ({','.join(cols)}) values ({placeholders}) "
           f"on conflict ({key}) do update set {updates}")
    execute_batch(cur, sql, rows, page_size=500)
    return len(rows)


def main() -> None:
    verify_only = "--verify" in sys.argv
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()

    if not verify_only:
        print("creating schema ...")
        cur.execute(SCHEMA.read_text(encoding="utf-8"))

        # ---------------------------------------------------------------- assets
        assets = [a for a in read("seed_assets.json")]
        cols = ["equipment_id", "type", "model", "serial_number", "site_id", "operator_id",
                "on_rent", "check_out_date", "check_in_date", "engine_hours_day",
                "idle_hours_day", "operating_days", "cumulative_operating_hours",
                "hours_since_service", "day_rate", "condition_grade", "payload"]
        rows = [tuple([a.get(c) for c in cols[:-1]] + [Json(a)]) for a in assets]
        print(f"  assets                 {upsert(cur, 'assets', 'equipment_id', cols, rows):>6}")

        # ---------------------------------------------------------------- telemetry
        tel = read("seed_telemetry.json")
        cur.execute("delete from telemetry")
        tcols = ["equipment_id", "reading_at", "latitude", "longitude",
                 "cumulative_operating_hours", "cumulative_idle_hours",
                 "fuel_remaining_percent", "fuel_used_litres", "engine_coolant_temp_c",
                 "fault_codes", "payload"]
        trows = [(t["equipment_id"], t["datetime"], t.get("latitude"), t.get("longitude"),
                  t.get("cumulative_operating_hours"), t.get("cumulative_idle_hours"),
                  t.get("fuel_remaining_percent"), t.get("fuel_used_litres"),
                  t.get("engine_coolant_temp_c"), Json(t.get("fault_codes", [])), Json(t))
                 for t in tel]
        execute_batch(cur,
                      f"insert into telemetry ({','.join(tcols)}) "
                      f"values ({','.join(['%s'] * len(tcols))})", trows, page_size=1000)
        print(f"  telemetry              {len(trows):>6}")

        # ---------------------------------------------------------------- events
        ev = read("seed_events.json")
        ecols = ["event_id", "occurred_at", "equipment_id", "event_type", "actor",
                 "site_id", "operator_id", "condition_grade", "notes", "payload"]
        erows = [(e["event_id"], e["timestamp"], e["equipment_id"], e["event_type"],
                  e.get("actor", "seed"), e.get("site_id"), e.get("operator_id"),
                  e.get("condition_grade"), e.get("notes"), Json(e)) for e in ev]
        print(f"  events                 {upsert(cur, 'events', 'event_id', ecols, erows):>6}")

        # ---------------------------------------------------------------- bookings
        bk = read("seed_bookings.json")
        bcols = ["booking_id", "customer", "equipment_type", "site_id",
                 "needed_from", "days", "status", "payload"]
        brows = [tuple([b.get(c) for c in bcols[:-1]] + [Json(b)]) for b in bk]
        print(f"  bookings               {upsert(cur, 'bookings', 'booking_id', bcols, brows):>6}")

        # ------------------------------------------- catalogue, derived from the CSV
        sk = read("catalogue_skus.json")
        scols = ["product_key", "description", "category", "brand", "duty_type",
                 "cost", "price", "payload"]
        srows = [tuple([s.get(c) for c in scols[:-1]] + [Json(s)]) for s in sk]
        print(f"  catalogue_skus         {upsert(cur, 'catalogue_skus', 'product_key', scols, srows):>6}")

        br = read("catalogue_branches.json")
        rcols = ["store_id", "city", "country", "payload"]
        rrows = [tuple([b.get(c) for c in rcols[:-1]] + [Json(b)]) for b in br]
        print(f"  catalogue_branches     {upsert(cur, 'catalogue_branches', 'store_id', rcols, rrows):>6}")

        cs = read("catalogue_customers.json")
        cur.execute("delete from catalogue_customers")
        crows = [(c.get("customer_name") or c.get("CustomerName"),
                  c.get("industry") or c.get("Industry"), Json(c)) for c in cs]
        execute_batch(cur, "insert into catalogue_customers (customer_name, industry, payload) "
                           "values (%s,%s,%s)", crows, page_size=500)
        print(f"  catalogue_customers    {len(crows):>6}")

        # ------------------------------------------------- provenance of that CSV
        man = json.loads((DATA / "source_manifest.json").read_text(encoding="utf-8"))
        mcols = ["filename", "sha256", "size_bytes", "rows", "distinct_product_keys",
                 "distinct_stores", "distinct_brands", "caterpillar_row_share_pct",
                 "transaction_date_min", "transaction_date_max", "payload"]
        mrow = [tuple([man.get(c) for c in mcols[:-1]] + [Json(man)])]
        print(f"  source_manifest        {upsert(cur, 'source_manifest', 'filename', mcols, mrow):>6}")

        # ---------------------------------------------------------------- people
        # Seeded so the sign-in screen has real names behind it. No passwords, ever -
        # the dealer access key is checked by the server, not stored per user.
        people = [
            ("Prajwal Patil",       "OPS_LEAD", None,   "Dealer operations"),
            ("Mahantappa R Patted", "OPS_LEAD", None,   "Dealer operations"),
            ("Tanish Balwal L",     "YARD",     None,   "Dealer yard"),
            ("Neerav Babel",        "YARD",     None,   "Dealer yard"),
            ("Rane Constructions",  "VIEWER",   "S003", "Customer"),
            ("Deshmukh Infra",      "VIEWER",   "S001", "Customer"),
            ("Kohli Earthworks",    "VIEWER",   "S002", "Customer"),
        ]
        execute_batch(cur,
                      "insert into app_users (name, role, site_id, organisation) "
                      "values (%s,%s,%s,%s) on conflict (name, role) do update set "
                      "site_id=excluded.site_id, organisation=excluded.organisation",
                      people)
        print(f"  app_users              {len(people):>6}")

        conn.commit()

    # ---------------------------------------------------------------- verify
    print("\nin the database now:")
    for t in ("assets", "telemetry", "events", "bookings", "catalogue_skus",
              "catalogue_branches", "catalogue_customers", "source_manifest",
              "app_users", "hire_requests"):
        cur.execute(f"select count(*) from {t}")
        print(f"  {t:<22} {cur.fetchone()[0]:>6}")

    cur.execute("select status_projection, count(*) from v_fleet_now group by 1 order by 2 desc")
    print("\nv_fleet_now — status projected in SQL, matching the API:")
    for status, n in cur.fetchall():
        print(f"  {status:<12} {n}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
