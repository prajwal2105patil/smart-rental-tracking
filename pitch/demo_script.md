# Demo script — five minutes, five beats

**Team MBBS · Smart Rental Tracking System · Caterpillar hackathon, Jain University**

The five beats are the ones on slide 10: **SPOT → EXPLAIN → ACT → PREDICT → PROVE**.
Everything below is a real click on a running system. No slide is shown during the demo.

> **One correction to the kickoff script.** Slide 10 beat 03 says *"commit EQX1004"*.
> The availability engine returns **EQX1007**, and it is right to — EQX1004 is still out
> on rent until 15 May, while EQX1007 is sitting unassigned with zero output. Use
> EQX1007. It is also a better story, because EQX1007 is the machine beat 01 opens on:
> the thing we spotted is the thing we commit. Do not say EQX1004.

---

## Before you start

| Check | Command / action | Expected |
|---|---|---|
| API up | `curl -s localhost:8000/health` | `assets: 27`, `telemetry_snapshots: 15144` |
| Clock pinned | top-right of the console | `CLOCK 2025-05-12` |
| Clean state | `curl -X POST localhost:8000/reset` | `{"ok": true}` |
| Browser | one tab on `/fleet`, one on `/` (landing) | both painted, no red banner |
| Phone | `npm run dev:phone`, open the **https** address | scan page loads, camera starts |

Reset immediately before you present. The ledger is append-only, so a rehearsal leaves
rows behind and the PROVE number will not match this script.

---

## 0:00 — 0:35 · SPOT
### "A rented machine nobody is watching is a machine you are paying for twice."

Open on **`/fleet`**. Do not scroll. Read the top line of the morning briefing:

> **9 things need you today.**
> 27 machines on the board this morning, running at **71.3%** utilisation across 7 sites.

Then point at the second line and let it do the work:

> EQX1002 and EQX1007 are on rent to nobody — no site, no operator, and not a single
> engine hour. That is **₹6,20,000** of rental billed for nothing.

**Say:** *"This is not a report we generated. It is six sentences the rules wrote, from
the same numbers on the rest of this screen. No language model is involved in any of
them — every figure here appears somewhere else and can be checked against it."*

Click the **critical → 9** tile. The report opens listing the nine, worth most first.

**Why this beat first:** it establishes that the board is honest before anything
impressive happens. Everything after this inherits that.

---

## 0:35 — 1:20 · EXPLAIN
### "No site, no operator, zero runtime."

Click **EQX1007** in the report. The asset panel opens.

Point at the signal block:

- `site_id` = **null**
- `operator_id` = **null**
- `engine_hours_day` = **0.0**
- `idle_hours_day` = **12.0**
- `operating_days` = **12**

**Say:** *"Three rules fire on this machine, and each one shows its working. R1 is a
threshold — zero output for twelve days. R3 is a cross-field contradiction — it is on
rent and attached to nothing. R7 is the missing operator. Every flag carries the field
name, the value it read, and the threshold it crossed. A dealer who disagrees with the
flag can see exactly which number to argue about."*

If a judge asks **"why is it not worth 3 × the rental line?"** — the answer is on the
ledger: within a bucket a machine counts **once**, at its largest rule. Three rules
firing on one rental line is three reasons, not three invoices. Say this before they ask
it if you have the time; it is the single most credible thing in the demo.

---

## 1:20 — 2:10 · ACT
### "An operations lead reassigns or checks in the asset."

Go to the **availability** panel. Ask the judges' own question from slide 06:

> *A customer wants an excavator at S003 on Monday the 19th, for ten days. Can I commit?*

The answer comes back:

> **Yes — EQX1007.** Free from **2025-05-12**. Confidence **1.00**.
> *"EQX1007 is already yours and doing nothing — no site, no operator, 0.0 engine hours
> a day. Available immediately; you do not have to wait for a return."*

Alternatives listed beneath: EQX1016, EQX1001, then EQX1012 *(transfer from IN488
Chennai)*.

**Say:** *"The interesting part is not that it said yes. It is that the honest answer was
already in the yard. The ranking puts local machines before transferred ones, then
earliest free, then best condition, then lowest hours — and the machine it names is the
one we flagged sixty seconds ago as waste. Spotting it and solving it are the same fact."*

Now **act**: assign EQX1007 to S003. One click. The status changes on the board because
the underlying condition changed — status is computed from the event log on every read,
never stored.

*(If short on time, do this on the phone instead — scan the tag, two taps. It is the same
event either way.)*

---

## 2:10 — 3:00 · PREDICT
### "Forecasting identifies a site that will need an excavator next."

