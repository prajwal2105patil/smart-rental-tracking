"""
The accuracy test.

Seven rows cannot validate a model statistically, and any accuracy percentage quoted off
them would be invented. What CAN be proved is that the module is deterministic, that
every verdict is arithmetic reproducible by hand, and that it fires on exactly the assets
it claims to. That is what this file pins.

    python -m pytest test_intelligence.py -q
"""
from __future__ import annotations
import json
import pathlib
from datetime import date

import pytest

import config as cfg
import intelligence
from schemas import Asset, Booking, TelemetrySnapshot

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"


def _read(name: str) -> list:
    path = DATA / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


@pytest.fixture(scope="module")
def assets() -> list[Asset]:
    return [Asset(**{k: v for k, v in a.items() if not k.startswith("_")})
            for a in _read("seed_assets.json")]


@pytest.fixture(scope="module")
def telemetry() -> list[TelemetrySnapshot]:
    return [TelemetrySnapshot(**t) for t in _read("seed_telemetry.json")]


@pytest.fixture(scope="module")
def bookings() -> list[Booking]:
    return [Booking(**b) for b in _read("seed_bookings.json")]


@pytest.fixture
def conf() -> dict:
    return cfg.as_dict()


# ---- every rule, every asset, every rupee -----------------------------------
# rule_id, equipment_id, severity, est_value_inr
EXPECTED = [
    ("R1", "EQX1002", "CRITICAL", 440_000),
    ("R1", "EQX1007", "CRITICAL", 180_000),
    ("R2", "EQX1001", "CRITICAL", 195_652),
    ("R2", "EQX1004", "CRITICAL", 306_818),
    ("R2", "EQX1006", "WARNING",  144_000),
    ("R3", "EQX1002", "CRITICAL", 440_000),
    ("R3", "EQX1007", "CRITICAL", 180_000),
    ("R4", "EQX1004", "WARNING",  210_000),
    ("R5", "EQX1005", "WARNING",   18_000),
    ("R6", "EQX1001", "CRITICAL", 390_000),
    ("R6", "EQX1002", "CRITICAL", 946_000),
    ("R6", "EQX1007", "CRITICAL", 615_000),
    ("R7", "EQX1002", "WARNING",  220_000),
    ("R7", "EQX1007", "WARNING",   90_000),
    # "Remind users when return time is approaching" - the brief asks for the days
    # BEFORE the due date, not only after it. INFO and worth zero: nothing is lost yet,
    # which is the whole point of a reminder.
    ("R8", "EQX1004", "INFO",           0),
]


def test_exact_firing_set(assets, conf):
    found = sorted(
        (a.rule_id, a.equipment_id, a.severity, a.est_value_inr)
        for a in intelligence.find_anomalies(assets, conf)
    )
    assert found == sorted(EXPECTED)


def test_every_anomaly_ships_signals(assets, conf):
    for a in intelligence.find_anomalies(assets, conf):
        assert a.signals, f"{a.rule_id} on {a.equipment_id} shipped no evidence"
        for s in a.signals:
            assert s.field and s.value != ""


def test_no_synthetic_asset_raises_a_flag(assets, conf):
    """Every flag in the demo must trace to one of the seven given rows."""
    given = {a["equipment_id"] for a in _read("seed_assets_given.json")}
    flagged = {a.equipment_id for a in intelligence.find_anomalies(assets, conf)}
    assert flagged <= given, f"synthetic assets tripped rules: {flagged - given}"


def test_r2_does_not_double_charge_the_ghost_assets(assets, conf):
    """R3 owns zero-output; R2 firing there would bill the same rental line twice."""
    r2 = {a.equipment_id for a in intelligence.find_anomalies(assets, conf)
          if a.rule_id == "R2"}
    assert "EQX1002" not in r2 and "EQX1007" not in r2


