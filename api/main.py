"""

The API. Nine endpoints plus /health and a unified /alerts feed.



Rules of the house:

  - This file owns state and truth. It never writes a rule or a threshold.

  - Never UPDATE a row. Append an event; derive status from the event log.

  - Every call into intelligence.py is wrapped in try/except. If the model throws,

    serve an empty list. A broken model must degrade, never white-screen the demo.

  - Nothing here calls datetime.now() for business logic. Read config.NOW.



  pip install -r requirements.txt

  uvicorn main:app --reload --port 8000

"""

from __future__ import annotations

import json

import os

import pathlib

import uuid

from datetime import date, datetime

from typing import Literal, Optional



from fastapi import Depends, FastAPI, Header, HTTPException, Query

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field



import config as cfg

from schemas import (

    Asset, RentalEvent, Booking, LedgerEntry, TelemetrySnapshot, EventType,

    IntelligenceBundle,

)

import intelligence
import store
import assistant



app = FastAPI(title="Smart Rental Tracking")



# CORS defaults to "*" so localhost and a laptop on venue wifi both work. In production

# set ALLOWED_ORIGINS to the deployed web URL - with "*" any web page a viewer visits can

# issue a cross-origin POST /reset and wipe the demo state mid-presentation.

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]



# Optional shared secret for the two state-destroying routes. Unset locally (open, so

# nothing gets in the way); set it on Render and only the console can reset or reconfigure.

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")



app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,

                   allow_methods=["*"], allow_headers=["*"])



MAX_TEXT = 500          # notes and free-text fields; keeps an append-only log bounded





def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:

    """No-op when ADMIN_TOKEN is unset, so local development is unaffected."""

    if ADMIN_TOKEN and x_admin_token != ADMIN_TOKEN:

        raise HTTPException(401, "admin token required")



DATA = pathlib.Path(__file__).resolve().parent.parent / "data"





# ---- in-memory state. Swap for SQLite once the shapes are proven. -------------

def _read(name: str) -> list:

    """Records in, from wherever they live. See store.py - one module touches storage.

    With DATABASE_URL set these come out of Supabase; without it, off the disk. The

    records are identical either way, which store.verify() proves rather than asserts.

    """

    return store.read(name)





def _load_assets() -> list[Asset]:

    return [Asset(**{k: v for k, v in a.items() if not k.startswith("_")})

            for a in _read("seed_assets.json")]





def _load_telemetry() -> list[TelemetrySnapshot]:

    """15k snapshots validate in ~50ms, so the frozen contract is honoured here."""

    return [TelemetrySnapshot(**t) for t in _read("seed_telemetry.json")]





def _load_bookings() -> list[Booking]:

    return [Booking(**b) for b in _read("seed_bookings.json")]





def _load_events() -> list[RentalEvent]:

    return [RentalEvent(**e) for e in _read("seed_events.json")]





# Decide the backend BEFORE the first read, so every loader below agrees.
STORE_BACKEND = store.init()

ASSETS: list[Asset] = _load_assets()

TELEMETRY: list[TelemetrySnapshot] = _load_telemetry()

EVENTS: list[RentalEvent] = _load_events()      # APPEND ONLY. This is the audit trail.

LEDGER: list[LedgerEntry] = []

USAGE_LOGS: list[dict] = []              # the usage_logs table, in memory for now

# Idempotency-Key -> the row that key already created. The ledger is append-only, so a

# duplicated request is permanent and there is no undo short of /reset: four fast clicks

# on one action were measured writing four rows worth INR 24,60,000 for one INR 1,80,000

# action. Replaying the stored row makes a repeat a no-op instead.

IDEMPOTENT: dict[str, LedgerEntry] = {}

BOOKINGS: list[Booking] = _load_bookings()

CONFIG: dict = cfg.as_dict()





def _last_fix(equipment_id: str) -> tuple[float | None, float | None, str | None]:

    """

    Most recent GPS fix for a machine, from the telemetry it already emits.



    A parked machine stops emitting, so its last fix is where it was left - which is

    exactly what a dealer needs to know about a machine nobody can account for.

    """

    for t in reversed(TELEMETRY):

        if t.equipment_id == equipment_id:

            return t.latitude, t.longitude, t.datetime.isoformat()

    return None, None, None





