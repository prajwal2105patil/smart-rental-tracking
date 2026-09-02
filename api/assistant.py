"""
The fleet assistant.

Answers plain-English questions about the fleet, and answers them ONLY from figures the
console can already show you. Two rules shape the whole file:

  1. THE KEY NEVER REACHES THE BROWSER. It is read from the GROQ_API_KEY environment
     variable on the server and used here. A Vite VITE_* variable is compiled into the
     JavaScript bundle in plaintext, so putting it there would publish it to anyone who
     opens the site - and this repository is public.

  2. IT MUST WORK WITH NO NETWORK. Every question is answered locally first from the
     same live data; the model is only asked to phrase things when a local answer is not
     available. A demo that depends on an outbound API call on venue wifi is a demo that
     can fail in front of a judge.

Grounding is not a prompt instruction alone. `build_context()` assembles a compact,
complete snapshot of the real numbers, the system prompt forbids inventing anything
outside it, and every answer returns the specific figures it used so the operator can
check them against the board.
"""
from __future__ import annotations

import os
import re
from typing import Any

from intelligence import inr_words

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
TIMEOUT_S = 12

SYSTEM = """You are the fleet assistant for a Caterpillar dealer's rental console.

Answer ONLY from the FLEET DATA block below. It is the complete set of facts you have.

Hard rules:
- Never state a number that is not in FLEET DATA. Never estimate, extrapolate or round
  into a new figure.
- If the answer is not in FLEET DATA, say plainly that you do not have it and name what
  the console does show that is closest.
- Quote figures exactly as given, including units and the currency prefix INR.
- One or two sentences. No preamble, no bullet lists, no markdown.
- You are talking to a rental dealer, not an engineer. Say "machine", not "asset".
"""


# ---------------------------------------------------------------- the grounding
def build_context(
    assets: list, bundle: Any, usage: dict, value: dict, config: dict, briefing: dict,
) -> str:
    """A compact snapshot of everything the assistant is allowed to know."""
    lines: list[str] = []
    lines.append(f"today={config['now']}")
    lines.append(f"machines_total={len(assets)}")
    lines.append(f"fleet_utilisation_pct={usage['fleet']['utilisation_pct']}")
    lines.append(f"sites={len(usage['by_site'])}")
    lines.append(f"fleet_engine_hours={usage['fleet']['engine_hours']}")
    lines.append(f"fleet_idle_hours={usage['fleet']['idle_hours']}")
    lines.append(f"fleet_downtime_hours={usage['fleet']['downtime_hours']}")
    lines.append(f"fleet_rented_days={usage['fleet']['rented_days']}")

    on_rent = [a for a in assets if a.on_rent]
    lines.append(f"machines_on_rent={len(on_rent)}")
    lines.append(f"machines_at_yard={len(assets) - len(on_rent)}")

    lines.append(f"money_waste_inr={value['waste_inr']}")
    lines.append(f"money_still_billable_inr={value['recoverable_inr']}")
    lines.append(f"money_downtime_avoided_inr={value['avoided_inr']}")
    lines.append(f"money_total_exposure_inr={value['total_exposure_inr']}")

    for k, v in briefing["counts"].items():
        lines.append(f"count_{k}={v}")

    lines.append("")
    lines.append("RULE THRESHOLDS (what the console judges machines against):")
    for k in ("idle_utilisation_warn", "idle_utilisation_crit", "service_interval_hours",
              "transit_days", "service_days", "due_soon_days", "coolant_warn_c",
              "coolant_failure_c"):
        lines.append(f"  {k}={config[k]}")
    lines.append(f"  day_rates_inr={config['day_rates']}")

    lines.append("")
    lines.append("MACHINES (id | model | serial | type | status | site | operator | util% | "
                 "engine h/day | idle h/day | operating days | hours since service | "
                 "due back | day rate INR):")
    for a in assets:
        lines.append(
            f"  {a.equipment_id} | {a.model} | {a.serial_number} | {a.type} | "
            f"{'on rent' if a.on_rent else 'at yard'} | "
            f"{a.site_id or 'NO SITE'} | {a.operator_id or 'NO OPERATOR'} | "
            f"{a.utilisation * 100:.1f} | {a.engine_hours_day} | {a.idle_hours_day} | "
            f"{a.operating_days} | {a.hours_since_service} | "
            f"{a.check_in_date} | {a.day_rate}"
        )

    lines.append("")
    lines.append("FLAGS RAISED (rule | machine | severity | value INR | what it means):")
    for f in bundle.anomalies:
        lines.append(f"  {f.rule_id} | {f.equipment_id} | {f.severity} | "
                     f"{f.est_value_inr} | {f.title}")

    for m in bundle.maintenance:
        lines.append("")
        lines.append(f"MAINTENANCE RISK: {m.equipment_id} SPN {m.spn} FMI {m.fmi}, "
                     f"coolant {m.current_temp_c} C rising {m.slope} C/day, "
                     f"{m.days_to_failure} operating days to failure, part: {m.part}")

    if bundle.availability:
        av = bundle.availability
        lines.append("")
        lines.append(f"AVAILABILITY: can_commit={av.can_commit} machine={av.equipment_id} "
                     f"free_from={av.free_from} confidence={av.confidence}")

    lines.append("")
    lines.append("SITES (site | machines | utilisation% | idle cost INR):")
    for s in usage["by_site"]:
        lines.append(f"  {s['site_id']} | {s['assets']} | {s['utilisation_pct']} | "
                     f"{s['idle_cost_inr']}")

    return "\n".join(lines)


