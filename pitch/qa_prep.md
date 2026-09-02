# Q&A prep — model and data answers

Prajwal answers everything below. Read it before the demo, not during it.
Every number here is reproduced by `python -m pytest api/test_intelligence.py -q`.

---

## 1. "How much of this is real?"

> The seven machines and their figures are yours, unchanged — you can diff
> `data/seed_assets_given.json` against the first seven rows of `data/seed_assets.json`
> and they are byte-identical; we have a test that fails the build if they ever differ.
> The telemetry history is synthetic, and here is the generator.
>
> For everything we *had* to synthesise, we grounded it in a real heavy-equipment
> distribution dataset — 806,485 transactions, 243 SKUs, 83 dealer branches across 36
> countries, eleven years. Our extra machines are real catalogue SKUs at your four Indian
> branches. Our booking customer is a real contractor row.
>
> **That dataset is not Caterpillar's, and we do not present it as such.** Caterpillar is
> one of 163 brands in it, about 5% of rows. We used it as a catalogue, not as evidence
> about your business.

**Do not let anyone on the team call it "official Caterpillar data" on stage.** One Volvo
invoice on screen and the credibility of everything else goes with it. The honest version
is stronger and costs nothing.

---

## 2. "How was the telemetry generated, and how do you know it matches our numbers?"

Not fitted — **derived**. Every one of the seven given rows satisfies two identities
exactly:

```
cumulative_operating_hours == engine_hours_day × operating_days
total_idle_hours           == idle_hours_day   × operating_days
```

Check them by hand: 1.5×15 = 22.5 · 0×20 = 0 · 7.5×25 = 187.5 · 2×25 = 50 · 8×30 = 240 ·
3×18 = 54 · 0×12 = 0. And the idle side reproduces your own summary column: 150, 220,
12.5, 225, 0, 108, 144.

So the hourly series is not a free parameter. It accrues `engine_hours_day / 24` per hour
across the operating window and **must** land on the number already on the asset row.
`generate_seed.py` asserts that at generation time and refuses to write files if any
machine drifts by more than 0.05 hours. The history cannot silently disagree with your data.

**Why telemetry only exists inside the operating window:** a machine parked in the yard
does not emit engine telemetry. That is why EQX1005's coolant trace ends on 30 January —
which turns out to be the point (see §5).

---

## 3. "Which parts are rules and which parts are models?"

| Output | Kind | Basis |
|---|---|---|
| R1 UNASSIGNED, R3 ZERO_OUTPUT, R6 OVERDUE, R7 NO_OPERATOR | Rule — null/threshold check | Single field against a config value |
| R2 IDLE_BURN | Rule — ratio threshold | `engine / (engine + idle)` vs 0.35 / 0.20 |
| R4 WINDOW_CONFLICT | Rule — **cross-field contradiction** | `operating_days > (check_in − check_out) + 1` |
| R5 SERVICE_DUE | Rule — threshold | `hours_since_service ≥ 200` |
| Availability | Deterministic search | Sort over computed free-dates |
| **Coolant risk** | **Statistical — the only one** | Rolling 24-reading mean + least-squares slope over 7 days |

**Nothing is trained. Nothing is random.** There is no model file, no fitted weights, no
RNG at inference. Run it twice and the output is byte-identical — that is a test
(`test_analyze_is_deterministic`).

Three *kinds* of reasoning, not ten thresholds repeated: a threshold rule, a cross-field
contradiction, and a predictive trend.

### If asked "so where is the AI?"

> Deliberately, this is the smallest model that answers the question. Seven rows train
> nothing, and a neural network here would be a decoration we could not defend. What we
> built instead is explainable by construction: every flag ships the field names, their
> values, and the threshold that was crossed, so you can audit any verdict in two seconds.
> The one statistical component is a least-squares fit whose inputs are on the sparkline.

### If asked for an accuracy figure

> We will not quote one, because on seven rows any accuracy number would be invented.
> What we can show is determinism and auditability: 19 assertions pin every rule to the
> exact asset, severity and rupee value it produces, and each of those figures is
> arithmetic you can redo by hand from what is on the screen.

---