def project_status(a: Asset) -> str:

    """Status is DERIVED, never stored. Last event wins; falls back to seed state."""

    last = next((e for e in reversed(EVENTS) if e.equipment_id == a.equipment_id), None)

    if last:

        if last.event_type in ("CHECK_IN", "RETURN_TO_YARD"):

            return "AT_YARD"

        if last.event_type == "ASSIGN":

            return "ACTIVE"

    if not a.on_rent:

        return "AT_YARD"

    if a.site_id is None:

        return "UNASSIGNED"

    now = date.fromisoformat(CONFIG["now"])

    if a.check_in_date and now > a.check_in_date:

        return "OVERDUE"

    return "ACTIVE" if a.engine_hours_day > 0 else "IDLE"





def _safe_bundle() -> IntelligenceBundle:

    """The model is allowed to fail. The demo is not."""

    try:

        return intelligence.analyze(ASSETS, TELEMETRY, BOOKINGS, CONFIG)

    except Exception as exc:                       # noqa: BLE001

        print(f"[intelligence] degraded: {exc}")

        return IntelligenceBundle()





def _find(equipment_id: str) -> Asset:

    a = next((x for x in ASSETS if x.equipment_id == equipment_id), None)

    if not a:

        raise HTTPException(404, "unknown asset")

    return a





def _validate_patch(patch: dict, reference: dict, path: str = "") -> None:

    """

    A config patch may only change keys that already exist, to the same type.



    Config drives every rule, every rupee and the pinned clock, so an unchecked patch is

    not a cosmetic problem. {"day_rates": "x"} makes find_anomalies throw and the

    try/except silently serves zero flags; {"now": "not-a-date"} takes /assets down with

    a 500. Both returned HTTP 200 before this existed.

    """

    for key, value in patch.items():

        where = f"{path}{key}"

        if key not in reference:

            raise HTTPException(422, f"unknown config key: {where}")

        expected = reference[key]

        if isinstance(expected, dict):

            if not isinstance(value, dict):

                raise HTTPException(422, f"{where} must be an object")

            _validate_patch(value, expected, f"{where}.")

            continue

        if isinstance(expected, bool) and not isinstance(value, bool):

            raise HTTPException(422, f"{where} must be a boolean")

        if isinstance(expected, (int, float)) and not isinstance(expected, bool):

            if isinstance(value, bool) or not isinstance(value, (int, float)):

                raise HTTPException(422, f"{where} must be a number")

            if value < 0:

                raise HTTPException(422, f"{where} must not be negative")

            continue

        if isinstance(expected, str):

            if not isinstance(value, str):

                raise HTTPException(422, f"{where} must be a string")

            # Type-correct is not the same as valid. "now" is a string that the whole

            # app parses as a date: a well-typed but unparseable value passed this check

            # and then took /assets down with a 500.

            if _parses_as_date(expected):

                try:

                    date.fromisoformat(value)

                except ValueError:

                    raise HTTPException(422, f"{where} must be an ISO date (YYYY-MM-DD)")





def _parses_as_date(value: str) -> bool:

    try:

        date.fromisoformat(value)

        return True

    except ValueError:

        return False





def _deep_merge(target: dict, patch: dict) -> dict:

    """

    Nested dicts merge instead of replacing.



    Without this, PUT /config {"day_rates": {"Excavator": 30000}} wipes the other three

    rates - which is the exact moment a judge is watching the numbers recompute.

    """

    for key, value in patch.items():

        if isinstance(value, dict) and isinstance(target.get(key), dict):

            _deep_merge(target[key], value)

        else:

            target[key] = value

    return target





# ------------------------------------------------------------------ endpoints

@app.get("/storage")

def storage():

    """Which store the API is reading, and whether both agree.

    verify() re-reads the JSON seeds and compares them record for record against

    what came out of Postgres. A demo that claims a database should be able to show

    that swapping it changed nothing about the answers.

    """

    return {"store": store.describe(), "parity": store.verify()}


@app.get("/health")

def health():

    """First thing to build, first thing to check on the venue wifi."""

    return {

        "ok": True,

        "now": CONFIG["now"],

        "assets": len(ASSETS),

        "telemetry_snapshots": len(TELEMETRY),

        "events": len(EVENTS),

        "bookings": len(BOOKINGS),

    }





@app.get("/assets")

