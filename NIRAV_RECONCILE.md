# Reconciliation — Nirav's backend plan vs. the team architecture

Nirav's plan is sound and independently arrived at the same three key decisions we did:
the event ledger, AI as plain imported functions rather than a microservice, and stub
endpoints so the frontend is never blocked. That agreement is worth more than it looks —
it means the two designs are compatible and only the surface needs merging.

Below are the only things that must be settled. Do it in one ten-minute conversation.
Everything not listed here, keep exactly as Nirav wrote it.

---

## A. Three name collisions — decide in 60 seconds, then never revisit

Mantesh is about to build against one of these. If it is the wrong one, that work is thrown away.

| Nirav's plan | Team architecture | Decision |
|---|---|---|
| `GET /equipment` | `GET /assets` | **Pick one now.** Pure coin-flip, zero technical difference. Nirav writes it, so Nirav picks. Tell Mantesh within five minutes. |
| `POST /checkout` `/assign` `/log-usage` `/checkin` | single `POST /events` with `event_type` | **Keep Nirav's four routes.** Make each one a three-line wrapper that writes a single event row. Readable URLs *and* one write path — both designs win, no compromise. |
| `GET /alerts` + `GET /anomalies` | `GET /anomalies` | **Keep Nirav's unified `/alerts` feed.** His idea is better than ours: overdue + anomaly + maintenance in one panel instead of two systems. Adopt it. |

## B. `GET /forecast` is the wrong endpoint — this one is not cosmetic

Nirav's plan has `forecast_demand(...)`. The briefing recording is explicit that the judge
does **not** want a demand curve:

> "I as a dealer have 10 assets, 9 are in a cycle. A customer requests one next Monday.
> I see a few come back Friday, so I commit those for the Monday delivery."

That is an **availability commitment** question, not a forecast. Prajwal is building
`answer_availability(type, site, needed_from, days) -> AvailabilityAnswer`. If Nirav builds
`/forecast` expecting a time series and Prajwal returns a commitment answer, they produce
two incompatible things and find out at 2:30.

**Rename to `GET /availability`** with the query shape `?type=Excavator&site=S003&from=2025-05-19&days=10`.

## C. Three time bombs

**1. No pinned clock.** Nirav's plan has no `NOW` constant, and the overdue job would read
the system clock. The dataset is dated 2025 and the machine says 2026 — every asset would
show a year overdue and the availability logic returns nonsense. Import `NOW` from
`config.py`. Nothing in the repo calls `datetime.now()` for business logic.

**2. Postgres + Docker + migrations, in a four-hour build.** Installing and starting Postgres
locally on a hackathon laptop is 20–45 minutes that produces zero demo value, and it means
provisioning a hosted Postgres to deploy as well. **Use SQLite.** Keep SQLAlchemy exactly as
planned — the swap is one connection string, so the "we would run Postgres in production"
answer stays fully credible. Nobody watching the demo can tell the difference.

**3. APScheduler for overdue alerts.** A background timer in a four-hour build is a bug farm,
and it is unnecessary: **overdue is a pure function of `NOW` vs `check_in_date`**, computable
on read in one line. With the clock pinned, a timer job would do literally nothing on every
tick. Delete it and reclaim the time.

## D. Missing endpoints — each one is a scored feature

| Add | Why |
|---|---|
| `GET /maintenance-risk` | The judge asked for fault-code prediction **by name** in the briefing. Currently in neither plan's route list. Returns SPN/FMI + part + action + days-to-failure. |
| `GET /config` · `PUT /config` | Day rates and thresholds, editable live. This is what lets you change a rate while a judge is challenging your number and watch every figure recompute. Without it that moment is a loss. |
| `GET /ledger` · `POST /ledger` | The cost-avoided number Nirav's plan references as "Role 4's calculation" has no endpoint to live in. It needs one, or the closing beat has nothing to show. |
| `POST /reset` | One key restores exact demo state between rehearsals. Ten lines. You will use it fifteen times. |

## E. The plan ends at localhost — fix this first

> "make sure your API is running on a stable local URL/port ... e.g. http://localhost:8000"

There is no deployment step anywhere in the plan. Demoing from a laptop is how teams lose
to a sleeping machine, a dead port, or venue wifi. **Deploy the API to Render or Railway
and the web app to Vercel by 1:30 PM**, before either is any good. The first deploy always
fails for a boring reason — let it fail with three hours left.

## F. Keep these from Nirav's plan — they are better than what we had

- `GET /health` before anything else. Catches environment problems while they are cheap.
- A Postman collection or one-page endpoint list handed to Mantesh, so he never reads source.
- Sitting **with** Mantesh for the first few real requests instead of messaging him the URL.
- Recording final condition on check-in — this satisfies "log usage **and conditions**",
  which most teams drop entirely.
- The unified alerts feed (see §A).

## G. Send Nirav these files

He wrote his plan from placeholders because the artifact links do not render for external
fetching and the dataset never reached him. Send him, as attachments:

- `api/schemas.py` — the frozen contract
- `api/config.py` — pinned clock, thresholds, rates
- `api/main.py` — nine working endpoints he can merge into his structure
- `data/seed_assets.json` — the real seven rows plus derived fields
- `ARCHITECTURE.md`

His Section 3 schema is a good guess. The real columns are in `seed_assets.json`, and his
four tables map onto it cleanly — `equipment`, `rental_events`, `usage_logs`, `alerts` all survive.
