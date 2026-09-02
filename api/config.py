"""
Shared constants. BOTH Nirav and Prajwal import from here. Nobody hardcodes a number
anywhere else, and NOBODY calls datetime.now().

Why NOW is pinned: the dataset is dated 2025. If any code reads the real clock, every
asset is a year overdue and every date-dependent feature returns nonsense.
"""
from __future__ import annotations
import json
import pathlib
from datetime import date

_DATA = pathlib.Path(__file__).resolve().parent.parent / "data"

# ---- the frozen clock -------------------------------------------------------
NOW = date(2025, 5, 12)          # a Monday. Treat this as "today" everywhere.

# ---- thresholds (exposed via GET/PUT /config, editable live in the demo) -----
IDLE_UTILISATION_WARN = 0.35     # below this = under-utilised
IDLE_UTILISATION_CRIT = 0.20     # below this = critical
ZERO_OUTPUT_MIN_DAYS = 3         # zero engine hours for this many days = critical
SERVICE_INTERVAL_HOURS = 200     # hours since last service before a machine is flagged
TRANSIT_DAYS = 1                 # yard -> site
SERVICE_DAYS = 1                 # time a machine is off the board while serviced
DEFAULT_HOURS_PER_DAY = 8        # fallback when engine+idle are both 0

# ---- rental day rates in INR (editable in the UI, never quoted as fact) ------
# This is the dealer's PUBLISHED RATE CARD and stays the default basis.
DAY_RATES = {
    "Excavator": 15000,
    "Bulldozer": 18000,
    "Crane":     22000,
    "Grader":    12000,
}

# ---- price-implied rates, derived from the 806,485-row source catalogue ------
# Cross-check column, NOT the default. Every rate is the published Excavator rate scaled
# by the real median SKU price ratio for that class, so only one number is asserted and
# the ratios come from data. Computed by data/catalogue.py; the literals below are the
# committed fallback so the API still boots if the catalogue has not been extracted.
#
# Grader carries a caveat: no grader category exists in the source. Mapped to RoadPavers,
# which prices ABOVE an excavator. That is wrong for real equipment and is exactly why
# this basis is offered as a comparison and not switched on by default.
DAY_RATES_PRICE_IMPLIED = {
    "Excavator": 15000,          # anchor
    "Bulldozer": 13000,
    "Crane":     18000,
    "Grader":    19500,          # RoadPavers proxy - see caveat above
}
RATE_BASIS = "published"         # "published" | "price_implied"


def _load_price_implied() -> dict:
    """Prefer the extracted catalogue; fall back to the committed literals."""
    path = _DATA / "catalogue_rates.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {t: r["day_rate_inr"] for t, r in payload["rates"].items()}
    except (OSError, KeyError, ValueError):
        return dict(DAY_RATES_PRICE_IMPLIED)


# ---- the dealer branch network ----------------------------------------------
# Real branches from the source catalogue (StoreID <-> City is 1:1 there). A BRANCH is
# the dealer yard a machine returns to. A SITE (S001..S006) is a customer location the
# machine is deployed to. The seven given rows keep their site ids untouched; this map
# is what tells the availability engine which yard each site belongs to.
BRANCHES = {
    "IN288": {"city": "Mumbai",    "lat": 19.0760, "lon": 72.8777},
    "IN487": {"city": "Bangalore", "lat": 12.9716, "lon": 77.5946},
    "IN488": {"city": "Chennai",   "lat": 13.0827, "lon": 80.2707},
    "IN489": {"city": "Kolkata",   "lat": 22.5726, "lon": 88.3639},
}

SITE_BRANCH = {
    "S001": "IN288",   # Mumbai
    "S002": "IN487",   # Bangalore
    "S003": "IN288",   # Mumbai
    "S004": "IN487",   # Bangalore
    "S005": "IN488",   # Chennai
    "S006": "IN489",   # Kolkata
}

# Days to move a machine between branches. ASSUMPTION, NOT DATA - the source catalogue
# has no distance and its DeliveryDate lead time measures order->delivery for a purchase
# (median 15 days, identical at all four Indian branches), not yard->site transit.
# Printed on the settings screen and editable, like every other assumption here.
BRANCH_TRANSIT_DAYS = {
    ("IN288", "IN487"): 2, ("IN288", "IN488"): 3, ("IN288", "IN489"): 3,
    ("IN487", "IN488"): 1, ("IN487", "IN489"): 3,
    ("IN488", "IN489"): 3,
}

# ---- availability confidence ------------------------------------------------
# Every number the commitment engine can print, so none of them is a literal in
# intelligence.py and all of them are visible on the settings screen.
CONFIDENCE_AT_YARD = 1.00        # already in the yard, nothing to wait for
CONFIDENCE_EARLY = 0.90          # back this many days before it is needed
CONFIDENCE_EARLY_DAYS = 2
CONFIDENCE_DAY_BEFORE = 0.75     # back exactly one day before
CONFIDENCE_TIGHT = 0.50          # lands on the day, no slack
CONFIDENCE_TRANSFER_PENALTY = 0.15   # deducted when the machine must move branches
MAX_ALTERNATIVES = 3             # runner-up machines listed beside a commitment