def list_assets():

    flags = _safe_bundle().anomalies

    return [{

        "equipment_id": a.equipment_id, "type": a.type, "status": project_status(a),

        "site_id": a.site_id, "branch_id": CONFIG["site_branch"].get(a.site_id or ""),

        "operator_id": a.operator_id,

        "utilization_pct": round(a.utilisation * 100, 1),

        "engine_hours_day": a.engine_hours_day, "idle_hours_day": a.idle_hours_day,

        "due_back": a.check_in_date, "day_rate": intelligence.day_rate(a, CONFIG),

        "on_hire_from": a.check_out_date, "condition_grade": a.condition_grade,

        "hours_since_service": a.hours_since_service,

        "flags_count": sum(1 for f in flags if f.equipment_id == a.equipment_id),

        "latitude": _last_fix(a.equipment_id)[0],

        "longitude": _last_fix(a.equipment_id)[1],

        "last_fix": _last_fix(a.equipment_id)[2],

    } for a in ASSETS]





@app.get("/assets/{equipment_id}")

def get_asset(equipment_id: str):

    a = _find(equipment_id)

    bundle = _safe_bundle()

    return {

        "asset": a, "status": project_status(a),

        "signals": [f for f in bundle.anomalies if f.equipment_id == equipment_id],

        "events": [e for e in EVENTS if e.equipment_id == equipment_id],

        "telemetry_series": _daily_series(equipment_id),

        "maintenance": [m for m in bundle.maintenance if m.equipment_id == equipment_id],

    }





def _daily_series(equipment_id: str) -> list[dict]:

    """Daily means for the sparkline. Hourly raw would be 720 points for one chart."""

    days: dict[str, list[float]] = {}

    hours: dict[str, float] = {}

    for t in TELEMETRY:

        if t.equipment_id != equipment_id:

            continue

        key = t.datetime.date().isoformat()

        days.setdefault(key, []).append(t.engine_coolant_temp_c)

        hours[key] = t.cumulative_operating_hours

    return [{

        "date": day,

        "coolant_temp_c": round(sum(temps) / len(temps), 2),

        "cumulative_operating_hours": round(hours[day], 1),

    } for day, temps in sorted(days.items())]





class EventIn(BaseModel):

    # event_type is the frozen Literal from schemas, not a free string. As a plain str

    # an unknown value passed validation here and then blew up constructing RentalEvent,

    # turning a bad request into a 500.

    equipment_id: str = Field(max_length=64)

    event_type: EventType

    actor: str = Field(max_length=64)

    site_id: Optional[str] = Field(default=None, max_length=64)

    operator_id: Optional[str] = Field(default=None, max_length=64)

    condition_grade: Optional[str] = Field(default=None, max_length=8)

    notes: Optional[str] = Field(default=None, max_length=MAX_TEXT)





@app.post("/events", status_code=201)

def append_event(body: EventIn):

    a = _find(body.equipment_id)

    ev = RentalEvent(event_id=str(uuid.uuid4()), timestamp=datetime.now(), **body.model_dump())

    EVENTS.append(ev)                                  # append only, never update

    if body.event_type in ("CHECK_IN", "RETURN_TO_YARD"):

        a.on_rent = False

    if body.event_type == "ASSIGN" and body.site_id:

        a.site_id, a.operator_id = body.site_id, body.operator_id

    if body.condition_grade:

        a.condition_grade = body.condition_grade

    # Persist after the in-memory state is already correct, and never let the

    # database decide whether the operator's action succeeded.

    store.write_event(ev.model_dump(mode="json"))

    store.write_asset(a.model_dump(mode="json"))

    return {"event": ev, "status": project_status(a)}





# ---- readable wrappers over the one write path (NIRAV_RECONCILE §A) ----------

# Each takes the body NIRAV_BUILD.md specifies - the caller never sends an event_type,

# the route supplies it - and each writes exactly one row into events.

class CheckoutIn(BaseModel):

    equipment_id: str = Field(max_length=64)

    actor: str = Field(max_length=64)

    site_id: Optional[str] = Field(default=None, max_length=64)

    notes: Optional[str] = Field(default=None, max_length=MAX_TEXT)