Scroll to **What each site will need**. Four rows:

| | Site | Needs | From | Confidence | Cover |
|---|---|---|---|---|---|
| PROJECTED | S004 | Excavator | 15 May | 0.50 | EQX1007 |
| PROJECTED | S001 | Grader | 17 May | 1.00 | EQX1006 |
| PROJECTED | S002 | Bulldozer | 19 May | 1.00 | EQX1021 |
| BOOKED | S003 | Excavator | 19 May | 1.00 | EQX1007 |

**Say this, and say it plainly:** *"We do not fit a demand curve, and we will tell you
why. The catalogue behind this build carries eleven years of monthly volume that is flat
to within three percent. Fit a model to that and you get a horizontal line with a
confidence interval drawn on it. That is not a forecast, it is decoration."*

*"What is knowable is mechanical. A site is working a machine type at a rate we read off
that machine's own cumulative counter — not a typed-in field — and a machine of that type
is booked to leave inside the week. The site is short from the day it goes."*

Expand **S004** with the **why** control. The signals are all there: 2.0 engine hours a
day leaving against a 1.0 floor, one machine, the check-in date, what cover remains, and
`rate_source = measured`. The sparkline beside it is the fourteen days the rate was read
off — the same series, not a second one drawn to agree with it.

**Then land it:** *"Row four is your slide. S003 needs an excavator. And the machine to
send is EQX1007 — the one we opened on."*

---

## 3:00 — 3:50 · PROVE
### "The team shows reduced idle rental time or avoided cost."

Open the **value ledger**.

> **₹34,45,470** open exposure — in three buckets that are never added together in
> conversation, only in a total that says which is which.

| Bucket | Amount | What it is |
|---|---|---|
| Already burned | **₹12,66,470** | money spent on machines producing nothing |
| Still billable | **₹21,61,000** | overdue rental you can invoice today |
| Downtime avoided | **₹18,000** | one service day EQX1005 will not lose |

**Say:** *"These are three different kinds of money and we refuse to blend them. Waste is
gone. Billable is recoverable if you pick up the phone. Avoided has not happened yet.
Adding them into one headline gives you a bigger number that does not survive a
question — and you will ask the question."*

Point at the ledger row your ACT beat just wrote. Every action writes an event **and** a
ledger row together, so the outcome is attributable to the click, not asserted afterwards.

Close on **EQX1005**: SPN 110 / FMI 0, coolant **111.54 °C** climbing **0.801 °C/day**,
**4.33 operating days** of headroom, replace the cooling package.

**Say:** *"Days to failure are operating days, not calendar days — the countdown pauses
while the machine sits in the yard, because a machine that is not running is not heating
up. That is the one place in this system where a statistical method is used: a rolling
24-reading mean and a least-squares slope over seven days, extrapolated to the failure
temperature. Everything else is a rule with a threshold you can read."*

---

## 3:50 — 5:00 · Buffer

Do not fill it. Stop and take questions. If none come, offer one of:

- **Ask the briefing** a question — the assistant answers from verified figures only, and
  any number it asserts that is not in the data it was given is flagged on screen rather
  than shown as fact.
- **Settings** — move the excavator day rate from ₹15,000 to ₹30,000 and watch every
  figure on the board move. Nothing is hard-coded; there is not one numeric literal in
  the rules file.
- **The landing page** — the machine dismantles as you scroll, and the four questions come
  round on a slewing crane.

---

## If something breaks

| Failure | Recovery |
|---|---|
| API unreachable | The board latches the failure and offers **Retry** — it does not spin forever. Press it. If dead: `uvicorn main:app --port 8000` from `api/`. |
| Phone camera refuses | Manual entry sits **beside** the camera, not behind a fallback link. Type `EQX1007`. Same event, same ledger row. |
| Phone shows a certificate warning | Expected — the cert is self-signed. Tap through once. |
| Venue wifi down | Everything is local. The assistant answers common questions deterministically without an outbound call; the badge says `from the rules`. |
| A number looks wrong | `POST /reset`. A rehearsal left ledger rows behind. |
| Anything renders blank | An error boundary catches it and shows the panel, not a white page. Reload; the rest of the board keeps working. |

---

## The three sentences to land

If everything else is cut, these survive:

1. **"Every number on this screen can be traced to the field that produced it."**
2. **"We separate money already burned from money still billable from downtime avoided,
   because adding them gives you a headline that does not survive a question."**
3. **"We did not build a demand forecast, and we can show you the eleven years of flat
   data that is the reason why. We built the prediction the data actually supports."**
