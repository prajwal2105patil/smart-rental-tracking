"""
PRAJWAL OWNS THIS FILE. Nobody else edits it.

Rules of the house:
  - No database. No HTTP. No file reads. No datetime.now(). Pure functions only.
  - Everything you need arrives as arguments. Everything you produce is returned.
  - Every verdict ships the Signals that produced it. No exceptions.
  - Read every threshold from `config`, never from a literal in this file.

Nirav calls exactly one thing:
    bundle = analyze(assets, telemetry, bookings, config)

Three deliverables:
    1. anomalies      -> rules R1..R7, each with the fields and thresholds that fired it.
    2. availability   -> the "can I promise Monday?" engine, incl. inter-branch transfer.
    3. maintenance    -> coolant trend -> SPN 110 / FMI 0.

Nothing here is trained and nothing here is random. Every number is arithmetic a judge
can reproduce by hand from the fields printed on screen, and two runs are byte-identical.
The only statistical step in the whole module is the least-squares slope in
assess_maintenance, and its inputs are on the sparkline.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta

import numpy as np

SECONDS_PER_DAY = 24 * 60 * 60

from schemas import (
    Asset, TelemetrySnapshot, Booking, Signal, Anomaly,
    AvailabilityAnswer, MaintenanceRisk, IntelligenceBundle,
)


# ============================================================== helpers
def utilisation(a: Asset) -> float:
    total = a.engine_hours_day + a.idle_hours_day
    return 0.0 if total == 0 else a.engine_hours_day / total


def day_rate(a: Asset, config: dict) -> int:
    """
    The rate card is live. Read it from config so the settings screen actually moves the
    money, and fall back to the value stamped on the asset if the type is unknown.

    `rate_basis` picks between the dealer published card and the rate implied by real
    catalogue list prices. Published is the default; price-implied is the cross-check.
    """
    basis = config.get("rate_basis", "published")
    table = (config.get("day_rates_price_implied") if basis == "price_implied"
             else config.get("day_rates")) or {}
    return int(table.get(a.type, a.day_rate))


def hourly_rate(a: Asset, config: dict) -> float:
    hours = a.engine_hours_day + a.idle_hours_day or config["default_hours_per_day"]
    return day_rate(a, config) / hours


def idle_waste_inr(a: Asset, config: dict) -> int:
    return int(a.idle_hours_day * a.operating_days * hourly_rate(a, config))


def inr_words(n: int) -> str:
    """Indian digit grouping for prose: 6,20,000 rather than 620,000."""
    s, out = str(int(n)), ""
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        out = ",".join(parts) + "," + tail
    else:
        out = s
    return "INR " + out


def rental_line_inr(a: Asset, config: dict) -> int:
    """The whole rental line: what the customer is billed for the days it was out."""
    return int(day_rate(a, config) * a.operating_days)


def days_overdue(a: Asset, now: date) -> int:
    if not a.on_rent or a.check_in_date is None:
        return 0
    return max(0, (now - a.check_in_date).days)


def branch_of(a: Asset, config: dict, default: str | None = None) -> str | None:
    """
    Which dealer yard this machine belongs to.

    An asset with no site is unassigned - nobody knows where it is, and recovering it is
    the recommended action anyway - so it is treated as available at the branch being
    asked about rather than penalised for a transfer we cannot evidence.
    """
    if a.site_id is None:
        return default
    return config.get("site_branch", {}).get(a.site_id, default)


def transit_between(origin: str | None, destination: str | None, config: dict) -> int:
    """Days to move a machine between branches. 0 when it is already there."""
    if origin is None or destination is None or origin == destination:
        return 0
    matrix = config.get("branch_transit_days", {})
    return int(matrix.get(f"{origin}>{destination}",
                          matrix.get(f"{destination}>{origin}", config["transit_days"])))


def branch_label(store_id: str | None, config: dict) -> str:
    branch = config.get("branches", {}).get(store_id or "", {})
    return f"{store_id} {branch['city']}" if branch.get("city") else str(store_id)


# ============================================================== 1. ANOMALIES
def find_anomalies(assets: list[Asset], config: dict) -> list[Anomaly]:
    now = date.fromisoformat(config["now"])
    out: list[Anomaly] = []

    for a in assets:

        # ---- R1 UNASSIGNED_ACTIVE ------------------------------- WORKED EXAMPLE
        if a.site_id is None and (a.idle_hours_day > 0 or a.engine_hours_day > 0):
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R1",
                severity="CRITICAL",
                title="On rent with no site assigned",
                signals=[
                    Signal(field="site_id", value="NULL", threshold="must not be null"),
                    Signal(field="operator_id", value=str(a.operator_id), threshold="must not be null"),
                    Signal(field="engine_hours_day", value=str(a.engine_hours_day)),
                    Signal(field="idle_hours_day", value=str(a.idle_hours_day), threshold="> 0"),
                ],
                est_value_inr=rental_line_inr(a, config),   # whole rental line is waste
                recommended_action="Reassign to an active site or return to yard",
            ))

        # ---- R2 IDLE_BURN ---------------------------------------------------
        # Guarded on engine_hours_day > 0: a machine with zero output is R3's case, and
        # firing both would bill the same rental line twice in the ledger.
        if (a.engine_hours_day > 0
                and utilisation(a) < config["idle_utilisation_warn"]
                and a.operating_days >= config["idle_burn_min_days"]):
            critical = utilisation(a) < config["idle_utilisation_crit"]
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R2",
                severity="CRITICAL" if critical else "WARNING",
                title="Paying for a machine that is mostly standing still",
                signals=[
                    Signal(field="utilisation", value=f"{utilisation(a):.1%}",
                           threshold=f"< {config['idle_utilisation_crit']:.0%}" if critical
                                     else f"< {config['idle_utilisation_warn']:.0%}"),
                    Signal(field="engine_hours_day", value=str(a.engine_hours_day)),
                    Signal(field="idle_hours_day", value=str(a.idle_hours_day)),
                    Signal(field="operating_days", value=str(a.operating_days),
                           threshold=f">= {config['idle_burn_min_days']}"),
                ],
                est_value_inr=idle_waste_inr(a, config),
                recommended_action="Redeploy to a site with active demand",
            ))

        # ---- R3 ZERO_OUTPUT ------------------------------------- WORKED EXAMPLE
        if a.engine_hours_day == 0 and a.operating_days >= config["zero_output_min_days"]:
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R3",
                severity="CRITICAL",
                title="Zero productive output across the whole rental",
                signals=[
                    Signal(field="engine_hours_day", value="0", threshold="> 0"),
                    Signal(field="operating_days", value=str(a.operating_days),
                           threshold=f">= {config['zero_output_min_days']}"),
                ],
                est_value_inr=rental_line_inr(a, config),
                recommended_action="Recall the asset — it has never been worked",
            ))

        # ---- R4 WINDOW_CONFLICT --------------------------------- WORKED EXAMPLE
        # The one Caterpillar did NOT put on their slide. Cross-field contradiction.
        if a.check_out_date and a.check_in_date:
            window = (a.check_in_date - a.check_out_date).days + 1
            if a.operating_days > window:
                out.append(Anomaly(
                    equipment_id=a.equipment_id,
                    rule_id="R4",
                    severity="WARNING",
                    title="Operating days exceed the rental window — record cannot be true",
                    signals=[
                        Signal(field="operating_days", value=str(a.operating_days)),
                        Signal(field="rental_window_days", value=str(window),
                               threshold=f"operating_days must be <= {window}"),
                        Signal(field="check_out_date", value=str(a.check_out_date)),
                        Signal(field="check_in_date", value=str(a.check_in_date)),
                    ],
                    est_value_inr=int(day_rate(a, config) * (a.operating_days - window)),
                    recommended_action="Audit this contract — mis-logged return or unbilled extension",
                ))

        # ---- R5 SERVICE_DUE -------------------------------------------------
        if a.hours_since_service >= config["service_interval_hours"]:
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R5",
                severity="WARNING",
                title="Past its service interval — do not dispatch before servicing",
                signals=[
                    Signal(field="hours_since_service", value=str(a.hours_since_service),
                           threshold=f">= {config['service_interval_hours']}"),
                    Signal(field="cumulative_operating_hours",
                           value=str(a.cumulative_operating_hours)),
                    Signal(field="condition_grade", value=a.condition_grade),
                ],
                est_value_inr=int(day_rate(a, config) * config["service_days"]),
                recommended_action="Schedule service before next dispatch",
            ))

        # ---- R6 OVERDUE -----------------------------------------------------
        # Uses on_rent, not projected status: status is computed in the API layer and
        # this module is pure. on_rent is the field that carries the same meaning here.
        overdue = days_overdue(a, now)
        if a.on_rent and overdue > 0:
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R6",
                severity="CRITICAL",
                title="Past its scheduled return date and still out",
                signals=[
                    Signal(field="check_in_date", value=str(a.check_in_date),
                           threshold=f"must be >= {now.isoformat()}"),
                    Signal(field="days_overdue", value=str(overdue), threshold="> 0"),
                    Signal(field="on_rent", value=str(a.on_rent)),
                ],
                est_value_inr=int(overdue * day_rate(a, config)),
                recommended_action="Contact customer — recall or bill the extension",
            ))

        # ---- R8 DUE_SOON ----------------------------------------------------
        # The brief asks for a reminder when the return time is APPROACHING, not only
        # when it has already passed. R6 covers late; this covers the days before, which
        # is the window in which the dealer can still act - chase the customer, or
        # commit the machine to the next booking.
        days_left = ((a.check_in_date - now).days
                     if a.on_rent and a.check_in_date else None)
        if days_left is not None and 0 < days_left <= config["due_soon_days"]:
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R8",
                severity="INFO",
                title="Due back within the reminder window",
                signals=[
                    Signal(field="check_in_date", value=str(a.check_in_date)),
                    Signal(field="days_until_return", value=str(days_left),
                           threshold=f"<= {config['due_soon_days']}"),
                    Signal(field="site_id", value=str(a.site_id)),
                ],
                est_value_inr=0,   # nothing lost yet - that is the point of the reminder
                recommended_action=(f"Confirm return with the customer, or commit it to "
                                    f"the next booking from {a.check_in_date}"),
            ))

        # ---- R7 NO_OPERATOR -------------------------------------------------
        if a.operator_id is None and a.on_rent:
            out.append(Anomaly(
                equipment_id=a.equipment_id,
                rule_id="R7",
                severity="WARNING",
                title="On rent with nobody assigned to run it",
                signals=[
                    Signal(field="operator_id", value="NULL", threshold="must not be null"),
                    Signal(field="on_rent", value=str(a.on_rent), threshold="== True"),
                    Signal(field="operating_days", value=str(a.operating_days)),
                ],
                est_value_inr=int(day_rate(a, config) * a.operating_days
                                  * config["no_operator_waste_share"]),
                recommended_action="Assign an operator or return the asset",
            ))

    return out


# ---- what the flags are worth, without lying about it -----------------------
# Three rules produce three DIFFERENT kinds of money, and adding them together gives a
# number that does not survive one question. EQX1002 is a worked example: R3 says the
# whole 20-day rental was waste (INR 440,000 already burned) while R6 says it is 43 days
# past return (INR 946,000 you can still bill). Both are true. Their sum is meaningless.
#
#   waste       already burned            R1 · R2 · R3 · R7
#   recoverable still billable / auditable R4 · R6
#   avoided     downtime not yet incurred  R5
#
# Inside `waste`, several rules can fire on one machine for the same rental line, so the
# per-asset maximum is taken rather than the sum - otherwise EQX1002 is charged twice.
VALUE_CATEGORY = {
    "R1": "waste", "R2": "waste", "R3": "waste", "R7": "waste",
    "R4": "recoverable", "R6": "recoverable",
    "R5": "avoided",
    "R8": "reminder",          # a due-back notice; nothing is lost yet, so it is worth 0
}


def value_summary(anomalies: list[Anomaly], config: dict) -> dict:
    """Pure. What the ledger header should show, split by what the money actually is."""
    buckets: dict[str, dict[str, int]] = {
        "waste": {}, "recoverable": {}, "avoided": {}, "reminder": {},
    }
    for an in anomalies:
        bucket = buckets[VALUE_CATEGORY.get(an.rule_id, "waste")]
        bucket[an.equipment_id] = max(bucket.get(an.equipment_id, 0), an.est_value_inr)

    totals = {name: sum(rows.values()) for name, rows in buckets.items()}
    return {
        "waste_inr": totals["waste"],
        "recoverable_inr": totals["recoverable"],
        "avoided_inr": totals["avoided"],
        "total_exposure_inr": totals["waste"] + totals["recoverable"] + totals["avoided"],
        "by_asset": {
            name: dict(sorted(rows.items())) for name, rows in buckets.items()
        },
        "note": ("waste is money already spent; recoverable is money still billable; "
                 "avoided is downtime not yet incurred. They are not added together in "
                 "the pitch because they are three different claims."),
    }


def usage_summary(assets: list[Asset], config: dict) -> dict:
    """
    Pure. The brief asks for "summary of total rented hours, usage per site, downtime".

    Definitions, stated so nobody has to guess what a column means:
      rented_days   sum of operating_days for machines at that site
      engine_hours  productive hours          = engine_hours_day * operating_days
      idle_hours    engine on, no work done   = idle_hours_day   * operating_days
      downtime      idle hours - the machine was rented and produced nothing in them
      utilisation   engine / (engine + idle), 0 when the machine never ran
    """
    sites: dict[str, dict] = {}
    for a in assets:
        key = a.site_id or "UNASSIGNED"
        row = sites.setdefault(key, {
            "site_id": key,
            "branch_id": config.get("site_branch", {}).get(key),
            "assets": 0, "rented_days": 0,
            "engine_hours": 0.0, "idle_hours": 0.0, "downtime_hours": 0.0,
            "idle_cost_inr": 0,
        })
        engine = a.engine_hours_day * a.operating_days
        idle = a.idle_hours_day * a.operating_days
        row["assets"] += 1
        row["rented_days"] += a.operating_days
        row["engine_hours"] += engine
        row["idle_hours"] += idle
        row["downtime_hours"] += idle
        row["idle_cost_inr"] += idle_waste_inr(a, config)

    for row in sites.values():
        total = row["engine_hours"] + row["idle_hours"]
        row["utilisation_pct"] = round(100 * row["engine_hours"] / total, 1) if total else 0.0
        for k in ("engine_hours", "idle_hours", "downtime_hours"):
            row[k] = round(row[k], 1)

    ordered = sorted(sites.values(), key=lambda r: r["utilisation_pct"])
    engine_total = round(sum(r["engine_hours"] for r in ordered), 1)
    idle_total = round(sum(r["idle_hours"] for r in ordered), 1)
    grand = engine_total + idle_total
    return {
        "by_site": ordered,
        "fleet": {
            "assets": sum(r["assets"] for r in ordered),
            "rented_days": sum(r["rented_days"] for r in ordered),
            "engine_hours": engine_total,
            "idle_hours": idle_total,
            "downtime_hours": idle_total,
            "utilisation_pct": round(100 * engine_total / grand, 1) if grand else 0.0,
            "idle_cost_inr": sum(r["idle_cost_inr"] for r in ordered),
        },
    }


# ============================================================== 2. AVAILABILITY
def _free_from(a: Asset, config: dict, now: date) -> date:
    """
    When this machine is next available from its own yard.

    Clamped at NOW: EQX1007 is flagged on_rent with a check-in date of 2025-04-01, six
    weeks in the past. Its raw free_from lands before today, which is meaningless as a
    commitment date - the honest reading is that it is available right now.
    """
    if not a.on_rent:
        free = now
    else:
        free = (a.check_in_date or now) + timedelta(days=config["transit_days"])
    if a.hours_since_service >= config["service_interval_hours"]:
        free += timedelta(days=config["service_days"])
    return max(now, free)


def _confidence(free: date, needed_from: date, now: date,
                transfer: bool, config: dict) -> float:
    if free <= now:
        conf = config["confidence_at_yard"]
    else:
        slack = (needed_from - free).days
        if slack >= config["confidence_early_days"]:
            conf = config["confidence_early"]
        elif slack > 0:
            conf = config["confidence_day_before"]
        else:
            conf = config["confidence_tight"]
    if transfer:
        conf -= config["confidence_transfer_penalty"]
    return round(conf, 2)


def answer_availability(
    assets: list[Asset], equipment_type: str, site_id: str,
    needed_from: date, days: int, config: dict,
) -> AvailabilityAnswer:
    """
    The judge's own example: 'a customer wants an excavator next Monday — can I commit?'
    This is NOT a demand forecast. Do not build a bar chart.

    Ranking: local before transferred, then earliest free, then best condition, then
    lowest cumulative hours. Condition sorts A -> B -> C, so ascending is best-first.

    The best answer in this dataset is EQX1007 — sitting unused, unassigned, zero output.
    'You do not have to wait for Friday. You already have one doing nothing.'
    """
    now = date.fromisoformat(config["now"])
    target_branch = config.get("site_branch", {}).get(site_id)
    fleet = [a for a in assets if a.type.lower() == equipment_type.lower()]

    candidates = []
    for a in fleet:
        home = branch_of(a, config, default=target_branch)
        move = transit_between(home, target_branch, config)
        free = _free_from(a, config, now) + timedelta(days=move)
        candidates.append({
            "asset": a, "free": free, "home": home,
            "transfer": move > 0, "move_days": move,
        })

    eligible = [c for c in candidates if c["free"] <= needed_from]
    eligible.sort(key=lambda c: (
        c["transfer"], c["free"], c["asset"].condition_grade,
        c["asset"].cumulative_operating_hours,
    ))

    if eligible:
        best = eligible[0]
        a = best["asset"]
        conf = _confidence(best["free"], needed_from, now, best["transfer"], config)

        if best["free"] <= now and not best["transfer"]:
            if a.site_id is None:
                reason = (f"{a.equipment_id} is already yours and doing nothing — no site, "
                          f"no operator, {a.engine_hours_day} engine hours a day. "
                          f"Available immediately; you do not have to wait for a return.")
            else:
                reason = (f"{a.equipment_id} is back at {branch_label(best['home'], config)} "
                          f"and available immediately.")
        elif best["transfer"]:
            reason = (f"{a.equipment_id} frees at {branch_label(best['home'], config)} and "
                      f"needs {best['move_days']} day(s) to reach "
                      f"{branch_label(target_branch, config)}, available "
                      f"{best['free'].isoformat()}.")
        else:
            reason = (f"{a.equipment_id} returns {a.check_in_date}, "
                      f"{config['transit_days']} day transit, available "
                      f"{best['free'].isoformat()}.")

        alternatives = [
            f"{c['asset'].equipment_id} also fits — free {c['free'].isoformat()}"
            + (f" (transfer from {branch_label(c['home'], config)})" if c["transfer"] else "")
            for c in eligible[1:1 + int(config["max_alternatives"])]
        ]

        return AvailabilityAnswer(
            can_commit=True,
            equipment_id=a.equipment_id,
            free_from=best["free"],
            confidence=conf,
            reason=reason,
            alternatives=alternatives,
        )

    # ---- nothing fits the date -------------------------------------------
    alternatives: list[str] = []
    if candidates:
        soonest = min(candidates, key=lambda c: c["free"])
        alternatives.append(
            f"Earliest available {equipment_type} is "
            f"{soonest['free'].isoformat()} ({soonest['asset'].equipment_id})"
        )

    ghosts = [a for a in fleet
              if a.site_id is None or (a.engine_hours_day == 0
                                       and a.operating_days >= config["zero_output_min_days"])]
    for g in ghosts:
        alternatives.append(
            f"Recall {g.equipment_id} — unassigned with zero output, "
            f"{g.idle_hours_day} idle hours a day"
        )

    working = [a for a in fleet if a.site_id is not None]
    if working:
        weakest = min(working, key=utilisation)
        alternatives.append(
            f"Extend {weakest.equipment_id} at {weakest.site_id} — "
            f"currently at {utilisation(weakest):.0%}"
        )

    return AvailabilityAnswer(
        can_commit=False,
        confidence=config["confidence_tight"],
        reason=(f"No {equipment_type} can be at {branch_label(target_branch, config)} by "
                f"{needed_from.isoformat()} for {days} days."),
        alternatives=alternatives,
    )


# ============================================================== 3. MAINTENANCE
def _reading(snapshot, field: str):
    """Tolerates either a TelemetrySnapshot or the raw dict it was built from."""
    return snapshot.get(field) if isinstance(snapshot, dict) else getattr(snapshot, field)


def _as_datetime(value) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value))


def assess_maintenance(
    assets: list[Asset], telemetry: list[TelemetrySnapshot], config: dict,
) -> list[MaintenanceRisk]:
    """
    The judge asked for this by name: 'engine temperature running too high ... because of
    this fault code your engine is overheated, and you need to replace a certain part.'

    Fire when the rolling mean of the last 24 readings exceeds coolant_warn_c AND the
    least-squares slope over the trailing window is rising faster than coolant_slope_min.

    Emit SPN 110 / FMI 0 — genuine SAE J1939, engine coolant temperature above normal,
    most severe. Do not invent codes.

    A parked machine emits no engine telemetry, so this reads the tail of each machine's
    OPERATING series. days_to_failure is therefore operating days, not calendar days —
    which is the number that matters, because the countdown only resumes on dispatch.
    """
    if not telemetry:
        return []

    by_asset: dict[str, list] = {}
    for snap in telemetry:
        by_asset.setdefault(_reading(snap, "equipment_id"), []).append(snap)

    out: list[MaintenanceRisk] = []
    for a in assets:
        series = by_asset.get(a.equipment_id)
        if not series:
            continue
        series = sorted(series, key=lambda s: _as_datetime(_reading(s, "datetime")))

        window = int(config["rolling_window_readings"])
        tail = series[-window:]
        if len(tail) < window:
            continue
        rolling = float(np.mean([_reading(s, "engine_coolant_temp_c") for s in tail]))
        if rolling <= config["coolant_warn_c"]:
            continue

        # Least-squares slope in degrees per day over the trailing window.
        last_ts = _as_datetime(_reading(series[-1], "datetime"))
        cutoff = last_ts - timedelta(days=config["slope_window_days"])
        recent = [s for s in series if _as_datetime(_reading(s, "datetime")) >= cutoff]
        if len(recent) < window:
            continue
        xs = np.array([(_as_datetime(_reading(s, "datetime")) - cutoff).total_seconds()
                       / timedelta(days=1).total_seconds() for s in recent])
        ys = np.array([_reading(s, "engine_coolant_temp_c") for s in recent], dtype=float)
        slope = float(np.polyfit(xs, ys, 1)[0])
        if slope <= config["coolant_slope_min"]:
            continue

        out.append(MaintenanceRisk(
            equipment_id=a.equipment_id,
            spn=110,
            fmi=0,
            label="Engine Coolant Temperature — data valid but above normal, most severe",
            part="Cooling package: radiator core + thermostat",
            action=(f"Schedule inspection before next dispatch — "
                    f"{a.hours_since_service:g}h since last service"),
            days_to_failure=round(
                (config["coolant_failure_c"] - rolling) / slope, 2),
            current_temp_c=round(rolling, 2),
            slope=round(slope, 3),
        ))
    return out


# ============================================================== THE HANDOFF
# ============================================================== 4. DEMAND FORECAST
def _working_rate(
    equipment_id: str, telemetry: list[TelemetrySnapshot], now: date, window_days: int,
) -> float | None:
    """Engine hours per day for one machine, MEASURED over the trailing window.

    Read from the cumulative counter rather than the declared daily field, because
    the counter is what the machine itself reports and cannot be edited by hand.
    Returns None when the window holds fewer than two readings to divide between.
    """
    start = datetime.combine(now - timedelta(days=window_days), datetime.min.time())
    end = datetime.combine(now, datetime.max.time())
    rows = sorted(
        (t for t in telemetry
         if t.equipment_id == equipment_id and start <= _as_datetime(t.datetime) <= end),
        key=lambda t: _as_datetime(t.datetime),
    )
    if len(rows) < 2:
        return None
    span_days = (_as_datetime(rows[-1].datetime)
                 - _as_datetime(rows[0].datetime)).total_seconds() / SECONDS_PER_DAY
    if span_days <= 0:
        return None
    worked = rows[-1].cumulative_operating_hours - rows[0].cumulative_operating_hours
    return max(0.0, worked / span_days)


def _daily_series(
    members: list[Asset], telemetry: list[TelemetrySnapshot], now: date, window_days: int,
) -> list[dict]:
    """Engine hours per day for a group of machines, day by day, over the window.

    This is the history the projection is read off - the same series, not a second
    one drawn to agree with it. A judge can point at the last bar and ask where the
    number came from, and the answer is already on the screen.
    """
    by_day: dict[str, dict[str, list[float]]] = {}
    ids = {a.equipment_id for a in members}
    first = now - timedelta(days=window_days)
    for t in telemetry:
        if t.equipment_id not in ids:
            continue
        day = _as_datetime(t.datetime).date()
        if day < first or day > now:
            continue
        by_day.setdefault(day.isoformat(), {}).setdefault(t.equipment_id, []).append(
            t.cumulative_operating_hours)

    series = []
    for day in sorted(by_day):
        # Per machine, hours worked that day is the counter's rise across the day.
        hours = sum(max(0.0, max(v) - min(v)) for v in by_day[day].values())
        series.append({"date": day, "engine_hours": round(hours, 2)})
    return series


def forecast_demand(
    assets: list[Asset],
    telemetry: list[TelemetrySnapshot],
    bookings: list[Booking],
    config: dict,
) -> list[dict]:
    """Which site is likely to need which machine, and when.

    This is a projection, not a regression, and the difference is the whole point.
    There is no demand curve here to fit: the catalogue behind this build carries
    eleven years of monthly volume flat to within three percent, so a fitted model
    would draw a horizontal line and call it a forecast. What IS knowable is
    mechanical -

        a site is working a machine type at a measured rate, and a machine of that
        type is scheduled to leave inside the horizon. The site will be short from
        the day it goes.

    Every row therefore carries the rate that was measured, the machines leaving,
    the date they leave and what cover remains, so the prediction can be argued
    with rather than believed. Bookings already on the books are reported in the
    same shape at full confidence, because a request is not a guess.
    """
    now = date.fromisoformat(config["now"])
    horizon = config["forecast_horizon_days"]
    window = config["forecast_window_days"]
    floor_h = config["forecast_min_intensity_h"]
    strong_h = config["forecast_high_conf_h"]
    limit = now + timedelta(days=horizon)

    # Measured where telemetry allows it, declared where it does not. Which one was
    # used is reported per row, because it changes what the row is worth.
    rate: dict[str, float] = {}
    measured: set[str] = set()
    for a in assets:
        m = _working_rate(a.equipment_id, telemetry, now, window)
        if m is None:
            rate[a.equipment_id] = a.engine_hours_day
        else:
            rate[a.equipment_id] = m
            measured.add(a.equipment_id)

    rows: list[dict] = []

    # ---- a site loses a machine it is currently working -----------------------
    groups: dict[tuple[str, str], list[Asset]] = {}
    for a in assets:
        if a.site_id and a.on_rent:
            groups.setdefault((a.site_id, a.type), []).append(a)

    for (site, kind), members in sorted(groups.items()):
        going = [a for a in members
                 if a.check_in_date and now <= a.check_in_date <= limit]
        if not going:
            continue

        gone_ids = {a.equipment_id for a in going}
        lost = sum(rate[a.equipment_id] for a in going)
        if lost < floor_h:
            continue                      # the site was not really working them

        leaves = min(a.check_in_date for a in going)
        cover = sum(rate[a.equipment_id] for a in members
                    if a.equipment_id not in gone_ids)
        # Confidence is the measured rate against the rate we call confident, capped -
        # and cut when the rate had to be taken on trust instead of read off a counter.
        conf = min(1.0, lost / strong_h)
        if not gone_ids <= measured:
            conf -= config["confidence_transfer_penalty"]
        conf = max(0.0, conf)

        article = "an" if kind[:1].lower() in "aeiou" else "a"
        rows.append({
            "site_id": site,
            "site_label": branch_label(site, config),
            "equipment_type": kind,
            "needed_from": leaves.isoformat(),
            "basis": "return",
            "headline": (f"{branch_label(site, config)} is likely to need {article} "
                         f"{kind.lower()} on {leaves.isoformat()}."),
            "confidence": round(conf, 2),
            "signals": [
                {"field": "engine_hours_day (leaving)", "value": round(lost, 2),
                 "threshold": floor_h},
                {"field": "machines_leaving", "value": len(going), "threshold": None},
                {"field": "check_in_date", "value": leaves.isoformat(),
                 "threshold": limit.isoformat()},
                {"field": "cover_remaining_h", "value": round(cover, 2), "threshold": None},
                {"field": "rate_source",
                 "value": "measured" if gone_ids <= measured else "declared",
                 "threshold": f"{window}d telemetry"},
            ],
            "leaving": sorted(gone_ids),
            "history": _daily_series(members, telemetry, now, window),
        })

    # ---- a booking already asked for it ---------------------------------------
    for b in bookings:
        if not (now <= b.needed_from <= limit):
            continue
        rows.append({
            "site_id": b.site_id,
            "site_label": branch_label(b.site_id, config),
            "equipment_type": b.equipment_type,
            "needed_from": b.needed_from.isoformat(),
            "basis": "booking",
            "headline": (f"{b.customer} has asked for {b.equipment_type.lower()} cover at "
                         f"{branch_label(b.site_id, config)} from "
                         f"{b.needed_from.isoformat()} for {b.days} days."),
            # A request is not a prediction. It is already true.
            "confidence": config["confidence_at_yard"],
            "signals": [
                {"field": "booking_id", "value": b.booking_id, "threshold": None},
                {"field": "needed_from", "value": b.needed_from.isoformat(),
                 "threshold": limit.isoformat()},
                {"field": "days", "value": b.days, "threshold": None},
                {"field": "status", "value": b.status, "threshold": None},
            ],
            "leaving": [],
            "history": [],
        })

    # Each row now answers the question it raises: which machine covers this, and
    # from where. The recommendation is the availability engine, not a second guess.
    for r in rows:
        answer = answer_availability(
            assets, r["equipment_type"], r["site_id"],
            date.fromisoformat(r["needed_from"]), horizon, config,
        )
        r["recommendation"] = {
            "can_commit": answer.can_commit,
            "equipment_id": getattr(answer, "equipment_id", None),
            "free_from": (answer.free_from.isoformat()
                          if getattr(answer, "free_from", None) else None),
            "confidence": answer.confidence,
            "reason": answer.reason,
            "alternatives": list(answer.alternatives or []),
        }

    rows.sort(key=lambda r: (r["needed_from"], -r["confidence"]))
    return rows


def analyze(
    assets: list[Asset],
    telemetry: list[TelemetrySnapshot],
    bookings: list[Booking],
    config: dict,
) -> IntelligenceBundle:
    """The only function Nirav calls. Signature is frozen. Keep it pure."""
    availability = None
    if bookings:
        b = bookings[0]
        availability = answer_availability(
            assets, b.equipment_type, b.site_id, b.needed_from, b.days, config
        )

    return IntelligenceBundle(
        anomalies=find_anomalies(assets, config),
        availability=availability,
        maintenance=assess_maintenance(assets, telemetry, config),
    )


# ============================================================== smoke test
if __name__ == "__main__":
    import json, pathlib
    import config as cfg

    data = pathlib.Path(__file__).resolve().parent.parent / "data"

    def load(name):
        path = data / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    assets = [Asset(**{k: v for k, v in a.items() if not k.startswith("_")})
              for a in load("seed_assets.json")]
    telemetry = [TelemetrySnapshot(**t) for t in load("seed_telemetry.json")]
    bookings = [Booking(**b) for b in load("seed_bookings.json")]
    conf = cfg.as_dict()

    bundle = analyze(assets, telemetry, bookings, conf)

    print(f"{len(assets)} assets | {len(telemetry):,} telemetry rows | {len(bookings)} bookings\n")
    for an in sorted(bundle.anomalies, key=lambda x: (x.rule_id, x.equipment_id)):
        print(f"{an.rule_id}  {an.equipment_id:8}  {an.severity:8}  "
              f"INR {an.est_value_inr:>9,}  {an.title}")
        assert an.signals, f"{an.rule_id} on {an.equipment_id} shipped no signals"
    print(f"\n{len(bundle.anomalies)} anomalies, every one with signals attached.")

    vs = value_summary(bundle.anomalies, conf)
    print(f"\nwaste already burned      INR {vs['waste_inr']:>10,}   (R1/R2/R3/R7)")
    print(f"still billable            INR {vs['recoverable_inr']:>10,}   (R4/R6)")
    print(f"downtime avoided          INR {vs['avoided_inr']:>10,}   (R5)")
    print(f"                          {'-' * 14}")
    print(f"total exposure            INR {vs['total_exposure_inr']:>10,}")
    zero_output = {k: v for k, v in vs["by_asset"]["waste"].items()
                   if k in ("EQX1002", "EQX1007")}
    print(f"the zero-output recovery claim: INR {sum(zero_output.values()):,} "
          f"({', '.join(zero_output)})")

    av = bundle.availability
    if av:
        print(f"\navailability: can_commit={av.can_commit} asset={av.equipment_id} "
              f"free={av.free_from} confidence={av.confidence}")
        print(f"  {av.reason}")
        for alt in av.alternatives:
            print(f"  - {alt}")

    print()
    for m in bundle.maintenance:
        print(f"maintenance: {m.equipment_id} SPN {m.spn}/FMI {m.fmi} "
              f"{m.current_temp_c}C rising {m.slope}C/day -> "
              f"{m.days_to_failure} operating days to {conf['coolant_failure_c']}C")
        print(f"  {m.part} | {m.action}")