# ---- the given rows are untouched -------------------------------------------
def test_due_soon_reminder_fires_before_the_due_date(assets, conf):
    """EQX1004 is due 2025-05-15 with the clock at 2025-05-12 - three days of warning."""
    r8 = [a for a in intelligence.find_anomalies(assets, conf) if a.rule_id == "R8"]
    assert [a.equipment_id for a in r8] == ["EQX1004"]
    assert r8[0].severity == "INFO"
    assert r8[0].est_value_inr == 0
    assert any(s.field == "days_until_return" and s.value == "3" for s in r8[0].signals)


def test_reminders_do_not_inflate_the_money(assets, conf):
    summary = intelligence.value_summary(intelligence.find_anomalies(assets, conf), conf)
    assert summary["total_exposure_inr"] == (
        summary["waste_inr"] + summary["recoverable_inr"] + summary["avoided_inr"])


def test_usage_summary_ranks_the_worst_site_first(assets, conf):
    """Total rented hours, usage per site, downtime - the brief asks for all three."""
    summary = intelligence.usage_summary(assets, conf)
    sites = summary["by_site"]
    assert sites[0]["site_id"] == "UNASSIGNED"          # the ghost assets, 0% utilisation
    assert sites[0]["utilisation_pct"] == 0.0
    assert sites == sorted(sites, key=lambda r: r["utilisation_pct"])
    for row in sites:
        assert row["downtime_hours"] == row["idle_hours"]
    fleet = summary["fleet"]
    assert fleet["assets"] == len(assets)
    assert fleet["rented_days"] == sum(a.operating_days for a in assets)


def test_seven_given_rows_pass_through_unchanged():
    given = _read("seed_assets_given.json")
    generated = _read("seed_assets.json")[:len(given)]
    assert generated == given


def test_history_reconciles_to_the_given_fields():
    """cumulative_operating_hours == engine_hours_day * operating_days, for all of them."""
    for a in _read("seed_assets.json"):
        assert abs(a["engine_hours_day"] * a["operating_days"]
                   - a["cumulative_operating_hours"]) < 0.05, a["equipment_id"]


# ---- availability ------------------------------------------------------------
def test_commits_the_idle_machine_not_the_returning_one(assets, conf):
    """EQX1007 sits unassigned with zero output. It should not wait behind EQX1004."""
    answer = intelligence.answer_availability(
        assets, "Excavator", "S003", date(2025, 5, 19), 10, conf)
    assert answer.can_commit is True
    assert answer.equipment_id == "EQX1007"
    assert answer.confidence == conf["confidence_at_yard"]
    assert answer.free_from <= date(2025, 5, 19)


def test_free_from_never_lands_in_the_past(assets, conf):
    """EQX1007 is on_rent with a check-in date six weeks gone."""
    now = date.fromisoformat(conf["now"])
    for a in assets:
        assert intelligence._free_from(a, conf, now) >= now


def test_impossible_date_declines_with_alternatives(assets, conf):
    answer = intelligence.answer_availability(
        assets, "Excavator", "S003", date(2025, 1, 1), 10, conf)
    assert answer.can_commit is False
    assert answer.alternatives, "a decline with no alternatives is a dead end"


def test_unknown_type_declines_cleanly(assets, conf):
    answer = intelligence.answer_availability(
        assets, "Submarine", "S003", date(2025, 5, 19), 10, conf)
    assert answer.can_commit is False


# ---- maintenance -------------------------------------------------------------
def test_coolant_trend_fires_on_eqx1005_only(assets, telemetry, conf):
    risks = intelligence.assess_maintenance(assets, telemetry, conf)
    assert [r.equipment_id for r in risks] == ["EQX1005"]
    r = risks[0]
    assert (r.spn, r.fmi) == (110, 0)                       # genuine SAE J1939
    assert r.current_temp_c > conf["coolant_warn_c"]
    assert r.slope > conf["coolant_slope_min"]
    assert r.days_to_failure > 0
    # days_to_failure must be the stated extrapolation, not a fudged number. The
    # tolerance absorbs the 2dp rounding applied to temp and slope before display.
    expected = (conf["coolant_failure_c"] - r.current_temp_c) / r.slope
    assert abs(r.days_to_failure - expected) < 0.05


