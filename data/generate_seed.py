"""
Seed generator. Deterministic: same RANDOM_SEED in, byte-identical files out.

    python generate_seed.py

Writes seed_assets.json, seed_telemetry.json, seed_events.json, seed_bookings.json.

THE SEVEN GIVEN ROWS ARE NOT TOUCHED.
    They are read from seed_assets_given.json and copied through unchanged - every
    numeric field, the site ids, the model names, the serial numbers. That file is the
    audit trail: diff it against the first seven entries of seed_assets.json and the
    output must be identical. Everything the catalogue grounds is either NEW (the twenty
    synthetic assets, the bookings) or lives in config.py (the branch network, the
    price-implied rate cross-check).

HOW THE HISTORY RECONCILES TO THE GIVEN ROWS
    Every one of the seven satisfies both identities exactly:

        cumulative_operating_hours == engine_hours_day * operating_days
        total_idle_hours          == idle_hours_day   * operating_days

    Checked: 1.5*15=22.5, 0*20=0, 7.5*25=187.5, 2*25=50, 8*30=240, 3*18=54, 0*12=0.
    So the telemetry is fully determined by the given fields - it is not fitted, and it
    cannot drift from them. assert_reconciles() below re-proves it on every run.

WHY TELEMETRY ONLY EXISTS INSIDE THE OPERATING WINDOW
    A machine parked in the yard does not emit engine telemetry. Snapshots are generated
    for the operating window only, which is why EQX1005 - back at the yard since 31 Jan -
    carries a coolant trend that ENDS in January. That is the point: its cooling package
    was failing when it came back, and it is still sitting there un-serviced. The
    maintenance rule reads the tail of the operating series, not the last 7 calendar days.
"""
from __future__ import annotations
import json
import pathlib
import random
import sys
from datetime import date, datetime, timedelta

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "api"))

import config as cfg   # noqa: E402  (path juggling above is deliberate)

GIVEN = HERE / "seed_assets_given.json"

# ---- catalogue-grounded SKUs for the synthetic fleet -------------------------
# Real product keys from the source catalogue. Caterpillar carries an excavator, a
# bulldozer and a road paver; it carries NO crane, so the crane slot uses a real crane
# SKU from another maker - which is what a mixed rental fleet actually looks like.
FLEET_SKUS = {
    "Excavator": "EX-200",   # Excavators-Caterpillar-LightDuty-RedWhite
    "Bulldozer": "BZ-808",   # Bulldozers-Caterpillar-LightDuty-RedWhite
    "Grader":    "RP-236",   # RoadPavers-Caterpillar-Standard-Yellow
    "Crane":     "CR-107",   # Cranes-KoneCranes-HeavyDuty
}

# The synthetic fleet is deliberately HEALTHY. Every flag in the demo must trace to one
# of the seven given rows; a synthetic machine that trips a rule would be a number we
# invented arguing for a conclusion we invented.
SYNTH_UTIL_RANGE = (0.72, 0.94)
SYNTH_ENGINE_HOURS = (5.5, 8.5)
SYNTH_SERVICE_HOURS = (20, 185)      # strictly below SERVICE_INTERVAL_HOURS (200)
SYNTH_GRADES = ["A", "A", "A", "B", "B", "C"]

GEOFENCE_DEG = 0.02                  # site jitter around the branch centroid
FUEL_BURN_L_PER_HOUR = 12.0


def load_json(name: str):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def dump_json(name: str, payload) -> None:
    (HERE / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"  wrote {name:26} {len(payload):>6,} records")


# ============================================================== assets
def build_assets(rng: random.Random) -> list[dict]:
    """The seven given rows unchanged, then SYNTHETIC_FLEET_SIZE healthy machines."""
    given = load_json(GIVEN.name)
    assets = [dict(a) for a in given]          # copied through verbatim

    skus = {s["product_key"]: s for s in load_json("catalogue_skus.json")}
    branches = list(cfg.BRANCHES)
    sites = sorted(cfg.SITE_BRANCH)
    types = list(FLEET_SKUS)
    now = cfg.NOW

    for i in range(cfg.SYNTHETIC_FLEET_SIZE):
        eq_type = types[i % len(types)]
        sku = skus[FLEET_SKUS[eq_type]]
        eq_id = f"EQX{1008 + i}"

        engine = round(rng.uniform(*SYNTH_ENGINE_HOURS), 1)
        util = rng.uniform(*SYNTH_UTIL_RANGE)
        idle = round(engine * (1 - util) / util, 1)

        on_rent = rng.random() < 0.55
        checked_out = now - timedelta(days=rng.randint(10, 60))
        if on_rent:
            # Due back in the future, so the synthetic fleet never trips R6 OVERDUE.
            checked_in = now + timedelta(days=rng.randint(5, 40))
        else:
            checked_in = checked_out + timedelta(days=rng.randint(8, 30))

        window = (checked_in - checked_out).days + 1
        elapsed = (min(checked_in, now) - checked_out).days + 1
        operating_days = max(1, min(elapsed, window))    # never exceeds the window (R4)

        assets.append({
            "equipment_id": eq_id,
            "type": eq_type,
            "model": f"{sku['brand']} {sku['product_key']}",
            "serial_number": f"{sku['product_key'].replace('-', '')}PX{1008 + i:05d}",
            "site_id": sites[i % len(sites)],
            "operator_id": f"OP{400 + i}",
            "on_rent": on_rent,
            "check_out_date": checked_out.isoformat(),
            "check_in_date": checked_in.isoformat(),
            "engine_hours_day": engine,
            "idle_hours_day": idle,
            "operating_days": operating_days,
            "cumulative_operating_hours": round(engine * operating_days, 1),
            "hours_since_service": round(rng.uniform(*SYNTH_SERVICE_HOURS), 1),
            "day_rate": cfg.DAY_RATES[eq_type],
            "condition_grade": SYNTH_GRADES[i % len(SYNTH_GRADES)],
            "_read": (f"Synthetic. {util:.0%} utilisation, healthy. Grounded on catalogue "
                      f"SKU {sku['product_key']} ({sku['description']}), branch "
                      f"{cfg.SITE_BRANCH[sites[i % len(sites)]]}."),
        })
    return assets