## 4. "Why an availability engine and not a demand forecast?"

Because that is the question you actually asked in the briefing:

> *"I have 10 assets, 9 are in a cycle. A customer requests one next Monday. I see a few
> come back Friday, so I commit those for the Monday delivery."*

That is a commitment question, not a time series. A bar chart of predicted demand does
not tell you which machine to promise.

And there is a second reason, from the data: **the source catalogue contains no demand
signal at all.** Excavator units by month, aggregated across eleven years:

```
3433  3241  3409  3304  3466  3377  3485  3407  3326  3355  3427  3553
```

Flat to about 3%. Anything we forecast off that is a horizontal line with error bars. We
would rather answer the phone call than draw that chart.

**The same caution applies to the delivery column.** The catalogue has a `DeliveryDate`,
and it is tempting to use it as transit time — but it measures order-to-delivery for a
*purchase* (median 15 days, and identical at all four Indian branches). Yard-to-site
transit is a different quantity. We left `transit_days` as a stated, editable assumption
rather than borrowing a number that means something else.

---

## 5. "Your coolant machine has been in the yard since January. What is a 4-day countdown worth?"

**This is the sharpest question in the set. Have the answer ready.**

> It is four *operating* days, not four calendar days. The countdown is paused because the
> machine is parked — and that is exactly why it matters now. EQX1005 came back on
> 31 January with its coolant rolling mean at 111.5 °C, rising 0.8 °C a day, and it has sat
> un-serviced ever since at 240 hours past its interval. The recommendation is not "it will
> fail on Friday." It is: **do not put this machine on the Monday job.** You have roughly
> four operating days of headroom before 115 °C, and the customer would burn them in four
> days.

That is also why R5 SERVICE_DUE and the availability engine agree: a machine over its
service interval has `service_days` added to its free-from date before it can be committed.

SPN 110 / FMI 0 is genuine SAE J1939 — engine coolant temperature, data valid but above
normal, most severe. We did not invent a code. The fault codes are also written into the
telemetry itself, not just derived at read time.

---

## 6. "What is the number, and how do you defend it?"

**Do not quote a single blended total.** Three rules produce three different kinds of
money, and adding them together produces a figure that dies on the first question:

| Bucket | Amount | Rules | What it is |
|---|---|---|---|
| Waste already burned | ₹12,66,470 | R1 R2 R3 R7 | Money spent on machines that produced nothing |
| Still billable | ₹21,61,000 | R4 R6 | Extensions you have not invoiced |
| Downtime avoided | ₹18,000 | R5 | One service before a failure |

**The headline claim is the narrow one: ₹6,20,000.** EQX1002 and EQX1007 were on rent for
32 combined days at zero engine hours — 22,000 × 20 plus 15,000 × 12. That is arithmetic
on your own rows, not a model, and it is the one number to lead with.

If challenged on EQX1002 specifically: R3 says the 20-day rental was 100% waste (₹440,000)
and R6 says it is 43 days past return (₹946,000 billable). **Both are true and they are not
added.** The ledger keeps them in separate buckets for precisely this reason.

Within the waste bucket, a machine is counted once — R1 and R3 both fire on EQX1002 for the
same rental line, so the per-asset maximum is taken, not the sum. Without that the total
would read ₹1.24M instead of ₹620,000, and the first person to check the arithmetic would
find it.

### If a judge challenges a day rate

Change it on the settings screen. `PUT /config` deep-merges, so moving the Excavator rate
moves every excavator figure and leaves the other three alone. There is also a
**price-implied** basis on that screen: each rate is the published excavator rate scaled by
the real median SKU list price for that class, from 806,485 transactions.

Be upfront about its one weakness: the catalogue has **no grader category**. Mapped to
RoadPavers it prices a grader above an excavator, which is wrong for real equipment. That
is why the published card stays the default and the derived column is offered as a
cross-check, not a replacement.

---

## 7. "Does it scale?"

> The telemetry contract is ISO 15143-3, the events are append-only, and status is a
> projection rather than a stored column — so history is never destroyed by an update. At
> your volume this is Kinesis into Helios with Snowflake behind it; the seams are already
> where they need to be. Swapping SQLite for Postgres is a connection string, because only
> one module touches storage. The catalogue extraction already runs over 806,485 rows.