def test_maintenance_survives_empty_telemetry(assets, conf):
    assert intelligence.assess_maintenance(assets, [], conf) == []


# ---- the money ---------------------------------------------------------------
def test_zero_output_recovery_claim_is_620k(assets, conf):
    """The pitch number: EQX1002 + EQX1007 rented at zero output."""
    summary = intelligence.value_summary(intelligence.find_anomalies(assets, conf), conf)
    waste = summary["by_asset"]["waste"]
    assert waste["EQX1002"] + waste["EQX1007"] == 620_000


def test_waste_is_deduplicated_per_asset(assets, conf):
    """R1 and R3 both charge EQX1002 the full rental line; it must count once."""
    summary = intelligence.value_summary(intelligence.find_anomalies(assets, conf), conf)
    assert summary["by_asset"]["waste"]["EQX1002"] == 440_000


def test_rate_card_is_live(assets, conf):
    """Move the rate on the settings screen and the money must move with it."""
    before = next(a for a in intelligence.find_anomalies(assets, conf)
                  if (a.rule_id, a.equipment_id) == ("R3", "EQX1007"))
    conf["day_rates"]["Excavator"] *= 2
    after = next(a for a in intelligence.find_anomalies(assets, conf)
                 if (a.rule_id, a.equipment_id) == ("R3", "EQX1007"))
    assert after.est_value_inr == before.est_value_inr * 2


def test_price_implied_basis_changes_the_crane(assets, conf):
    """Published card prices a Crane at 22,000; the catalogue ratio implies 18,000."""
    conf["rate_basis"] = "price_implied"
    r3 = next(a for a in intelligence.find_anomalies(assets, conf)
              if (a.rule_id, a.equipment_id) == ("R3", "EQX1002"))
    assert r3.est_value_inr == conf["day_rates_price_implied"]["Crane"] * 20


# ---- the whole bundle --------------------------------------------------------
def test_analyze_is_deterministic(assets, telemetry, bookings, conf):
    first = intelligence.analyze(assets, telemetry, bookings, conf)
    second = intelligence.analyze(assets, telemetry, bookings, conf)
    assert first.model_dump_json() == second.model_dump_json()


def test_analyze_survives_empty_inputs(assets, conf):
    bundle = intelligence.analyze(assets, [], [], conf)
    assert bundle.availability is None
    assert bundle.maintenance == []
    assert len(bundle.anomalies) == len(EXPECTED)


def test_no_wall_clock_anywhere():
    """
    The data is from 2025. One datetime.now() and every asset is a year overdue.

    Parsed rather than grepped: the module docstring says the words "No datetime.now()",
    and a substring search would flag its own house rules as a violation.
    """
    import ast

    tree = ast.parse(pathlib.Path(intelligence.__file__).read_text(encoding="utf-8"))
    banned = {("datetime", "now"), ("date", "today"), ("time", "time")}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            owner = getattr(node.func.value, "id", None)
            assert (owner, node.func.attr) not in banned, (
                f"line {node.lineno} calls the wall clock: {owner}.{node.func.attr}()"
            )


# ============================================================== 4. DEMAND FORECAST
def test_forecast_projects_every_site_about_to_lose_a_machine_it_is_working(assets, telemetry, bookings, conf):
    """The projection is mechanical, so it is checkable line by line.

    Four rows: three sites lose a machine they are actively working inside the
    seven-day horizon, and one booking already asks for cover. Nothing else in the
    fleet qualifies - a site that is not working a type is not short of it.
    """
    rows = intelligence.forecast_demand(assets, telemetry, bookings, conf)
    assert len(rows) == 4, [r["headline"] for r in rows]

    projected = {(r["site_id"], r["equipment_type"]): r
                 for r in rows if r["basis"] == "return"}
    assert set(projected) == {
        ("S004", "Excavator"), ("S001", "Grader"), ("S002", "Bulldozer"),
    }

    # Ordered by the date the site goes short, soonest first.
    assert [r["needed_from"] for r in rows] == [
        "2025-05-15", "2025-05-17", "2025-05-19", "2025-05-19",
    ]


