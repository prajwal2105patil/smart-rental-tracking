# Value model — where every rupee comes from

**Team MBBS · Smart Rental Tracking System**
Figures below are the live output of the running system at the pinned clock
**`NOW = 2025-05-12`**, across **27 assets** and **7 sites**. Reproduce any of them with
`GET /ledger`, `GET /anomalies`, `GET /usage-summary`.

---

## 1. The headline, and why it is three numbers rather than one

```
already burned      ₹12,66,470     money spent on machines producing nothing
still billable      ₹21,61,000     overdue rental that can be invoiced today
downtime avoided    ₹   18,000     a service day EQX1005 will not lose
                    ───────────
open exposure       ₹34,45,470
```

**These are three different kinds of money and the model refuses to blend them.** Waste
has already left the building. Billable is recoverable if somebody makes a phone call.
Avoided has not happened yet and may never. A single ₹34.4 lakh "savings" headline is
larger and worse: the first judge who asks *"is that money you lost or money you might
get?"* collapses it. Keeping the buckets apart is the difference between a number that
survives scrutiny and a number that invites it.

A fourth category exists and is deliberately worth **₹0**:

```
reminder            ₹        0     R8, a machine due back inside the window
```

Nothing has been lost on a machine that is merely due back soon. Pricing a reminder would
inflate the total with money that was never at risk.

---

## 2. The rate card, and the second one underneath it

Every rupee below is `days × day_rate` or `hours × hourly_rate`. There is exactly one
source of rates, in `api/config.py`, and **not one numeric literal in the rules file** —
change a rate in Settings and every figure on the board moves.

| Type | Published card (default) | Price-implied (alternate basis) |
|---|---:|---:|
| Excavator | ₹15,000 | ₹15,000 |
| Bulldozer | ₹18,000 | ₹13,000 |
| Crane | ₹22,000 | ₹18,000 |
| Grader | ₹12,000 | ₹19,500 |

The second column is derived from the 243-SKU catalogue: `median(category SKU price) × k`,
with `k = 2.131` anchored so the excavator reproduces the ₹15,000 published rate. It is
shown on the Settings screen and can be switched to live.

**Say this if asked why two:** the published card is what a dealer actually charges. The
implied card proves the published one is not invented — it is within a plausible ratio of
what the machines cost across a real 806,485-row catalogue. Grader is the outlier and we
do not hide it: there is no grader category in the catalogue, so `RP-236 RoadPavers` is
the nearest real SKU and the gap is stated rather than smoothed.

---

## 3. Every rupee, per machine, per rule

**15 anomalies fire** — 9 CRITICAL, 5 WARNING, 1 INFO — across 8 rules:
R1×2, R2×3, R3×2, R4×1, R5×1, R6×3, R7×2, R8×1.

### Already burned — ₹12,66,470

| Machine | Type | Arithmetic | Amount |
|---|---|---|---:|
| EQX1002 | Crane | 20 operating days × ₹22,000 | **₹4,40,000** |
| EQX1004 | Excavator | 9 idle h/day × (₹15,000 ÷ 11 h) × 25 days | **₹3,06,818** |
| EQX1001 | Excavator | 10 idle h/day × (₹15,000 ÷ 11.5 h) × 15 days | **₹1,95,652** |
| EQX1007 | Excavator | 12 operating days × ₹15,000 | **₹1,80,000** |
| EQX1006 | Grader | 6 idle h/day × (₹12,000 ÷ 9 h) × 18 days | **₹1,44,000** |
| | | | **₹12,66,470** |

The two zero-output machines together are **₹6,20,000** — the figure the morning briefing
leads with, and the one the demo opens on.

The idle formula is the load-bearing one:

```
hourly_rate  = day_rate ÷ (engine_hours_day + idle_hours_day)
idle_waste   = idle_hours_day × hourly_rate × operating_days
```

The rate is divided by the machine's **actual** working day, not a nominal eight hours.
A machine billed at ₹15,000 that is on for 11.5 hours costs ₹1,304.35 an hour; ten of
those hours produce nothing. That is a defensible unit cost rather than a chosen one.

### Still billable — ₹21,61,000

| Machine | Rule | Arithmetic | Amount |
|---|---|---|---:|
| EQX1002 | R6 overdue | 43 days late × ₹22,000 | **₹9,46,000** |
| EQX1007 | R6 overdue | 41 days late × ₹15,000 | **₹6,15,000** |
| EQX1001 | R6 overdue | 26 days late × ₹15,000 | **₹3,90,000** |
| EQX1004 | R4 cross-field | 14 days × ₹15,000 | **₹2,10,000** |
| | | | **₹21,61,000** |

This is **not** loss. It is rental already earned and not yet invoiced, which is why it
sits in its own bucket. A dealer recovers it by recalling the machine or billing the
extension — the ledger names which.

### Downtime avoided — ₹18,000

| Machine | Arithmetic | Amount |
|---|---|---:|
| EQX1005 | 1 service day × ₹18,000 (Bulldozer) | **₹18,000** |

Deliberately small, and deliberately not inflated to "the cost of a seized engine". We
claim the one service day the schedule saves, because that is the number we can defend.

---

## 4. The de-duplication rule — the most important line in the model

**Within a bucket, a machine counts once, at its largest firing rule.**

EQX1002 fires three waste rules on one rental line:

| Rule | What it saw | Value |
|---|---|---:|
| R1 | zero output for 20 operating days | ₹4,40,000 |
| R3 | on rent, attached to no site | ₹4,40,000 |
| R7 | no operator (half the rental line) | ₹2,20,000 |
| | **summed** | ~~₹11,00,000~~ |
| | **counted** | **₹4,40,000** |

