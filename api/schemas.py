"""
THE CONTRACT. This file is frozen once both Nirav and Prajwal have read it.

Nirav imports these to serialise API responses.
Prajwal imports these to build what analyze() returns.
If it type-checks, it joins. No field renames without both agreeing out loud.

pip install pydantic
"""
from __future__ import annotations
from datetime import date, datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

Status = Literal["ACTIVE", "IDLE", "UNASSIGNED", "OVERDUE", "IN_SERVICE", "AT_YARD"]
Severity = Literal["CRITICAL", "WARNING", "INFO"]
EventType = Literal[
    "CHECK_OUT", "ASSIGN", "USAGE_LOG", "CONDITION_LOG", "CHECK_IN", "RETURN_TO_YARD"
]


# ---------------------------------------------------------------- core objects
class Asset(BaseModel):
    equipment_id: str                      # EQX1001
    type: str                              # Excavator | Bulldozer | Crane | Grader
    model: str
    serial_number: str
    site_id: Optional[str] = None          # None == unassigned. This is a signal.
    operator_id: Optional[str] = None      # None == no operator. Also a signal.
    on_rent: bool
    check_out_date: Optional[date] = None
    check_in_date: Optional[date] = None   # scheduled return
    engine_hours_day: float                # productive hours per day
    idle_hours_day: float
    operating_days: int
    cumulative_operating_hours: float
    hours_since_service: float
    day_rate: int                          # INR
    condition_grade: Literal["A", "B", "C"] = "A"

    @property
    def utilisation(self) -> float:
        total = self.engine_hours_day + self.idle_hours_day
        return 0.0 if total == 0 else self.engine_hours_day / total


class TelemetrySnapshot(BaseModel):
    """ISO 15143-3 (AEMP 2.0) names. The last two are declared extensions."""
    equipment_id: str
    datetime: datetime
    latitude: float
    longitude: float
    cumulative_operating_hours: float
    cumulative_idle_hours: float
    fuel_remaining_percent: float
    fuel_used_litres: float
    engine_coolant_temp_c: float                      # extension
    fault_codes: list[dict] = Field(default_factory=list)   # [{spn, fmi, ts}]  extension


class RentalEvent(BaseModel):
    """Append-only. Never UPDATE. Status is a projection over these."""
    event_id: str
    timestamp: datetime
    equipment_id: str
    event_type: EventType
    actor: str                              # who did it
    site_id: Optional[str] = None
    operator_id: Optional[str] = None
    condition_grade: Optional[str] = None
    notes: Optional[str] = None


class Booking(BaseModel):
    booking_id: str
    customer: str
    equipment_type: str
    site_id: str
    needed_from: date
    days: int
    status: Literal["REQUESTED", "COMMITTED", "DECLINED"] = "REQUESTED"


# -------------------------------------------------- what Prajwal's module returns
class Signal(BaseModel):
    """The evidence. Never ship a verdict without these."""
    field: str          # "idle_hours_day"
    value: str          # "12"
    threshold: Optional[str] = None   # "> 0"


class Anomaly(BaseModel):
    equipment_id: str
    rule_id: str                        # R1 .. R7
    severity: Severity
    title: str                          # "Unassigned but accruing idle hours"
    signals: list[Signal]
    est_value_inr: int                  # money at stake
    recommended_action: str             # "Reassign to S003" | "Return to yard"


class AvailabilityAnswer(BaseModel):
    can_commit: bool
    equipment_id: Optional[str] = None
    free_from: Optional[date] = None
    confidence: float                   # 0.0 - 1.0
    reason: str                         # plain English, shown on screen
    alternatives: list[str] = Field(default_factory=list)


class MaintenanceRisk(BaseModel):
    equipment_id: str
    spn: int                            # SAE J1939
    fmi: int
    label: str
    part: str
    action: str
    days_to_failure: float
    current_temp_c: float
    slope: float


class IntelligenceBundle(BaseModel):
    """THE handoff. Prajwal returns this. Nirav serves it. Nothing else crosses."""
    anomalies: list[Anomaly] = Field(default_factory=list)
    availability: Optional[AvailabilityAnswer] = None
    maintenance: list[MaintenanceRisk] = Field(default_factory=list)


# ---------------------------------------------------------------- ledger
class LedgerEntry(BaseModel):
    entry_id: str
    timestamp: datetime
    equipment_id: str
    rule_id: Optional[str] = None
    action: str
    est_value_inr: int
