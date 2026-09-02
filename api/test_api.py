"""
API contract and input-validation tests.

Every case below is a real defect found by probing the running server, not a
hypothetical. They are pinned here so they cannot come back.

    python -m pytest test_api.py -q
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture
def client() -> TestClient:
    c = TestClient(main.app)
    c.post("/reset")
    yield c
    c.post("/reset")


# ---- it runs -----------------------------------------------------------------
@pytest.mark.parametrize("path", [
    "/health", "/assets", "/anomalies", "/alerts", "/maintenance-risk",
    "/ledger", "/config", "/bookings", "/usage-logs",
    "/assets/EQX1005", "/assets/EQX1007", "/usage-summary",
    "/availability?type=Excavator&site=S003&from=2025-05-19&days=10",
])
def test_every_read_route_answers(client, path):
    assert client.get(path).status_code == 200


def test_full_lifecycle_writes_one_event_each(client):
    before = len(client.get("/assets/EQX1007").json()["events"])
    assert client.post("/checkout", json={"equipment_id": "EQX1007", "actor": "t"}).status_code == 201
    assert client.post("/assign", json={"equipment_id": "EQX1007", "site_id": "S003",
                                        "operator_id": "OP101", "actor": "t"}).status_code == 201
    assert client.post("/log-usage", json={"equipment_id": "EQX1007", "engine_hours": 6,
                                           "idle_hours": 2, "actor": "t"}).status_code == 201
    assert client.post("/checkin", json={"equipment_id": "EQX1007",
                                         "condition_grade": "B", "actor": "t"}).status_code == 201
    after = client.get("/assets/EQX1007").json()["events"]
    assert len(after) == before + 4
    assert client.get("/usage-logs").json()


def test_acting_on_a_flag_clears_it(client):
    """Reassigning the ghost asset must remove its unassigned flag, not just hide it."""
    assert any(a["rule_id"] == "R1" and a["equipment_id"] == "EQX1007"
               for a in client.get("/anomalies").json())
    client.post("/assign", json={"equipment_id": "EQX1007", "site_id": "S003",
                                 "operator_id": "OP101", "actor": "t"})
    assert not any(a["rule_id"] == "R1" and a["equipment_id"] == "EQX1007"
                   for a in client.get("/anomalies").json())


# ---- input validation --------------------------------------------------------
# Config drives every rule, every rupee and the pinned clock. An unchecked patch is not
# cosmetic: a string day_rates silently served ZERO flags, and a malformed date took
# /assets down with a 500. Both answered HTTP 200.
@pytest.mark.parametrize("patch, why", [
    ({"day_rates": "pwned"},            "wrong type for a nested object"),
    ({"now": "not-a-date"},             "type-correct string that is not a date"),
    ({"attacker_key": 1},               "key that does not exist"),
    ({"service_interval_hours": -999},  "negative threshold"),
    ({"idle_utilisation_warn": "high"}, "string where a number belongs"),
])
def test_config_patch_is_rejected(client, patch, why):
    assert client.put("/config", json=patch).status_code == 422, why


def test_config_survives_a_rejected_patch(client):
    client.put("/config", json={"day_rates": "pwned"})
    client.put("/config", json={"now": "not-a-date"})
    assert client.get("/assets").status_code == 200
    assert len(client.get("/anomalies").json()) == 15
    assert client.get("/config").json()["day_rates"]["Excavator"] == 15000


def test_legitimate_config_change_still_works(client):
    """The judge changing a rate live is the point; validation must not block it."""
    assert client.put("/config", json={"day_rates": {"Excavator": 30000}}).status_code == 200
    rates = client.get("/config").json()["day_rates"]
    assert rates["Excavator"] == 30000
    assert rates["Crane"] == 22000            # deep-merge, not replace
    assert client.put("/config", json={"now": "2025-06-01"}).status_code == 200


@pytest.mark.parametrize("body, why", [
    ({"equipment_id": "EQX1001", "event_type": "GARBAGE", "actor": "x"}, "unknown event type"),
    ({"equipment_id": "EQX1001", "event_type": "USAGE_LOG", "actor": "x",
      "notes": "A" * 5000}, "unbounded free text"),
])
def test_bad_event_is_a_client_error_not_a_crash(client, body, why):
    assert client.post("/events", json=body).status_code == 422, why


@pytest.mark.parametrize("body", [
    {"equipment_id": "EQX1001", "engine_hours": 999, "idle_hours": 0, "actor": "x"},
    {"equipment_id": "EQX1001", "engine_hours": -1, "idle_hours": 0, "actor": "x"},
])
def test_impossible_usage_is_rejected(client, body):
    assert client.post("/log-usage", json=body).status_code == 422


def test_negative_ledger_value_is_rejected(client):
    assert client.post("/ledger", json={"equipment_id": "EQX1001", "action": "x",
                                        "est_value_inr": -5}).status_code == 422


# ---- information disclosure --------------------------------------------------
def test_unknown_asset_does_not_echo_input(client):
    """The 404 body used to repeat whatever id was supplied."""
    r = client.get("/assets/EQX9999<script>alert(1)</script>")
    assert r.status_code == 404
    assert "script" not in r.text


def test_no_path_traversal(client):
    for bad in ["../../config.py", "..%2f..%2fconfig.py", "EQX1001'--"]:
        assert client.get(f"/assets/{bad}").status_code == 404


def test_reset_restores_exact_demo_state(client):
    client.post("/assign", json={"equipment_id": "EQX1007", "site_id": "S003",
                                 "operator_id": "OP101", "actor": "t"})
    client.put("/config", json={"day_rates": {"Excavator": 99000}})
    client.post("/reset")
    assert len(client.get("/anomalies").json()) == 15
    assert client.get("/config").json()["day_rates"]["Excavator"] == 15000
