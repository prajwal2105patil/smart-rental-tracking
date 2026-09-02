# BUILD SPEC — Intelligence layer (Prajwal)

You are the build agent. You edit exactly one file: `api/intelligence.py`.
`config.py`, `schemas.py`, `main.py` and the database belong to another developer.

**Stack:** Python 3.11 · pydantic v2 · numpy. Optionally scikit-learn.

---

## Hard rules

1. **Pure functions only.** No database, no HTTP, no file reads, no `datetime.now()`.
   Everything arrives as arguments; everything leaves as a return value.
2. **Read `NOW` from `config["now"]`.** The data is dated 2025.
3. **Every threshold comes from the `config` dict.** No numeric literals in this file.
4. **Every verdict ships its `signals`** — the field names, their values, and the
   threshold that was crossed. A flag with no evidence is worthless here; explainability
   is a scored requirement.
5. Seed every RNG with `config["random_seed"]`. Numbers must not move between runs.

---

## The one function the API calls

```python
def analyze(assets, telemetry, bookings, config) -> IntelligenceBundle
```

Signature is frozen. Returns `IntelligenceBundle(anomalies=[], availability=None, maintenance=[])`.

Build in this order. Do not start the next until the previous one renders in the UI.

---

## Part 1 — `find_anomalies(assets, config) -> list[Anomaly]`

R1, R3 and R4 are already written in the file as worked examples. Copy their shape exactly.
Add the remaining four:

| ID | Condition | Severity | `est_value_inr` | `recommended_action` |
|---|---|---|---|---|
| **R2** `IDLE_BURN` | `utilisation(a) < config["idle_utilisation_warn"]` and `a.operating_days >= 7` | CRITICAL if `utilisation < config["idle_utilisation_crit"]`, else WARNING | `idle_waste_inr(a, config)` | "Redeploy to a site with active demand" |
| **R5** `SERVICE_DUE` | `a.hours_since_service >= config["service_interval_hours"]` | WARNING | `a.day_rate * config["service_days"]` | "Schedule service before next dispatch" |
| **R6** `OVERDUE` | `a.on_rent` and `NOW > a.check_in_date` | CRITICAL | `days_overdue * a.day_rate` | "Contact customer — recall or bill the extension" |
| **R7** `NO_OPERATOR` | `a.operator_id is None` and `a.on_rent` | WARNING | `a.day_rate * a.operating_days // 2` | "Assign an operator or return the asset" |

`utilisation = engine_hours_day / (engine_hours_day + idle_hours_day)`, 0 when the
denominator is 0. Helpers `utilisation`, `hourly_rate`, `idle_waste_inr` and
`days_overdue` are already in the file.

**Expected on the seed data:** R1 and R3 on EQX1002 and EQX1007 · R4 on EQX1004 ·
R2 on EQX1001, EQX1004, EQX1006 · R5 on EQX1005 · R6 on EQX1001, EQX1002, EQX1007 ·
R7 on EQX1002, EQX1007.

---

## Part 2 — `answer_availability(...) -> AvailabilityAnswer`

```python
def answer_availability(assets, equipment_type, site_id, needed_from, days, config)
```

**This is a booking question, not a forecast. Do not build a demand curve or a time series.**
The judge's example: *a customer wants an excavator next Monday; some machines come back
Friday; which one can I commit?*

Algorithm:

```
TRANSIT = config["transit_days"]        SERVICE = config["service_days"]

for each asset of equipment_type:
    if not asset.on_rent:                    free_from = NOW
    else:                                    free_from = asset.check_in_date + TRANSIT
    if asset.hours_since_service >= config["service_interval_hours"]:
                                             free_from += SERVICE
    eligible if free_from <= needed_from

rank eligible by (free_from ASC, condition_grade ASC, cumulative_operating_hours ASC)

confidence:  1.00  not on rent (already at yard)
             0.90  free_from <= needed_from - 2 days
             0.75  free_from == needed_from - 1 day
             0.50  otherwise

if none eligible:
    can_commit = False
    alternatives = [
        "Earliest available <type> is <date>",
        "Recall <id> — unassigned with zero output",        # if any R1/R3 asset of this type
        "Extend <id> at <site> — currently at <util>%",     # lowest-utilisation asset of this type
    ]
```

`reason` is one plain-English sentence shown on screen, e.g.
`"EQX1004 returns 2025-05-15, one day transit, available 2025-05-16."`

**The strongest answer in this dataset:** EQX1007 is an excavator, not on rent to any site,
zero engine hours, no operator. It is available immediately. The line to surface is
*"you do not have to wait for Friday — you already have one doing nothing."* Make sure the
ranking finds it.

---

## Part 3 — `assess_maintenance(assets, telemetry, config) -> list[MaintenanceRisk]`

The judge asked for this by name: *"your engine temperature is running too high… because of
this fault code your engine is overheated, and you need to replace a certain part."*

```
for each asset:
    series = coolant temps from telemetry for that asset, time-ordered
    rolling = mean of the last 24 readings
    slope   = least-squares slope over the last 7 days, in °C/day

    if rolling > config["coolant_warn_c"] and slope > config["coolant_slope_min"]:
        emit MaintenanceRisk(
            spn = 110,
            fmi = 0,
            label = "Engine Coolant Temperature — data valid but above normal, most severe",
            part  = "Cooling package: radiator core + thermostat",
            action = "Schedule inspection before next dispatch",
            days_to_failure = (config["coolant_failure_c"] - rolling) / slope,
            current_temp_c = rolling,
            slope = slope,
        )
```

SPN 110 / FMI 0 is genuine SAE J1939. **Do not invent fault codes.** If a second one is
needed, SPN 100 / FMI 1 is engine oil pressure below normal, most severe.

EQX1005 carries the rising trend in the seed telemetry. If `telemetry` is empty, return `[]`
without raising — the API wraps this call, but it should not need to.

---

## Optional, only after Parts 1–3 render

`mcp/server.py` — expose `list_assets`, `get_anomalies`, `check_availability` and
`get_maintenance_risk` as MCP tools over the same functions. Cat Digital's own engineering
postings name MCP agents operating over their Helios APIs, so this is a roadmap answer and
a live demo in one. Skip it entirely if anything above is unfinished.

---

## Acceptance

```bash
cd api && python3 intelligence.py
```

The smoke test at the bottom of the file must print every rule firing on the seed data with
its rule id, asset, severity and rupee value. Then:

- Every `Anomaly` has a non-empty `signals` list.
- No numeric threshold appears anywhere in the file — grep for digits and justify each one.
- `analyze()` runs with `telemetry=[]` and `bookings=[]` without raising.
- Running it twice produces identical output.

## Write `pitch/qa_prep.md` while this runs

Three answers, prepared not improvised:
1. How the telemetry history was generated and how it was validated against the seven real rows.
2. Which outputs are rule-based and which are statistical.
3. Why availability commitment rather than demand forecasting.