# ---------------------------------------------------------------- local answers
def answer_locally(question: str, assets: list, bundle: Any, usage: dict,
                   value: dict, briefing: dict) -> tuple[str, list[str]] | None:
    """
    Deterministic answers to the questions a dealer actually asks.

    Tried BEFORE the model, so the common path needs no network and cannot drift. Returns
    the sentence plus the exact figures it used, or None to hand over to the model.
    """
    q = question.lower().strip()
    fleet = usage["fleet"]

    def has(*words: str) -> bool:
        return any(w in q for w in words)

    if has("utilisation", "utilization", "usage rate") and not has("site", "lowest", "worst"):
        return (
            f"The fleet is running at {fleet['utilisation_pct']}% utilisation across "
            f"{len(usage['by_site'])} sites this morning.",
            [f"fleet_utilisation_pct={fleet['utilisation_pct']}"],
        )

    if has("how many") and has("rent", "rented", "out"):
        n = len([a for a in assets if a.on_rent])
        return (
            f"{n} of {len(assets)} machines are out on rent; the remaining "
            f"{len(assets) - n} are back at the yard.",
            [f"machines_on_rent={n}", f"machines_total={len(assets)}"],
        )

    if has("how many") and has("machine", "asset", "equipment") and not has("rent"):
        return (f"There are {len(assets)} machines on the board.",
                [f"machines_total={len(assets)}"])

    if has("overdue", "late", "past due", "past their return"):
        late = [f for f in bundle.anomalies if f.rule_id == "R6"]
        if late:
            worst = max(late, key=lambda f: f.est_value_inr)
            days = next((s.value for s in worst.signals if s.field == "days_overdue"), "?")
            ids = ", ".join(sorted(f.equipment_id for f in late))
            return (
                f"{len(late)} machines are past their return date - {ids}. "
                f"{worst.equipment_id} is the worst at {days} days.",
                [f"count_overdue={len(late)}", f"{worst.equipment_id}_days_overdue={days}"],
            )
        return ("Nothing is past its return date today.", ["count_overdue=0"])

    if has("nobody", "no site", "unassigned", "ghost", "no operator"):
        ghosts = sorted({f.equipment_id for f in bundle.anomalies if f.rule_id == "R1"})
        if ghosts:
            waste = sum(v for k, v in value["by_asset"]["waste"].items() if k in ghosts)
            return (
                f"{' and '.join(ghosts)} are on rent with no site and no operator. "
                f"That is {inr_words(waste)} of rental billed for nothing.",
                [f"unassigned={','.join(ghosts)}", f"waste_inr={waste}"],
            )
        return ("Every machine on rent has a site and an operator.", ["unassigned=0"])

    if has("break", "breaking", "fail", "service", "maintenance", "coolant", "temperature"):
        if bundle.maintenance:
            m = bundle.maintenance[0]
            return (
                f"{m.equipment_id} needs servicing before it goes out again: its coolant is "
                f"{m.current_temp_c} deg C and climbing {m.slope} deg C a day, which is "
                f"SPN {m.spn} / FMI {m.fmi}. About {m.days_to_failure} operating days of "
                f"headroom on the {m.part.lower()}.",
                [f"{m.equipment_id}_coolant_c={m.current_temp_c}",
                 f"{m.equipment_id}_days_to_failure={m.days_to_failure}"],
            )
        return ("No machine is showing a maintenance risk right now.", ["maintenance=0"])

    if has("cost", "money", "worth", "losing", "waste", "exposure", "rupee", "inr"):
        return (
            f"{inr_words(value['waste_inr'])} has already been wasted, "
            f"{inr_words(value['recoverable_inr'])} is still billable, and "
            f"{inr_words(value['avoided_inr'])} of downtime has been avoided. They are three "
            f"different kinds of money, so the console never adds them into one figure.",
            [f"waste_inr={value['waste_inr']}",
             f"recoverable_inr={value['recoverable_inr']}",
             f"avoided_inr={value['avoided_inr']}"],
        )

    if has("worst site", "lowest site", "which site", "redeploy", "weakest"):
        s = usage["by_site"][0]
        return (
            f"{s['site_id']} is the weakest at {s['utilisation_pct']}% utilisation across "
            f"{s['assets']} machines, carrying {inr_words(s['idle_cost_inr'])} of idle cost. "
            f"That is where to redeploy from.",
            [f"{s['site_id']}_utilisation_pct={s['utilisation_pct']}",
             f"{s['site_id']}_idle_cost_inr={s['idle_cost_inr']}"],
        )

    if has("commit", "promise", "available", "monday", "booking"):
        av = bundle.availability
        if av and av.can_commit:
            return (
                f"Yes - {av.equipment_id}, free from {av.free_from}, at "
                f"{av.confidence * 100:.0f}% confidence. {av.reason}",
                [f"commit={av.equipment_id}", f"confidence={av.confidence}"],
            )
        if av:
            return (av.reason, ["can_commit=false"])

    if has("flag", "alert", "wrong", "problem", "attention", "critical"):
        crit = [f for f in bundle.anomalies if f.severity == "CRITICAL"]
        return (
            f"{len(bundle.anomalies)} flags are open, {len(crit)} of them critical, "
            f"across {len({f.equipment_id for f in bundle.anomalies})} machines.",
            [f"flags={len(bundle.anomalies)}", f"critical={len(crit)}"],
        )

    return None


