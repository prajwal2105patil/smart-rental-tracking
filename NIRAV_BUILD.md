# BUILD SPEC — Backend (Nirav)

You are the build agent. This file is complete. Build exactly what is listed. Do not add
auth, Docker, migrations, WebSockets, a test suite, or any endpoint not listed here.

**Stack:** Python 3.11 · FastAPI · SQLAlchemy · SQLite · Pydantic v2 · uvicorn
**Do NOT use:** PostgreSQL, Docker, APScheduler, Alembic.

---

## Hard rules

1. **Nothing calls `datetime.now()` for business logic.** Import `NOW` from `config.py`.
   The dataset is dated 2025. Reading the real clock makes every asset a year overdue.
2. **The `events` table is append-only.** No UPDATE, no DELETE, ever.
3. **Asset status is computed from the event log**, never stored as a mutable field.
4. **Every call into `intelligence.py` is wrapped in try/except** and returns an empty
   list on failure. A broken model must degrade, never crash the API.
5. **Do not edit `intelligence.py`.** That file belongs to another developer.
6. All thresholds and rates come from `config.py`. No numeric literals in route handlers.

---

## Files to create

```
api/
├── config.py          PROVIDED — do not rewrite, only extend
├── schemas.py         PROVIDED — do not rewrite. This is the frozen contract.
├── intelligence.py    PROVIDED by another dev — import only, never edit
├── db.py              CREATE — SQLAlchemy engine + session, SQLite
├── models.py          CREATE — 4 ORM tables
├── store.py           CREATE — the only file that touches the DB
├── projection.py      CREATE — event log → current status
├── ledger.py          CREATE — value math + running total
├── seed.py            CREATE — loads data/seed_assets.json into SQLite
├── qr.py              CREATE — one QR PNG per asset into qr/
├── main.py            REPLACE — the routes below
└── requirements.txt   CREATE
```

## Database — `models.py`

```
assets          equipment_id PK, type, model, serial_number, site_id NULL,
                operator_id NULL, on_rent BOOL, check_out_date, check_in_date,
                engine_hours_day, idle_hours_day, operating_days,
                cumulative_operating_hours, hours_since_service, day_rate,
                condition_grade

events          event_id PK, timestamp, equipment_id FK, event_type, actor,
                site_id NULL, operator_id NULL, condition_grade NULL, notes NULL
                -- APPEND ONLY

usage_logs      log_id PK, equipment_id FK, log_date, engine_hours, idle_hours,
                engine_coolant_temp_c, fuel_remaining_percent, is_operating_day

ledger          entry_id PK, timestamp, equipment_id, rule_id NULL, action,
                est_value_inr
```

`event_type` ∈ `CHECK_OUT · ASSIGN · USAGE_LOG · CONDITION_LOG · CHECK_IN · RETURN_TO_YARD`

## `projection.py`

```python
def project_status(asset, events) -> str
# returns ACTIVE | IDLE | UNASSIGNED | OVERDUE | IN_SERVICE | AT_YARD
```
Logic, in order:
1. Last event is `CHECK_IN` or `RETURN_TO_YARD` → `AT_YARD`
2. `asset.on_rent` is False → `AT_YARD`
3. `asset.site_id` is None → `UNASSIGNED`
4. `NOW > asset.check_in_date` → `OVERDUE`
5. `engine_hours_day > 0` → `ACTIVE`, else `IDLE`

Overdue is computed on read. There is no background job.

## `ledger.py`

```python
def hourly_rate(asset, config) -> float
    hours = asset.engine_hours_day + asset.idle_hours_day or config["default_hours_per_day"]
    return asset.day_rate / hours

def idle_waste_inr(asset, config) -> int
    return int(asset.idle_hours_day * asset.operating_days * hourly_rate(asset, config))

def total_recovered(entries) -> int
```

## Endpoints — `main.py`