def assert_reconciles(assets: list[dict]) -> None:
    """The identity that makes the synthetic history checkable against the given rows."""
    for a in assets:
        expected = round(a["engine_hours_day"] * a["operating_days"], 1)
        actual = round(a["cumulative_operating_hours"], 1)
        assert abs(expected - actual) < 0.05, (
            f"{a['equipment_id']}: cumulative_operating_hours {actual} != "
            f"engine_hours_day {a['engine_hours_day']} * operating_days "
            f"{a['operating_days']} = {expected}"
        )


# ============================================================== telemetry
def operating_window(a: dict) -> tuple[date, date]:
    """
    The operating_days calendar days ending at the last day the machine was working.

    For EQX1004 the window necessarily starts BEFORE its check-out date: the record
    claims 25 operating days inside an 11-day rental. That contradiction is rule R4 and
    it is in the given data - the generator surfaces it rather than papering over it.
    """
    checked_in = date.fromisoformat(a["check_in_date"]) if a["check_in_date"] else cfg.NOW
    last_day = min(checked_in, cfg.NOW)
    first_day = last_day - timedelta(days=a["operating_days"] - 1)
    return first_day, last_day


def build_telemetry(assets: list[dict], rng: random.Random) -> list[dict]:
    """Hourly AEMP 2.0 snapshots across each machine's operating window."""
    branches = cfg.BRANCHES
    out: list[dict] = []

    for a in assets:
        first_day, last_day = operating_window(a)
        total_days = a["operating_days"]
        branch = branches[cfg.SITE_BRANCH.get(a["site_id"], "IN288")]
        # One fixed jitter per machine: a site does not wander between snapshots.
        lat0 = branch["lat"] + rng.uniform(-GEOFENCE_DEG, GEOFENCE_DEG)
        lon0 = branch["lon"] + rng.uniform(-GEOFENCE_DEG, GEOFENCE_DEG)

        is_coolant_case = a["equipment_id"] == "EQX1005"
        cum_op = 0.0
        cum_idle = 0.0
        cum_fuel = 0.0

        for d in range(total_days):
            day = first_day + timedelta(days=d)
            for hour in range(24):
                # Hours accrue evenly across the day, so the counters land exactly on
                # engine_hours_day * operating_days at the final snapshot.
                cum_op += a["engine_hours_day"] / 24.0
                cum_idle += a["idle_hours_day"] / 24.0
                cum_fuel += (a["engine_hours_day"] / 24.0) * FUEL_BURN_L_PER_HOUR

                if is_coolant_case:
                    # The degradation trend: a linear rise across the operating window.
                    coolant = cfg.COOLANT_BASELINE_C + cfg.COOLANT_RAMP_C_PER_DAY * (
                        d + hour / 24.0
                    )
                else:
                    coolant = cfg.COOLANT_BASELINE_C + rng.uniform(-3.0, 3.0)
                coolant = round(coolant + rng.uniform(-0.3, 0.3), 2)

                faults = []
                if coolant > cfg.COOLANT_WARN_C:
                    # Genuine SAE J1939: engine coolant temperature, data valid but
                    # above normal, most severe. Not invented.
                    faults = [{
                        "spn": 110, "fmi": 0,
                        "ts": datetime.combine(day, datetime.min.time()).replace(
                            hour=hour).isoformat(),
                    }]

                out.append({
                    "equipment_id": a["equipment_id"],
                    "datetime": datetime.combine(day, datetime.min.time()).replace(
                        hour=hour).isoformat(),
                    "latitude": round(lat0 + rng.uniform(-0.001, 0.001), 6),
                    "longitude": round(lon0 + rng.uniform(-0.001, 0.001), 6),
                    "cumulative_operating_hours": round(cum_op, 3),
                    "cumulative_idle_hours": round(cum_idle, 3),
                    "fuel_remaining_percent": round(100 - (cum_fuel % 400) / 4.0, 1),
                    "fuel_used_litres": round(cum_fuel, 1),
                    "engine_coolant_temp_c": coolant,
                    "fault_codes": faults,
                })

        # The counters must land on the asset row, not near it.
        assert abs(cum_op - a["cumulative_operating_hours"]) < 0.05, (
            f"{a['equipment_id']}: telemetry ended at {cum_op:.2f}h, asset row says "
            f"{a['cumulative_operating_hours']}h"
        )
    return out


