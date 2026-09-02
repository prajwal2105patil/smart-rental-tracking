# System Architecture — Smart Rental Tracking

Four layers, in the order Caterpillar named them on their own solution-architecture slide.

```
TELEMETRY   generate_seed.py → seed_*.json      AEMP 2.0 fields, J1939 fault codes
                     ↓
PLATFORM    FastAPI + SQLite                    append-only events; status is projected
                     ↓
INTELLIGENCE intelligence.py                    pure function: rules, availability, maintenance
                     ↓
ACTION      React console                       return / reassign / extend / investigate
```

## File tree

```
smart-rental/
├── README.md                       run instructions + public URLs
├── ARCHITECTURE.md                 this file
├── .env.example                    VITE_API_URL
│
├── api/                            ── NIRAV ──
│   ├── config.py            DONE   pinned clock, thresholds, day rates
│   ├── schemas.py           DONE   THE CONTRACT — frozen
│   ├── main.py              DONE   9 endpoints, CORS, /reset
│   ├── db.py                       SQLite engine + session
│   ├── store.py                    the only file that touches the DB
│   ├── projection.py               event log → current status
│   ├── ledger.py                   value math + running total
│   ├── qr.py                       one QR PNG per asset
│   ├── requirements.txt
│   └── intelligence.py      WIP    ── PRAJWAL, owned by him alone ──
│
├── data/                           ── TANISH ──
│   ├── seed_assets.json     DONE   7 real + ~20 synthetic
│   ├── seed_telemetry.json         90 days hourly, AEMP-shaped
│   ├── seed_events.json            historical lifecycle
│   ├── seed_bookings.json          the Monday conflict
│   └── generate_seed.py            seeded RNG, reproducible
│
├── web/                            ── MANTESH ──
│   ├── package.json · vite.config.ts · index.html
│   └── src/
│       ├── main.tsx · App.tsx      routes: / · /asset/:id · /scan · /settings
│       ├── api.ts                  one fetch wrapper, base URL from env
│       ├── types.ts                mirrors schemas.py
│       ├── theme.css               Cat yellow #FFCD11 / black
│       ├── pages/
│       │   ├── FleetBoard.tsx      opening screen
│       │   ├── AssetPanel.tsx      signals, history, actions
│       │   ├── Scan.tsx            phone camera → check in/out
│       │   └── Settings.tsx        rates + thresholds, live
│       └── components/
│           ├── StatusPill.tsx
│           ├── UtilisationBar.tsx
│           ├── SignalList.tsx      * explainability
│           ├── ActionQueue.tsx     * the four buttons
│           ├── ValueLedger.tsx     * recovered total
│           ├── AvailabilityAsk.tsx * the Monday question
│           └── TempSparkline.tsx   coolant trend on EQX1005
│
├── pitch/                          ── TANISH ──
│   ├── demo_script.md              five beats, timed
│   ├── value_model.md              assumptions written down
│   └── qa_prep.md                  Prajwal writes the model answers
│
├── qr/                             printed tags (output of qr.py)
└── mcp/server.py                   STRETCH: fleet tools over MCP
```

`*` marks the four components that carry the score. If the front end runs out of time,
these four survive and everything else goes.

## What each file does