Build every one. Return correct shapes with hardcoded data FIRST, real logic second.
Enable CORS with `allow_origins=["*"]`.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{"ok": true}` — build this first, confirm the server boots |
| GET | `/assets` | list of `{equipment_id, type, status, site_id, operator_id, utilization_pct, engine_hours_day, idle_hours_day, due_back, day_rate, flags_count}` |
| GET | `/assets/{equipment_id}` | `{asset, status, signals[], events[], telemetry_series[]}` |
| POST | `/checkout` | body `{equipment_id, actor}` → writes one `CHECK_OUT` event, sets `on_rent=true` |
| POST | `/assign` | body `{equipment_id, site_id, operator_id, actor}` → one `ASSIGN` event, sets site + operator |
| POST | `/log-usage` | body `{equipment_id, engine_hours, idle_hours, actor}` → one `USAGE_LOG` event + a `usage_logs` row |
| POST | `/checkin` | body `{equipment_id, condition_grade, notes, actor}` → one `CHECK_IN` event, sets `on_rent=false` |
| GET | `/alerts` | **unified feed**: overdue + anomalies + maintenance risks in one list, each with `{equipment_id, source, severity, title, signals[], est_value_inr, recommended_action}` |
| GET | `/availability` | query `?type=&site=&from=&days=` → passes through to `intelligence.answer_availability` |
| GET | `/maintenance-risk` | passes through to `intelligence.assess_maintenance` |
| GET | `/ledger` | `{entries[], total_recovered_inr}` |
| POST | `/ledger` | body `{equipment_id, action, est_value_inr, rule_id?}` |
| GET | `/config` | `config.as_dict()` |
| PUT | `/config` | merges a patch dict, returns the new config |
| POST | `/reset` | reloads seed, clears events + ledger, restores config defaults |

All four lifecycle routes write **exactly one row** into `events`, stamping
`actor`, `timestamp`, `equipment_id`, and where relevant `site_id` / `operator_id`.
Each returns `{event, status}` with the freshly projected status.

## Integration with `intelligence.py`

One import, one call, always wrapped:

```python
import intelligence
from schemas import IntelligenceBundle

def safe_bundle(assets, telemetry, bookings, config) -> IntelligenceBundle:
    try:
        return intelligence.analyze(assets, telemetry, bookings, config)
    except Exception as exc:
        print(f"[intelligence] degraded: {exc}")
        return IntelligenceBundle()
```

`/alerts` merges three sources into one list:
- overdue → computed here in `projection.py`, `source="OVERDUE"`
- `bundle.anomalies` → `source="ANOMALY"`
- `bundle.maintenance` → `source="MAINTENANCE"`

## `seed.py`

Read `data/seed_assets.json`, drop `_`-prefixed keys, insert into `assets`.
Idempotent — running it twice must not duplicate rows.

## `qr.py`

`pip install qrcode[pil]`. Write `qr/{equipment_id}.png` for every asset, encoding just
the equipment id. One function, called from a `__main__` block.

## `requirements.txt`

```
fastapi
uvicorn[standard]
sqlalchemy
pydantic
qrcode[pil]
python-dotenv
```

## Acceptance — the build is done when all of these pass

```bash
uvicorn main:app --port 8000

curl localhost:8000/health                    # {"ok":true}
curl localhost:8000/assets                    # 7 assets, each with a status
curl localhost:8000/alerts                    # >= 5 entries
curl "localhost:8000/availability?type=Excavator&site=S003&from=2025-05-19&days=10"
curl localhost:8000/config                    # thresholds + day rates

curl -X POST localhost:8000/assign -H 'Content-Type: application/json' \
  -d '{"equipment_id":"EQX1007","site_id":"S003","operator_id":"OP101","actor":"nirav"}'
# → status flips UNASSIGNED → ACTIVE
# → GET /alerts no longer lists EQX1007 for the unassigned rule
# → GET /assets/EQX1007 shows the new event in events[]
```

## Then deploy

Push to Render or Railway. Put the public URL in the team chat.
Do this **before** polishing anything. Nothing is demoed from localhost.