# ============================================================== events
def build_events(assets: list[dict]) -> list[dict]:
    """Append-only lifecycle. Check-out -> assign -> usage -> check-in -> yard."""
    out: list[dict] = []
    n = 0

    def add(day: date, eq: str, kind: str, **extra):
        nonlocal n
        n += 1
        out.append({
            "event_id": f"EV{n:05d}",
            "timestamp": datetime.combine(day, datetime.min.time()).replace(hour=9).isoformat(),
            "equipment_id": eq,
            "event_type": kind,
            "actor": "seed",
            **extra,
        })

    for a in assets:
        eq = a["equipment_id"]
        checked_out = date.fromisoformat(a["check_out_date"])
        add(checked_out, eq, "CHECK_OUT", site_id=a["site_id"], notes="Dispatched from yard")
        if a["site_id"]:
            add(checked_out, eq, "ASSIGN", site_id=a["site_id"], operator_id=a["operator_id"])

        first_day, last_day = operating_window(a)
        for d in range(0, a["operating_days"], 7):     # weekly usage log
            add(first_day + timedelta(days=d), eq, "USAGE_LOG",
                notes=f"{a['engine_hours_day']}h engine / {a['idle_hours_day']}h idle per day")

        if not a["on_rent"]:
            checked_in = date.fromisoformat(a["check_in_date"])
            add(checked_in, eq, "CHECK_IN", condition_grade=a["condition_grade"],
                notes="Returned by customer")
            # Closing the loop at the dealer yard - the step most demos skip.
            add(checked_in, eq, "CONDITION_LOG", condition_grade=a["condition_grade"],
                notes=f"Return condition {a['condition_grade']}; "
                      f"{a['hours_since_service']}h since last service")
            add(checked_in, eq, "RETURN_TO_YARD",
                site_id=cfg.SITE_BRANCH.get(a["site_id"]), notes="Back at branch")

    out.sort(key=lambda e: e["timestamp"])
    return out


# ============================================================== bookings
def build_bookings() -> list[dict]:
    """
    The Monday conflict. A customer wants an excavator at S003 on 2025-05-19 - the
    Monday after the pinned NOW of 2025-05-12. Customer name is a real row from the
    source catalogue, filtered to industries that actually operate heavy plant.
    """
    customers = load_json("catalogue_customers.json")
    contractor = next(
        (c for c in customers if c["industry"] == "Construction Contractor"),
        customers[0],
    )
    return [{
        "booking_id": "BK001",
        "customer": contractor["name"],
        "equipment_type": "Excavator",
        "site_id": "S003",
        "needed_from": (cfg.NOW + timedelta(days=7)).isoformat(),
        "days": 10,
        "status": "REQUESTED",
    }]


# ============================================================== main
def main() -> None:
    rng = random.Random(cfg.RANDOM_SEED)

    assets = build_assets(rng)
    assert_reconciles(assets)

    telemetry = build_telemetry(assets, rng)
    events = build_events(assets)
    bookings = build_bookings()

    print("writing seed ...")
    dump_json("seed_assets.json", assets)
    dump_json("seed_telemetry.json", telemetry)
    dump_json("seed_events.json", events)
    dump_json("seed_bookings.json", bookings)

    given = load_json(GIVEN.name)
    unchanged = assets[:len(given)] == given
    print(f"\nthe seven given rows unchanged: {unchanged}")
    if not unchanged:
        raise SystemExit("GIVEN ROWS WERE MODIFIED - this must never happen")

    eqx1005 = [t for t in telemetry if t["equipment_id"] == "EQX1005"]
    tail = eqx1005[-24:]
    rolling = sum(t["engine_coolant_temp_c"] for t in tail) / len(tail)
    print(f"{len(assets)} assets ({len(given)} given + {cfg.SYNTHETIC_FLEET_SIZE} synthetic)"
          f" | {len(telemetry):,} telemetry snapshots | {len(events)} events")
    print(f"EQX1005 coolant: rolling 24-reading mean {rolling:.2f} C "
          f"(warn {cfg.COOLANT_WARN_C} C), last reading "
          f"{eqx1005[-1]['engine_coolant_temp_c']} C")
    print(f"booking: {bookings[0]['customer']} wants a {bookings[0]['equipment_type']} "
          f"at {bookings[0]['site_id']} from {bookings[0]['needed_from']}")


if __name__ == "__main__":
    main()