| File | Owner | Job |
|---|---|---|
| `api/config.py` | Nirav | Every constant. Clock pinned to 2025-05-12 — the data is from 2025 and nothing in this repo calls the real clock. Thresholds and rates live here so the settings screen can change them live. |
| `api/schemas.py` | Nirav | The agreement between backend and intelligence. Frozen after the first read-through. |
| `api/main.py` | Nirav | The 9 endpoints. Wraps every intelligence call in try/except so a broken model degrades to empty lists rather than a white screen. Includes `/reset`. |
| `api/db.py` | Nirav | SQLite engine + session, isolated so it can be swapped for Postgres without touching anything else. That is the seam you point at when asked about scale. |
| `api/store.py` | Nirav | All reads and writes. The **only** file allowed to touch the database. Events insert, never update. |
| `api/projection.py` | Nirav | Event log → ACTIVE / IDLE / UNASSIGNED / OVERDUE / IN_SERVICE / AT_YARD. Status is computed, never stored. |
| `api/ledger.py` | Nirav | Money math and running total. Rates read from config so a judge can change one mid-demo. |
| `api/qr.py` | Nirav | One QR PNG per asset into `qr/`. Ten lines. Print before 3 PM. |
| `api/intelligence.py` | **Prajwal** | Rules R1–R7 with visible signals · availability engine ("can I promise Monday?") · coolant trend → SPN 110 / FMI 0. Pure functions only: no DB, no network, no clock. Three rules already written as worked examples. |
| `data/generate_seed.py` | Tanish | Builds every seed file with a fixed RNG seed so numbers never move between runs. The seven real assets keep their exact given values. |
| `data/seed_assets.json` | Tanish | Seven real machines plus ~20 more. Already carries the four demo signals: two ghost assets, one data conflict, one service risk. |
| `data/seed_telemetry.json` | Tanish | 90 days hourly, AEMP-shaped, including the rising coolant curve on EQX1005. |
| `data/seed_bookings.json` | Tanish | The customer asking for an excavator at S003 next Monday — the input to demo beat four. |
| `web/src/api.ts` | Mantesh | One fetch wrapper. Base URL from env, so localhost → production is one variable. |
| `web/src/types.ts` | Mantesh | TypeScript mirror of `schemas.py`. A rename on either side must happen on both within five minutes. |
| `pages/FleetBoard.tsx` | Mantesh | All machines: status pill, utilisation bar, idle hours, due-back, flag count. Red rows first. Recovered total in the header. Polls every 5s. |
| `pages/AssetPanel.tsx` | Mantesh | One machine: signals with thresholds, coolant sparkline, full event history, four action buttons. |
| `pages/Scan.tsx` | Mantesh | Phone camera reads a printed QR tag, two taps to check in or out. Test on a real phone on venue wifi. |
| `pages/Settings.tsx` | Mantesh | Rates, idle threshold, service interval, transit days — with the waste formula on screen. |
| `SignalList.tsx` | Mantesh | Field, value and threshold for every flag. This single component satisfies "show the data signals behind every recommendation." |
| `pitch/demo_script.md` | Tanish | Five beats, word for word, timed. Drafted by 2 PM. |
| `pitch/qa_prep.md` | Prajwal | How history was generated, how it was validated against the 7 real rows, what is rule-based vs statistical. |
| `mcp/server.py` | Prajwal | Fleet API as MCP tools. Stretch only — after everything else is finished. |

## Trace: a judge clicks "Reassign" on EQX1007

1. `web/src/components/ActionQueue.tsx` — button fires with asset id + target site
2. `web/src/api.ts` — `POST /events {equipment_id, event_type:"ASSIGN", site_id, operator_id, actor}`
3. `api/main.py::append_event()` — validated against the shared schema
4. `api/store.py` — INSERT into `events`. Append only; no row is ever updated
5. `api/projection.py` — status recomputed: UNASSIGNED → ACTIVE
6. `web/src/api.ts` — query invalidated, fleet board refetches, row turns green
7. `api/ledger.py` — `POST /ledger` records the recovered value + triggering rule
8. `web/src/components/ValueLedger.tsx` — header total climbs
9. `api/intelligence.py::find_anomalies()` — R1 no longer fires. The flag is gone because the problem is gone.

## Four boundaries this structure enforces

1. **Only `store.py` touches the database.** One place to look when data is wrong.
2. **Only `intelligence.py` holds a threshold.** A number in two files will disagree with itself before 3 PM.
3. **Only `config.py` knows the date.** No `datetime.now()` anywhere in the repo.
4. **Only `api.ts` knows the API address.** localhost → production is one env variable, not twelve edits under pressure.

## Deployment

`web/` → Vercel. `api/` → Render or Railway. `VITE_API_URL` points at the API.
Both live by 1:30 PM. The first deploy always fails for a boring reason — let it fail
while you still have three hours.