class AssignIn(BaseModel):

    equipment_id: str = Field(max_length=64)

    site_id: str = Field(max_length=64)

    operator_id: Optional[str] = Field(default=None, max_length=64)

    actor: str = Field(max_length=64)

    notes: Optional[str] = Field(default=None, max_length=MAX_TEXT)





class UsageIn(BaseModel):

    equipment_id: str = Field(max_length=64)

    engine_hours: float = Field(ge=0, le=24)

    idle_hours: float = Field(ge=0, le=24)

    actor: str = Field(max_length=64)

    notes: Optional[str] = Field(default=None, max_length=MAX_TEXT)





class CheckinIn(BaseModel):

    equipment_id: str = Field(max_length=64)

    condition_grade: Optional[str] = Field(default=None, max_length=8)

    notes: Optional[str] = Field(default=None, max_length=MAX_TEXT)

    actor: str = Field(max_length=64)





@app.post("/checkout", status_code=201)

def checkout(body: CheckoutIn):

    a = _find(body.equipment_id)

    a.on_rent = True

    return append_event(EventIn(event_type="CHECK_OUT", **body.model_dump()))





@app.post("/assign", status_code=201)

def assign(body: AssignIn):

    return append_event(EventIn(event_type="ASSIGN", **body.model_dump()))





@app.post("/log-usage", status_code=201)

def log_usage(body: UsageIn):

    """One USAGE_LOG event plus one usage_logs row, exactly as the spec states."""

    a = _find(body.equipment_id)

    log_date = date.fromisoformat(CONFIG["now"])

    latest = next((t for t in reversed(TELEMETRY)

                   if t.equipment_id == body.equipment_id), None)

    USAGE_LOGS.append({

        "log_id": str(uuid.uuid4()),

        "equipment_id": body.equipment_id,

        "log_date": log_date.isoformat(),

        "engine_hours": body.engine_hours,

        "idle_hours": body.idle_hours,

        "engine_coolant_temp_c": latest.engine_coolant_temp_c if latest else None,

        "fuel_remaining_percent": latest.fuel_remaining_percent if latest else None,

        "is_operating_day": body.engine_hours > 0,

    })

    result = append_event(EventIn(

        event_type="USAGE_LOG", equipment_id=body.equipment_id, actor=body.actor,

        notes=body.notes or f"{body.engine_hours}h engine / {body.idle_hours}h idle",

    ))

    return {**result, "usage_log": USAGE_LOGS[-1]}





@app.get("/usage-logs")

def usage_logs(equipment_id: Optional[str] = None):

    return [u for u in USAGE_LOGS

            if equipment_id is None or u["equipment_id"] == equipment_id]





@app.post("/checkin", status_code=201)

def checkin(body: CheckinIn):

    return append_event(EventIn(event_type="CHECK_IN", **body.model_dump()))





@app.get("/anomalies")

def anomalies():

    return _safe_bundle().anomalies





@app.get("/alerts")

def alerts():

    """

    One feed, not two systems. Overdue, anomaly and maintenance in the order a dealer

    would work them: critical first, then by money at stake.

    """

    bundle = _safe_bundle()

    # R6 IS the overdue signal, so it is tagged source=OVERDUE rather than emitted a

    # second time from the projection - the same machine must not appear twice.

    rows = [{

        "source": "OVERDUE" if a.rule_id == "R6" else "ANOMALY",

        "equipment_id": a.equipment_id, "rule_id": a.rule_id,

        "severity": a.severity, "title": a.title, "est_value_inr": a.est_value_inr,

        "recommended_action": a.recommended_action,

        "signals": [s.model_dump() for s in a.signals],

    } for a in bundle.anomalies]

    rows += [{

        "source": "MAINTENANCE", "equipment_id": m.equipment_id,

        "rule_id": f"SPN{m.spn}/FMI{m.fmi}", "severity": "CRITICAL", "title": m.label,

        "est_value_inr": 0, "recommended_action": m.action,

        "signals": [

            {"field": "engine_coolant_temp_c", "value": str(m.current_temp_c),

             "threshold": f"> {CONFIG['coolant_warn_c']}"},

            {"field": "slope_c_per_day", "value": str(m.slope),

             "threshold": f"> {CONFIG['coolant_slope_min']}"},

            {"field": "days_to_failure", "value": str(m.days_to_failure)},

        ],

    } for m in bundle.maintenance]

    order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}

    rows.sort(key=lambda r: (order.get(r["severity"], 9), -r["est_value_inr"]))

    return rows





