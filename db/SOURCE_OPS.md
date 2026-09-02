# Running the demo against Supabase

Two scripts, in the order you need them.

## Once, when the project is created

```bash
export DATABASE_URL="postgresql://postgres.<ref>:<password>@...pooler.supabase.com:5432/postgres"
python db/load_supabase.py
```

Creates the schema and loads 15,941 rows across ten tables. Idempotent — safe to re-run.

If the password contains `@`, `#`, `/`, `:` or `?` it must be percent-encoded inside the
URI, or the string parses at the wrong character. `@` becomes `%40`.

## Immediately before you present

```bash
python db/restore_baseline.py --check    # what has drifted?
python db/restore_baseline.py            # put it back
cd api && python -m uvicorn main:app --port 8000
```

**Why this is necessary.** Once the API reads from Postgres, `POST /reset` no longer
restores the opening state — reset reloads from the store, the store is the database, and
the database remembers every check-in. That is the write-back working; it is also what
makes rehearsal destructive. One practice run moves the headline figures off the numbers
printed in `pitch/value_model.md`.

The figures the board must show, verified after a restore:

| | |
|---|---|
| Headline | 9 things need you today |
| Anomalies | 15 |
| Fleet utilisation | 71.3% |
| Open exposure | INR 34,45,470 |
| Zero-output claim | INR 6,20,000 |
| Availability answer | EQX1007, confidence 1.00 |
| Maintenance | EQX1005, SPN 110, 4.33 days |

`restore_baseline.py` touches only what a demo can change — non-seed events, mutable
asset columns, and hire requests. Telemetry, the catalogue and the source manifest are
never rewritten, and the event delete is scoped by primary key against the seed file
rather than by date, so it cannot remove a row the demo shipped with.