---

## 8. "Is that real authentication?"

Answer the narrow question first, because the honest answer is stronger than the
flattering one and a judge will find the seam anyway.

> It is a real enforcement boundary and an honest audit trail. It is not identity — and
> it is one function away from being identity.

**What is actually enforced.** One server-side secret, `ADMIN_TOKEN`, checked in
`require_admin` on every call to the two state-changing routes. It is an environment
variable in the host's secret store, in no file in this repository, typed at sign-in and
held in `sessionStorage` for one browser tab. Signing in issues no token and stores no
session: `/reset` and `PUT /config` re-check the header every time regardless of who you
said you were, which is pinned by a test.

**What is not.** The name on the session is self-declared. Nothing stops somebody typing
a colleague's name, so the event log is **attributable, not authenticated**. And a single
shared key cannot be revoked for one person, does not record which person used it, and
has to be rotated for everybody when one of them leaves.

**Why we built it that way.** The alternative was a hand-rolled password store sitting
beside the seed data — argon2 hashes, session tokens, reset flows, rate limiting. That
would have been the largest attack surface in this project and the weakest thing in it,
and defending it to you would have been worse than defending this. What sign-in buys is
narrower and real: every check-out, assignment and usage row now carries a name instead
of the literal string `"scan"`, which is the *who* in the kickoff deck's own design
principle on the Experience slide — every status change answers who, what, where and
when. It was the only one of those four the log could not actually
answer. It also took the dealer key out of the shipped bundle, where a `VITE_*`
variable would have published it to every visitor.

### The swap, if asked what production looks like

> Replace `require_admin` with an OIDC bearer-token check against the dealer's own
> identity provider, and read the actor from the verified token instead of the form
> field. Dealers already have an IdP and do not want another password.

Concretely, and it is genuinely this small:

| Today | Production |
|---|---|
| `require_admin` compares a header to one shared secret | validates a JWT: signature against the IdP's JWKS, `iss`, `aud`, `exp` |
| role is claimed by the sign-in form | role comes from the token's group or role claim |
| actor is typed by the user | actor is the token's `sub` / `email` |
| revoke = rotate the key for everyone | revoke = disable one account at the IdP |

**One function and one field.** Nothing downstream moves, because every consumer already
reads `actor` off the event log rather than off the session — the log does not care how
the name was established, only that one was. The role ladder, the route guard and all
three consoles are unchanged; `ROLES` stops being a constant and becomes a claim mapping.

The reason it is that small is a decision made early: identity was never allowed to
become a second source of truth. The server has always trusted exactly one thing, and
replacing that one thing is the whole migration.

---

## 9. Two things the demo script must be updated for

1. **Beat 4 commits EQX1007, not EQX1004.** The ranking returns the machine that is
   already sitting in the yard doing nothing, at confidence 1.00, ahead of the one
   returning Friday. EQX1004 becomes the second line — *"and if you want one that has been
   working, EQX1004 is back Friday."* That is a better answer, not a worse one.
2. **39.2% fleet utilisation is a seven-asset number.** With the twenty catalogue-grounded
   machines on the board it no longer describes the whole fleet. Say *"the seven you gave
   us run at 39.2%"* and let the wider fleet be context.

---

## 10. The one-line answers

| Question | Answer |
|---|---|
| Is the data real? | Your seven rows are. The history is synthetic and here is the generator. |
| Is that Caterpillar's dataset? | No — a public distribution catalogue. We used it for SKUs, branches and price ratios only. |
| What is your accuracy? | On seven rows, nobody's accuracy figure is real. Ours is deterministic and auditable instead. |
| Where is the ML? | One least-squares slope. Everything else is a rule, on purpose. |
| Why no forecast? | You asked a commitment question, and the data has no demand signal to forecast. |
| What is it worth? | ₹6,20,000 of zero-output rental, on your own numbers. |
| Is the login real? | The key is enforced server-side on every write. The name is not verified — swap `require_admin` for an OIDC check and the actor comes from the token. |