# ---- rule tuning ------------------------------------------------------------
IDLE_BURN_MIN_DAYS = 7           # R2 needs a rental long enough to mean something
DUE_SOON_DAYS = 3                # R8: "remind users when return time is approaching"
NO_OPERATOR_WASTE_SHARE = 0.5    # R7: half the rental line is the defensible claim

# ---- demand forecast --------------------------------------------------------
# A site's need is projected, never invented. These four numbers are the whole
# model: how far ahead to look, how far back to measure, the working rate below
# which a site is not really using a machine type, and the rate at which the
# need is called with full confidence.
FORECAST_HORIZON_DAYS = 7        # how far ahead a site's need is projected
FORECAST_WINDOW_DAYS = 14        # trailing window the working rate is measured over
FORECAST_MIN_INTENSITY_H = 1.0   # engine h/day below which the site is not working that type
FORECAST_HIGH_CONF_H = 4.0       # engine h/day at which the need is called confidently

# ---- maintenance ------------------------------------------------------------
COOLANT_WARN_C = 105.0           # rolling 24h mean above this
COOLANT_SLOPE_MIN = 0.3          # degrees/day trend, must also be rising
COOLANT_FAILURE_C = 115.0        # used for days-to-failure extrapolation
ROLLING_WINDOW_READINGS = 24     # snapshots are hourly, so this is one day
SLOPE_WINDOW_DAYS = 7            # least-squares fit window, in days

# ---- seed generation --------------------------------------------------------
RANDOM_SEED = 42                 # seed every RNG with this. Numbers must not move.
SYNTHETIC_FLEET_SIZE = 20        # assets generated on top of the seven given rows
TELEMETRY_DAYS = 90              # history window, hourly snapshots
COOLANT_BASELINE_C = 88.0        # healthy running temperature
COOLANT_RAMP_C_PER_DAY = 0.8     # the EQX1005 degradation trend


def _transit_matrix() -> dict:
    """Symmetric, zero on the diagonal, serialised with string keys for JSON."""
    out = {}
    for a in BRANCHES:
        for b in BRANCHES:
            if a == b:
                out[f"{a}>{b}"] = 0
            else:
                out[f"{a}>{b}"] = BRANCH_TRANSIT_DAYS.get(
                    (a, b), BRANCH_TRANSIT_DAYS.get((b, a))
                )
    return out


def as_dict() -> dict:
    """What GET /config returns. Prajwal's analyze() receives exactly this."""
    return {
        "now": NOW.isoformat(),
        "idle_utilisation_warn": IDLE_UTILISATION_WARN,
        "idle_utilisation_crit": IDLE_UTILISATION_CRIT,
        "zero_output_min_days": ZERO_OUTPUT_MIN_DAYS,
        "service_interval_hours": SERVICE_INTERVAL_HOURS,
        "transit_days": TRANSIT_DAYS,
        "service_days": SERVICE_DAYS,
        "default_hours_per_day": DEFAULT_HOURS_PER_DAY,
        "day_rates": dict(DAY_RATES),
        "day_rates_price_implied": _load_price_implied(),
        "rate_basis": RATE_BASIS,
        "branches": {k: dict(v) for k, v in BRANCHES.items()},
        "site_branch": dict(SITE_BRANCH),
        "branch_transit_days": _transit_matrix(),
        "confidence_at_yard": CONFIDENCE_AT_YARD,
        "confidence_early": CONFIDENCE_EARLY,
        "confidence_early_days": CONFIDENCE_EARLY_DAYS,
        "confidence_day_before": CONFIDENCE_DAY_BEFORE,
        "confidence_tight": CONFIDENCE_TIGHT,
        "confidence_transfer_penalty": CONFIDENCE_TRANSFER_PENALTY,
        "max_alternatives": MAX_ALTERNATIVES,
        "idle_burn_min_days": IDLE_BURN_MIN_DAYS,
        "due_soon_days": DUE_SOON_DAYS,
        "forecast_horizon_days": FORECAST_HORIZON_DAYS,
        "forecast_window_days": FORECAST_WINDOW_DAYS,
        "forecast_min_intensity_h": FORECAST_MIN_INTENSITY_H,
        "forecast_high_conf_h": FORECAST_HIGH_CONF_H,
        "no_operator_waste_share": NO_OPERATOR_WASTE_SHARE,
        "coolant_warn_c": COOLANT_WARN_C,
        "coolant_slope_min": COOLANT_SLOPE_MIN,
        "coolant_failure_c": COOLANT_FAILURE_C,
        "rolling_window_readings": ROLLING_WINDOW_READINGS,
        "slope_window_days": SLOPE_WINDOW_DAYS,
        "random_seed": RANDOM_SEED,
    }