Summing them charges the same rental line two and a half times: **₹11,00,000 claimed
against ₹4,40,000 that is defensible.** The ledger takes the largest and stops.

> Three rules firing on one rental line is **three reasons, not three invoices.**

Say that sentence before a judge asks for it. It is the single most credible thing in the
value model, and volunteering it is worth more than surviving the question.

---

## 5. Idle cost across the fleet — the bigger, softer number

`GET /usage-summary` reports the whole fleet's idle exposure, which is larger than the
ledger because it counts every idle hour rather than only the rule-flagged ones:

| | |
|---|---:|
| Engine hours | 4,004.3 |
| Idle hours (downtime) | 1,608.7 |
| **Fleet utilisation** | **71.3%** |
| Fleet idle cost | ₹26,91,098 |

By site, worst first — this is the redeployment order:

| Site | Utilisation | Machines | Idle cost |
|---|---:|---:|---:|
| UNASSIGNED | 0.0% | 2 | ₹6,20,000 |
| S004 | 64.4% | 4 | ₹7,04,929 |
| S003 | 67.4% | 4 | ₹2,86,451 |
| S001 | 73.9% | 5 | ₹4,35,042 |
| S005 | 80.0% | 3 | ₹1,08,828 |
| S002 | 86.3% | 5 | ₹4,46,177 |
| S006 | 93.3% | 4 | ₹89,671 |

**Use the ledger's ₹34,45,470 in the pitch, not the ₹26,91,098.** The ledger figure is
attributable machine by machine and rule by rule; the fleet idle cost is a fleet-wide
aggregate that includes normal, unavoidable idling. The smaller, harder number is worth
more than the larger, softer one.

> **If a judge asks for one number:** *"₹6,20,000, on two machines, today."* It is the
> narrowest claim we make and the only one that needs no explanation at all.

---

## 6. What is statistical, and what is not

Almost nothing here is a model, and that is a design decision rather than a shortcut.

| Component | Method | Why |
|---|---|---|
| R1–R4, R6–R8 | thresholds and cross-field contradictions | On seven given rows nothing can be validated statistically. Determinism and auditability can. |
| R5 service interval | threshold on hours since service | 200 h, from config |
| **Maintenance risk** | **rolling 24-reading mean + least-squares slope over 7 days** | The one genuinely statistical component |
| Availability | deterministic ranking | local → earliest free → best condition → fewest hours |
| Demand forecast | mechanical projection, not regression | See below |
| Briefing prose | generated from rules that already fired | No language model. Every sentence is arithmetic underneath. |

**EQX1005, worked end to end:** coolant at **111.54 °C** rising **0.801 °C/day** →
SPN 110 / FMI 0 → **4.33 operating days** of headroom → replace the cooling package
(radiator core + thermostat).

Days to failure are **operating** days, not calendar days. A machine sitting in the yard
is not heating up, so the countdown pauses. This is the detail that shows the model
understands the machine rather than the spreadsheet.

---

## 7. Why there is no demand curve

The forecast panel projects; it does not fit. The reason is measurable and we put it on
the record rather than hiding it.

The catalogue behind this build carries **eleven years of monthly volume**. Excavator
units by month across all of it:

```
3433  3241  3409  3304  3466  3377  3485  3407  3326  3355  3427  3553
```

**Flat to within 3%.** Fit a regression to that and you get a horizontal line with a
confidence interval drawn on it — decoration, not a prediction.

What the data *does* support is mechanical:

> A site is working a machine type at a rate read off that machine's own cumulative
> counter — never a typed-in field — and a machine of that type is booked to leave inside
> the horizon. **The site is short from the day it goes.**

Four config values are the entire model: horizon (7 days), measurement window (14 days),
the working rate below which a site is not really using a type (1.0 engine h/day), and the
rate at which the need is called with full confidence (4.0 engine h/day). Confidence is
one division against the last of those, capped at 1.00.

Live output:

| | Site | Needs | From | Confidence | Cover |
|---|---|---|---|---:|---|
| PROJECTED | S004 | Excavator | 15 May | 0.50 | EQX1007 |
| PROJECTED | S001 | Grader | 17 May | 1.00 | EQX1006 |
| PROJECTED | S002 | Bulldozer | 19 May | 1.00 | EQX1021 |
| BOOKED | S003 | Excavator | 19 May | 1.00 | EQX1007 |

S004 scores 0.50 because it is losing 2.0 engine h/day against the 4.0 h/day bar — the
whole confidence model, in one division, with nothing hidden inside it.

A **booking is never blended with a projection.** A request somebody actually made is not
a guess, so it is labelled and reported at full confidence in the same shape.

Cover comes from the availability engine rather than a second calculation, so the forecast
panel and the availability panel **cannot drift apart**.

---

## 8. What we will not claim

Stated here so nobody on the team is tempted mid-answer:

- **Not Caterpillar's official data.** The catalogue carries 163 brands; Caterpillar is
  5.0% of rows. One Volvo invoice on screen would end the credibility of everything else.
  The honest framing is stronger and it is the one we use.
- **Not a validated model.** Seven given rows cannot validate anything statistically. What
  is demonstrable is determinism, auditability, and 57 passing tests that pin every rupee.
- **Not transit times from the dataset.** `DeliveryDate` lead time is order-to-delivery for
  a *purchase* — median 15 days, identical across all four Indian branches. Wiring it in
  would make nothing ever commitable. Our transit matrix is a **stated assumption**,
  printed on the Settings screen and editable.
- **Not blended totals.** Waste, billable and avoided stay apart in every sentence.