def test_forecast_reads_the_rate_off_the_counter_not_the_typed_field(assets, telemetry, bookings, conf):
    """The working rate must come from cumulative_operating_hours.

    A daily field can be typed in by anyone; a cumulative counter is what the
    machine itself reports. Every projected row here has telemetry behind it, so
    every one must say so.
    """
    rows = intelligence.forecast_demand(assets, telemetry, bookings, conf)
    for r in rows:
        if r["basis"] != "return":
            continue
        source = next(g for g in r["signals"] if g["field"] == "rate_source")
        assert source["value"] == "measured", r["headline"]
        assert r["history"], "a projected row must show the series it was read off"


def test_forecast_confidence_tracks_how_hard_the_site_was_working_the_machine(assets, telemetry, bookings, conf):
    """S004 loses 2.0 engine h/day against a 4.0 h/day confidence bar, so 0.50.

    S001 and S002 lose more than the bar, so both cap at 1.00. This is the whole
    confidence model and it is one division - there is nothing hidden in it.
    """
    rows = {(r["site_id"], r["basis"]): r
            for r in intelligence.forecast_demand(assets, telemetry, bookings, conf)}

    weak = rows[("S004", "return")]
    assert weak["confidence"] == 0.5
    lost = next(g for g in weak["signals"] if g["field"] == "engine_hours_day (leaving)")
    assert lost["value"] == 2.0
    assert lost["value"] / conf["forecast_high_conf_h"] == weak["confidence"]

    assert rows[("S001", "return")]["confidence"] == 1.0
    assert rows[("S002", "return")]["confidence"] == 1.0


def test_forecast_never_blends_a_request_with_a_guess(assets, telemetry, bookings, conf):
    """A booking is not a prediction. It is reported at full confidence and labelled."""
    rows = intelligence.forecast_demand(assets, telemetry, bookings, conf)
    booked = [r for r in rows if r["basis"] == "booking"]
    assert len(booked) == 1

    b = booked[0]
    assert b["site_id"] == "S003" and b["equipment_type"] == "Excavator"
    assert b["confidence"] == conf["confidence_at_yard"]
    assert b["leaving"] == [] and b["history"] == []
    assert next(g for g in b["signals"] if g["field"] == "booking_id")["value"] == "BK001"


def test_every_forecast_row_names_the_machine_that_covers_it(assets, telemetry, bookings, conf):
    """A prediction a dealer cannot act on is not worth showing.

    The cover comes from the availability engine, so the answer here and the answer
    on the availability panel are the same answer - they cannot drift apart.
    """
    rows = intelligence.forecast_demand(assets, telemetry, bookings, conf)
    for r in rows:
        rec = r["recommendation"]
        assert rec is not None and rec["reason"], r["headline"]
        assert rec["equipment_id"] or rec["alternatives"], r["headline"]
        assert r["signals"], "a row with no signals cannot be argued with"

    # The judge's own example, answered: S003 wants an excavator, and the machine
    # to send is the one already paid for and doing nothing.
    s003 = next(r for r in rows if r["site_id"] == "S003")
    assert s003["recommendation"]["equipment_id"] == "EQX1007"


# ============================================================== 5. IDENTITY
# Sign-in is an identity, not a second security boundary. These tests pin exactly that:
# the role ladder is honest about which rung is enforced, the enforced one really is
# enforced, and nothing here can be talked into granting anything.

@pytest.fixture
def app_client(monkeypatch):
    """Build the app with ADMIN_TOKEN set or unset - it is read once, at import time.

    Everything here is torn down afterwards. Without that, setting the variable and
    re-importing main leaks into every later test in the suite: the app object they
    import still carries a token they know nothing about, and every admin route they
    touch returns 401. That is exactly what happened, and it is why this is a fixture
    rather than a plain helper.
    """
    import importlib
    import sys
    from fastapi.testclient import TestClient

    def make(admin_token=None):
        if admin_token is None:
            monkeypatch.delenv("ADMIN_TOKEN", raising=False)
        else:
            monkeypatch.setenv("ADMIN_TOKEN", admin_token)
        sys.modules.pop("main", None)
        return TestClient(importlib.import_module("main").app)

    yield make

    # monkeypatch restores the environment; drop the module so the next importer
    # rebuilds the app against it rather than against ours.
    sys.modules.pop("main", None)