@app.get("/availability")

def availability(

    type: str = Query(..., description="Excavator | Bulldozer | Crane | Grader"),

    site: str = Query(...),

    from_: str = Query(default=None, alias="from"),

    days: int = 10,

):

    needed = date.fromisoformat(from_) if from_ else (

        BOOKINGS[0].needed_from if BOOKINGS else date.fromisoformat(CONFIG["now"])

    )

    b = Booking(booking_id="B1", customer="demo", equipment_type=type,

                site_id=site, needed_from=needed, days=days)

    BOOKINGS.clear()

    BOOKINGS.append(b)

    return _safe_bundle().availability





@app.get("/bookings")

def get_bookings():

    return BOOKINGS





@app.get("/usage-summary")

def usage_summary():

    """Total rented hours, usage per site, downtime - lowest-utilisation site first."""

    return intelligence.usage_summary(ASSETS, CONFIG)





@app.get("/briefing")

def briefing():

    """

    The fleet in plain English, assembled from the rules that already fired.



    Every sentence is generated from a number the API can show you - there is no language

    model here and nothing is invented. It reads like a summary because a dealer opening

    the board at 7am wants a sentence before a table.

    """

    bundle = _safe_bundle()

    usage = intelligence.usage_summary(ASSETS, CONFIG)

    value = intelligence.value_summary(bundle.anomalies, CONFIG)

    now = date.fromisoformat(CONFIG["now"])



    by_rule: dict[str, list[str]] = {}

    for a in bundle.anomalies:

        by_rule.setdefault(a.rule_id, []).append(a.equipment_id)



    ghosts = sorted(set(by_rule.get("R1", [])) & set(by_rule.get("R3", [])))

    overdue = sorted(by_rule.get("R6", []))

    due_soon = sorted(by_rule.get("R8", []))

    critical = [a for a in bundle.anomalies if a.severity == "CRITICAL"]



    lines: list[str] = []

    lines.append(

        f"{len(ASSETS)} machines on the board this morning, running at "

        f"{usage['fleet']['utilisation_pct']}% utilisation across "

        f"{len(usage['by_site'])} sites."

    )

    if ghosts:

        names = " and ".join(ghosts)

        lines.append(

            f"{names} {'are' if len(ghosts) > 1 else 'is'} on rent to nobody - no site, no "

            f"operator, and not a single engine hour. That is "

            f"{intelligence.inr_words(sum(v for k, v in value['by_asset']['waste'].items() if k in ghosts))} "

            f"of rental billed for nothing."

        )

    if overdue:

        worst = max(overdue, key=lambda e: next(

            (x.est_value_inr for x in bundle.anomalies if x.equipment_id == e and x.rule_id == "R6"), 0))

        days = next((s.value for x in bundle.anomalies if x.equipment_id == worst

                     and x.rule_id == "R6" for s in x.signals if s.field == "days_overdue"), "?")

        lines.append(

            f"{len(overdue)} machines are past their return date; {worst} is the worst at "

            f"{days} days. Either recall them or bill the extension."

        )

    if due_soon:

        lines.append(

            f"{', '.join(due_soon)} comes back within the reminder window - confirm it with the "

            f"customer today, or commit it to the next booking."

        )

    for m in bundle.maintenance:

        lines.append(

            f"{m.equipment_id} must not go out again before it is serviced: its coolant is "

            f"running at {m.current_temp_c} deg C and climbing {m.slope} deg C a day, which is "

            f"SPN {m.spn} / FMI {m.fmi}. Roughly {m.days_to_failure} operating days of headroom left."

        )

    worst_site = usage["by_site"][0] if usage["by_site"] else None

    if worst_site and worst_site["utilisation_pct"] < CONFIG["idle_utilisation_warn"] * 100:

        lines.append(

            f"{worst_site['site_id']} is the weakest site at {worst_site['utilisation_pct']}% "

            f"utilisation across {worst_site['assets']} machines - that is where to redeploy from."

        )



    return {

        "as_of": now.isoformat(),

        "headline": (f"{len(critical)} things need you today"

                     if critical else "Nothing critical on the board"),

        "lines": lines,

        "counts": {

            "assets": len(ASSETS),

            "critical": len(critical),

            "overdue": len(overdue),

            "due_soon": len(due_soon),

            "maintenance": len(bundle.maintenance),

        },

    }





