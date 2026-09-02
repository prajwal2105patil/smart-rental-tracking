# Smart Rental Tracking — Caterpillar Hackathon

A Cat dealer's rental fleet console: where every machine is, what it is costing, which one
can be promised to the customer on the phone, and which one must not leave the yard.

**Public URLs**

| | |
|---|---|
| API | _paste the Render URL here after the first deploy_ |
| Web | _paste the Vercel URL here_ |

---

## Run it

```bash
cd api && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
```

Then `http://localhost:8000/docs` for the full interactive API, or `/health` to confirm boot.

```bash
cd api && python -m pytest test_intelligence.py -q     # 19 assertions
cd api && python intelligence.py                        # every rule, on the seed data
```

## Rebuild the data (optional — the outputs are committed)

```bash
cd data && pip install -r requirements.txt
python catalogue.py        # needs hmd_python.csv one level above the repo
python generate_seed.py    # deterministic; the seven given rows pass through unchanged
cd ../api && python qr.py  # one printable tag per asset into qr/
```

## What is real and what is not

- **The seven given machines (EQX1001–EQX1007) are unchanged.** `data/seed_assets_given.json`
  is the frozen original; a test fails the build if the generated file ever differs from it.
- **The telemetry history is synthetic**, generated from the given fields — it cannot drift
  from them, because `cumulative_operating_hours == engine_hours_day × operating_days` is
  asserted at generation time for every machine.
- **`hmd_python.csv` is a public heavy-equipment distribution dataset, not Caterpillar's.**
  Caterpillar is 1 of 163 brands in it. It is used as a catalogue — 243 SKUs, 83 dealer
  branches, real customers, real cross-class price ratios — and for nothing else. It has no
  demand signal and its delivery column is not transit time. See `pitch/qa_prep.md` §1 and §4.

## Endpoints

```
GET  /health                     boot check
GET  /assets                     fleet board rows
GET  /assets/{id}                signals, events, telemetry series, maintenance
POST /checkout /assign /log-usage /checkin      the lifecycle, one event row each
POST /events                     the single write path the four routes wrap
GET  /alerts                     unified feed: OVERDUE + ANOMALY + MAINTENANCE
GET  /anomalies                  rules R1..R7, each with its signals
GET  /availability               ?type=&site=&from=&days=  -> a commitment, not a forecast
GET  /maintenance-risk           SPN/FMI, part, days to failure
GET  /usage-logs                 usage rows written by /log-usage
GET  /ledger  ·  POST /ledger    recovered total + exposure, split by kind of money
GET  /config  ·  PUT /config     thresholds and rates, editable live (deep-merges)
POST /reset                      one key back to exact demo state
```

## Layout

```
api/     config · schemas (frozen) · intelligence · main · qr · tests
data/    catalogue extraction · seed generator · seed + catalogue JSON
pitch/   qa_prep.md — the model and data answers
qr/      printable tags, one per asset
```

## The four boundaries this structure enforces

1. Only `intelligence.py` holds a rule. It holds no numeric threshold either — every one
   comes from `config.py`, so the settings screen actually moves the money.
2. Only `config.py` knows the date. `NOW` is pinned to 2025-05-12; nothing calls the wall
   clock, and a test parses the module to prove it.
3. Every verdict ships its `signals` — the field, the value, and the threshold crossed.
4. Only `api.ts` (front end) knows the API address, from `VITE_API_URL`.