def test_role_ladder_says_which_rung_is_actually_enforced(app_client):
    client = app_client(admin_token="pin-me")
    body = client.get("/auth/roles").json()

    ids = [r["id"] for r in body["roles"]]
    assert ids == ["VIEWER", "YARD", "OPS_LEAD"]
    assert body["admin_required"] is True

    needs = {r["id"]: r["needs_key"] for r in body["roles"]}
    # Exactly one rung is gated, and it is the one that reaches the destructive routes.
    assert needs == {"VIEWER": False, "YARD": False, "OPS_LEAD": True}

    writes = {r["id"]: r["can_write"] for r in body["roles"]}
    assert writes == {"VIEWER": False, "YARD": True, "OPS_LEAD": True}


def test_elevation_requires_the_key_and_refuses_a_wrong_one(app_client):
    client = app_client(admin_token="pin-me")

    # An ungated role never claims elevation, however it is asked for.
    yard = client.post("/auth/session", json={"name": "Neerav Babel", "role": "YARD"})
    assert yard.status_code == 200
    assert yard.json()["elevated"] is False
    assert yard.json()["actor"] == "Neerav Babel"

    # A gated role with no key at all.
    assert client.post("/auth/session",
                       json={"name": "Neerav Babel", "role": "OPS_LEAD"}).status_code == 401

    # A gated role with the wrong key.
    assert client.post("/auth/session",
                       json={"name": "Neerav Babel", "role": "OPS_LEAD",
                             "access_key": "guess"}).status_code == 401

    # And the right one.
    ok = client.post("/auth/session",
                     json={"name": "Neerav Babel", "role": "OPS_LEAD", "access_key": "pin-me"})
    assert ok.status_code == 200 and ok.json()["elevated"] is True


def test_signing_in_grants_nothing_the_server_was_not_already_checking(app_client):
    """The whole security claim of this feature, in one test.

    A session is not a credential. Having called /auth/session successfully must leave
    the destructive routes exactly as protected as they were before - they re-check the
    key on every call, and a caller who omits it is refused no matter who they said
    they were.
    """
    client = app_client(admin_token="pin-me")

    signed_in = client.post("/auth/session",
                            json={"name": "Prajwal Patil", "role": "OPS_LEAD",
                                  "access_key": "pin-me"})
    assert signed_in.status_code == 200 and signed_in.json()["elevated"] is True

    # Same client, same "session", no header: still refused.
    assert client.post("/reset").status_code == 401
    assert client.put("/config", json={"day_rates": {"Excavator": 99}}).status_code == 401

    # The header is the only thing that ever mattered.
    assert client.post("/reset", headers={"X-Admin-Token": "pin-me"}).status_code == 200


def test_an_unknown_role_cannot_be_invented_by_the_caller(app_client):
    client = app_client(admin_token="pin-me")
    assert client.post("/auth/session",
                       json={"name": "Someone Else", "role": "SUPERUSER"}).status_code == 422
    # And a name too short to identify anybody is rejected by the schema.
    assert client.post("/auth/session",
                       json={"name": "x", "role": "YARD"}).status_code == 422


def test_an_instance_with_no_key_configured_says_so_instead_of_pretending(app_client):
    """Locally ADMIN_TOKEN is usually unset. The screen must not imply a guard exists."""
    client = app_client(admin_token=None)

    body = client.get("/auth/roles").json()
    assert body["admin_required"] is False

    # Elevation is granted because there is nothing to check - and admin_required tells
    # the UI to say exactly that rather than showing a reassuring "key verified" badge.
    open_instance = client.post("/auth/session",
                                json={"name": "Prajwal Patil", "role": "OPS_LEAD"})
    assert open_instance.status_code == 200
    assert open_instance.json()["elevated"] is True
    assert open_instance.json()["admin_required"] is False