class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=400)


@app.post("/ask")
def ask(body: AskIn):
    """
    The fleet assistant. Grounded, and never dependent on the network.

    A local deterministic answer is tried first, so the questions a dealer actually asks
    are answered from the live figures with no outbound call at all. Only when no local
    answer fits does the model get involved, and then only with a snapshot of the real
    numbers and an instruction never to invent one.

    `grounded_on` returns the exact figures behind the sentence so the operator can check
    it against the board rather than trusting it.
    """
    bundle = _safe_bundle()
    usage = intelligence.usage_summary(ASSETS, CONFIG)
    value = intelligence.value_summary(bundle.anomalies, CONFIG)
    brief = briefing()

    local = assistant.answer_locally(body.question, ASSETS, bundle, usage, value, brief)
    if local:
        text, used = local
        return {"answer": text, "grounded_on": used, "source": "rules", "checked": True}

    context = assistant.build_context(ASSETS, bundle, usage, value, CONFIG, brief)
    try:
        text = assistant.answer_with_model(body.question, context)
    except Exception as exc:  # noqa: BLE001
        print(f"[assistant] model unavailable: {exc}")
        return {
            "answer": ("I can only answer from the figures on this board, and I do not "
                       "have that one. Try asking about utilisation, overdue machines, "
                       "what is about to break, or where the money is."),
            "grounded_on": [], "source": "fallback", "checked": True,
        }

    # Every number the model asserts must appear in the context it was given. A sentence
    # that invents a figure is worse than no answer on a screen a dealer is trusting.
    asserted = assistant.numbers_in(text)
    available = assistant.numbers_in(context)
    invented = sorted(n for n in asserted - available if len(n) > 2)
    return {
        "answer": text,
        "grounded_on": sorted(asserted & available)[:8],
        "source": "model",
        "checked": not invented,
        "unverified": invented,
    }


@app.get("/assistant/suggestions")
def assistant_suggestions():
    return {"suggestions": assistant.SUGGESTIONS,
            "model_available": bool(os.getenv("GROQ_API_KEY"))}


@app.get("/forecast")

def forecast():

    """Which site is likely to need which machine, and when.



    Deliberately a projection rather than a regression. The dataset behind this

    build has no demand signal to fit - eleven years of monthly volume flat to

    within three percent - so a model would return a horizontal line dressed up as

    a prediction. What is knowable is mechanical: a site working a machine type at

    a measured rate, and a machine of that type booked to leave inside the horizon.



    Every row ships the rate that was measured, the machines leaving, the date they

    go, what cover remains, and the machine that covers it - so the prediction can

    be argued with instead of believed.

    """

    try:

        return intelligence.forecast_demand(ASSETS, TELEMETRY, BOOKINGS, CONFIG)

    except Exception as exc:                       # noqa: BLE001

        print(f"[forecast] degraded: {exc}")

        return []





# ============================================================== identity
# Signing in answers "who is acting", which is the question the event log exists to
# answer. It is NOT a second security boundary bolted on beside the first: the only
# thing that has ever protected the destructive routes is ADMIN_TOKEN, checked in
# require_admin, and that is still the only thing protecting them. What sign-in adds
# is (a) a real actor on every event instead of the string "scan", and (b) a place to
# type the dealer key at runtime, so it stops being compiled into the front-end bundle.
#
# There are deliberately no passwords and no user store. A hand-rolled password file
# sitting beside the seed data would be the largest attack surface in this project and
# the weakest thing in it. Roles here describe INTENT, and only the elevated one is
# enforced - by the key the server already checks.

ROLES = [
    {
        "id": "VIEWER",
        "label": "Viewer",
        "blurb": "Read the board. Cannot change anything.",
        "needs_key": False,
        "can_write": False,
    },
    {
        "id": "YARD",
        "label": "Yard supervisor",
        "blurb": "Check machines in and out, assign sites and operators, log usage.",
        "needs_key": False,
        "can_write": True,
    },
    {
        "id": "OPS_LEAD",
        "label": "Operations lead",
        "blurb": "Everything a supervisor can do, plus the rate card and a board reset.",
        "needs_key": True,
        "can_write": True,
    },
]


