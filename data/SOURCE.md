# Where the data comes from

## The short version

**`hmd_python.csv` is not in this repository and never will be.** It is 153 MB, past
GitHub's 100 MB hard limit per file.

**You do not need it.** Everything derived from it is committed. Clone, start the API, and
the whole system works:

```bash
cd starter/api && python -m uvicorn main:app --port 8000
```

You need the CSV only to **regenerate** the catalogue and seeds — which nobody has to do,
because regeneration is reproducible and produces byte-identical output to what is already
here.

---

## If you do want to regenerate

1. Ask a teammate for `hmd_python.csv` (WhatsApp, a shared drive, a USB stick — it does
   not matter, it is a public BI-training dataset with nothing sensitive in it).
2. Drop it at any of the three paths `catalogue.py` searches. `E:\Caterpillar\hmd_python.csv`
   — beside the `starter/` folder — is the conventional one.
3. Run:

```bash
cd starter/data && python catalogue.py && python generate_seed.py
```

`catalogue.py` **verifies the file before reading it.** It hashes the CSV and compares
against `source_manifest.json`:

```
  sha256 matches the manifest - 806,485 rows, 243 SKUs, 83 branches
```

If that line does not appear, stop. A differently-sourced copy of the same public dataset
would regenerate the seeds silently and quietly invalidate the test suite, the value ledger
and the pitch — and you would find out from a failing assertion on the morning of the demo.
Running `catalogue.py` with no CSV present prints the same fingerprint, so you can check a
file you have been handed before you trust it.

---

## What the manifest pins

`source_manifest.json` is committed and is the fingerprint of the exact file every number
in this project was derived from.

| | |
|---|---|
| sha256 | `5024a01b1897adceb6e76593f4eb827de7f69c149cd526ab8de88a0606406b89` |
| size | 160,855,056 bytes |
| rows × columns | 806,485 × 20 |
| date range | 2002-01-01 → 2013-01-02 |
| distinct SKUs | 243 |
| distinct branches | 83 |
| distinct brands | **163** |
| Caterpillar share of rows | **4.99%** |

Those last two lines are worth keeping visible. **This is not Caterpillar's official
dataset**, and the manifest proves it from a committed file rather than from anybody's
memory: Caterpillar is one brand of 163, at five percent of rows, alongside Volvo, JCB,
Bobcat and Komatsu. We say so out loud in the pitch. One Volvo invoice appearing on screen
after claiming otherwise would end the credibility of everything else on the board.

---

## What is derived from it, and what is not

**Derived from the CSV** — real values, traceable to a real row:

| File | Contents |
|---|---|
| `catalogue_skus.json` | 243 SKUs with fixed per-SKU cost and price |
| `catalogue_branches.json` | 83 dealer branches across 36 countries |
| `catalogue_customers.json` | 236 customers in plant-operating industries |
| `catalogue_rates.json` | price-implied day rates, `k = 2.1310` anchored on Excavator @ ₹15,000 |
| `catalogue_defects.json` | genuine data-quality defects the R4 rule is demonstrated catching |

**Not derived from it** — and deliberately so:

- **Day rates (the default card).** The published rate card is asserted; the price-implied
  column is the cross-check. Both are on the Settings screen.
- **Transit times.** The CSV's `DeliveryDate` lead time is order-to-delivery for a
  *purchase* — median 15 days, identical across all four Indian branches. Wiring it in as
  transit would mean nothing is ever commitable. Our transit matrix is a **stated
  assumption**, printed on Settings and editable.
- **Demand.** There is no demand signal to extract. Excavator units by month across eleven
  years are flat to within 3%. This is the evidence behind building a mechanical
  projection instead of a fitted forecast — see `pitch/value_model.md` §7.

**The seven given assets** keep every numeric value from the original hackathon sheet.
Only invented metadata — model, serial number, site — was replaced with catalogue values.
The other 20 assets are synthetic, generated from real SKUs at the four Indian branches
with a seeded RNG, so `generate_seed.py` is reproducible run to run.