# ---------------------------------------------------------------- the model
def answer_with_model(question: str, context: str) -> str:
    """Ask Groq. Raises on any failure so the caller can fall back cleanly."""
    import httpx

    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")

    r = httpx.post(
        GROQ_URL,
        timeout=TIMEOUT_S,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "temperature": 0,
            "max_tokens": 220,
            "messages": [
                {"role": "system", "content": f"{SYSTEM}\n\nFLEET DATA:\n{context}"},
                {"role": "user", "content": question[:400]},
            ],
        },
    )
    r.raise_for_status()
    data = r.json()
    text = (data["choices"][0]["message"].get("content") or "").strip()
    if not text:
        raise RuntimeError("empty completion")
    return text


# Standalone numbers only. Without the guards this matched the digits buried inside an
# identifier - "CAT00D6XPX01003" yielded "01003" - and flagged a correct answer as
# unverified. A false alarm on a trust indicator is worse than no indicator.
_NUMBER = re.compile(r"(?<![\w.,])\d[\d,]*(?:\.\d+)?(?![\w])")


def numbers_in(text: str) -> set[str]:
    """Bare numbers a sentence asserts, for checking them back against the data."""
    return {m.group(0).replace(",", "").rstrip(".") for m in _NUMBER.finditer(text)}


SUGGESTIONS = [
    "What is the current utilisation rate?",
    "How many machines are rented out?",
    "Which machines are on rent to nobody?",
    "What is about to break?",
    "Which site should I fix first?",
    "How much money is at stake?",
]