class SessionRequest(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    role: str
    access_key: Optional[str] = None
    # A viewer is a customer, and a customer is scoped to the site they rented to.
    # Nothing in this data links an asset to a customer - inventing that column would
    # be a lie - so the site is the scope, and it is validated against the real ones.
    site_id: Optional[str] = None


def _sites() -> list[str]:

    """Every site currently holding a machine. Derived, never a hard-coded list."""

    return sorted({a.site_id for a in ASSETS if a.site_id})





@app.get("/auth/roles")

def auth_roles():

    """What the sign-in screen offers, so the UI does not hard-code the ladder.



    admin_required reports whether this deployment has ADMIN_TOKEN set at all. Locally

    it usually is not, and the screen says so rather than pretending to guard.

    """

    return {"roles": ROLES, "sites": _sites(), "admin_required": bool(ADMIN_TOKEN)}





@app.post("/auth/session")

def auth_session(body: SessionRequest):

    """Verify an identity the caller is claiming, and the key if the role needs one.



    This issues no token and stores no session. It cannot: the server is stateless

    about who you are, and the routes that matter re-check ADMIN_TOKEN on every single

    call regardless of what happened here. The endpoint exists so the sign-in screen

    can tell you immediately that a key is wrong, instead of letting you find out from

    a 401 three clicks later.

    """

    role = next((r for r in ROLES if r["id"] == body.role), None)

    if role is None:

        raise HTTPException(status_code=422, detail=f"unknown role {body.role!r}")



    site = body.site_id

    if role["id"] == "VIEWER":

        if not site:

            raise HTTPException(status_code=422, detail="a viewer must say which site they are")

        if site not in _sites():

            raise HTTPException(status_code=422, detail=f"no site {site!r} on this board")

    else:

        site = None



    elevated = False

    if role["needs_key"]:

        if not ADMIN_TOKEN:

            # No key configured on this instance, so there is nothing to check against.

            # Say so plainly rather than granting an elevation that means nothing.

            elevated = True

        elif body.access_key == ADMIN_TOKEN:

            elevated = True

        else:

            raise HTTPException(status_code=401, detail="that dealer access key is not right")



    store.write_user(body.name.strip(), role["id"], site)

    return {

        "actor": body.name.strip(),

        "role": role["id"],

        "role_label": role["label"],

        "can_write": role["can_write"],

        "elevated": elevated,

        "site_id": site,

        "admin_required": bool(ADMIN_TOKEN),

    }





# ============================================================== hire requests
# A customer asking to keep a machine longer, or to have it collected. schemas.py is
# frozen and EventType is a closed literal, so these live in their own store rather than
# being forced into the rental log - a request is not a status change, it is a message
# about one, and conflating the two would corrupt the projection the whole board reads.

HIRE_REQUESTS: list[dict] = []


class HireRequest(BaseModel):
    equipment_id: str
    kind: Literal["EXTEND", "COLLECT", "NEW_HIRE"]
    actor: str = Field(min_length=2, max_length=60)
    site_id: Optional[str] = None
    days: Optional[int] = Field(default=None, ge=1, le=365)
    note: Optional[str] = Field(default=None, max_length=MAX_TEXT)


@app.post("/hire-request", status_code=201)
def raise_hire_request(body: HireRequest):
    """Raised by a hirer, worked by the yard. Append-only, like everything else here."""
    _find(body.equipment_id)          # 404s on a machine that does not exist
    row = {
        "request_id": f"REQ{len(HIRE_REQUESTS) + 1:04d}",
        "raised_at": datetime.now().isoformat(timespec="seconds"),
        "status": "OPEN",
        **body.model_dump(),
    }
    HIRE_REQUESTS.append(row)
    store.write_hire_request(row)
    return row


@app.get("/hire-requests")
def list_hire_requests(site_id: Optional[str] = Query(default=None)):
    """The yard sees everything; a hirer sees only their own site's."""
    if site_id:
        return [r for r in HIRE_REQUESTS if r.get("site_id") == site_id]
    return HIRE_REQUESTS


class HireRequestActionIn(BaseModel):
    action: Literal["ACCEPT", "DECLINE", "FULFILL"]
    actor: str = Field(default="yard", max_length=64)
    reason: Optional[str] = Field(default=None, max_length=MAX_TEXT)


@app.post("/hire-request/{request_id}/action", status_code=200)
def action_hire_request(request_id: str, body: HireRequestActionIn):
    req = next((r for r in HIRE_REQUESTS if r.get("request_id") == request_id), None)
    if not req:
        raise HTTPException(404, "request not found")
    req["status"] = "ACCEPTED" if body.action == "ACCEPT" else "DECLINED" if body.action == "DECLINE" else "FULFILLED"
    if body.reason:
        req["rejection_reason"] = body.reason

    eq_id = req.get("equipment_id")
    site_id = req.get("site_id")
    if body.action in ("ACCEPT", "FULFILL") and eq_id:
        a = next((x for x in ASSETS if x.equipment_id == eq_id), None)
        if a:
            if req.get("kind") == "NEW_HIRE":
                a.on_rent = True
                if site_id:
                    a.site_id = site_id
                append_event(EventIn(
                    equipment_id=eq_id,
                    event_type="CHECK_OUT",
                    actor=body.actor,
                    site_id=a.site_id,
                    notes=f"Accepted hire request {request_id}"
                ))
                append_event(EventIn(
                    equipment_id=eq_id,
                    event_type="ASSIGN",
                    actor=body.actor,
                    site_id=a.site_id,
                    notes=f"Assigned via hire request {request_id}"
                ))
            elif req.get("kind") == "COLLECT":
                append_event(EventIn(
                    equipment_id=eq_id,
                    event_type="CHECK_IN",
                    actor=body.actor,
                    condition_grade=a.condition_grade,
                    notes=f"Collected via hire request {request_id}"
                ))
    store.write_hire_request(req)
    return req






@app.get("/maintenance-risk")

def maintenance_risk():

    return _safe_bundle().maintenance





@app.get("/ledger")

def get_ledger():

    """

    Two numbers, kept apart on purpose.



    `total_recovered_inr` is what the operator has actually actioned in this session.

    `exposure` is what the open flags are worth, split into money already burned, money

    still billable, and downtime avoided - because adding those three together produces

    a figure that does not survive the first question about it.

    """

    bundle = _safe_bundle()

    return {

        "entries": LEDGER,

        "total_recovered_inr": sum(e.est_value_inr for e in LEDGER),

        "exposure": intelligence.value_summary(bundle.anomalies, CONFIG),

    }





class LedgerIn(BaseModel):

    equipment_id: str = Field(max_length=64)

    action: str = Field(max_length=MAX_TEXT)

    est_value_inr: int = Field(ge=0)

    rule_id: Optional[str] = Field(default=None, max_length=16)





@app.post("/ledger", status_code=201)

def add_ledger(body: LedgerIn, idempotency_key: Optional[str] = Header(default=None)):

    """

    Send an Idempotency-Key and a repeat of the same gesture returns the original row

    rather than appending another. Without a key the old behaviour is unchanged, so

    existing callers and curl still work.

    """

    if idempotency_key and idempotency_key in IDEMPOTENT:

        return IDEMPOTENT[idempotency_key]

    entry = LedgerEntry(entry_id=str(uuid.uuid4()), timestamp=datetime.now(), **body.model_dump())

    LEDGER.append(entry)

    if idempotency_key:

        IDEMPOTENT[idempotency_key] = entry

    return entry





@app.get("/config")

def get_config():

    return CONFIG





@app.put("/config")

def put_config(patch: dict, _: None = Depends(require_admin)):

    """Judge changes a day rate live and the ledger recomputes. Do not skip this."""

    _validate_patch(patch, cfg.as_dict())

    _deep_merge(CONFIG, patch)

    return CONFIG





@app.post("/reset")

def reset(_: None = Depends(require_admin)):

    """One key restores exact demo state. Bind it to a button before rehearsal."""

    global ASSETS, TELEMETRY, EVENTS, BOOKINGS

    ASSETS = _load_assets()

    HIRE_REQUESTS.clear()
    TELEMETRY = _load_telemetry()

    EVENTS = _load_events()

    BOOKINGS = _load_bookings()

    LEDGER.clear()

    USAGE_LOGS.clear()

    IDEMPOTENT.clear()

    CONFIG.clear()

    CONFIG.update(cfg.as_dict())

    return {"ok": True, "assets": len(ASSETS), "events": len(EVENTS)}

