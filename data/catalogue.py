"""
Catalogue extraction - runs ONCE, before generate_seed.py.

Reads the 806,485-row heavy-equipment distribution dataset and boils it down to small
JSON files that everything downstream reads instead of re-parsing 160 MB.

WHAT THIS DATASET IS, STATED PLAINLY:
    It is a heavy-equipment SALES/DISTRIBUTION dataset, not a rental telematics feed,
    and it is NOT Caterpillar official data. Caterpillar is 1 of 163 brands in it
    (5.0% of rows), alongside Volvo, JCB, Bobcat and Komatsu. The generation is visibly
    uniform: exactly 12 SKUs per category, ~40.3k rows per category, ~73.3k rows every
    year for 11 years, 10 channels at ~80.5k rows each.

    We use it for what it legitimately supplies - a real product master, a real dealer
    branch network, real customers, and real cross-class price ratios - and for nothing
    else. Two of its columns are traps and are deliberately NOT used:

      1. There is no demand signal. Excavator units by month across 11 years are flat to
         ~3%. Any forecast built on it is a horizontal line.
      2. DeliveryDate - TransactionDate is ORDER->DELIVERY for a purchase (median 15 days,
         identical across all four Indian branches). It is not yard->site transit. Wiring
         it into TRANSIT_DAYS would make every machine permanently uncommittable.

    Both exclusions are argued in pitch/qa_prep.md.

    python catalogue.py
"""
from __future__ import annotations
import json
import hashlib
import pathlib

import pandas as pd

HERE = pathlib.Path(__file__).resolve().parent

# The source file lives outside the repo tree; try the known locations in order.
CSV_CANDIDATES = [
    HERE.parent.parent / "hmd_python.csv",      # E:/Caterpillar/hmd_python.csv
    HERE.parent / "hmd_python.csv",
    HERE / "hmd_python.csv",
]

# The file is UTF-8 with a BOM and dates read "Tue Jan 01, 2002". Both confirmed.
ENCODING = "utf-8-sig"
DATE_FORMAT = "%a %b %d, %Y"

# ---- rental type -> catalogue category ---------------------------------------
# The catalogue has 21 categories; our rental fleet has 4 types. Three map exactly.
# GRADER DOES NOT EXIST in the source. A motor grader is a road-building machine, so
# RoadPavers is the closest honest match - but note it prices ABOVE an excavator, which
# is why the price-implied rate is a CROSS-CHECK column and not the default rate card.
TYPE_TO_CATEGORY = {
    "Excavator": "Excavators",
    "Bulldozer": "Bulldozers",
    "Crane":     "Cranes",
    "Grader":    "RoadPavers",
}

# Anchor for the price-implied rate. The published card says an Excavator rents at
# INR 15,000/day; every other rate is that anchor scaled by the REAL median SKU price
# ratio, so the ratios come from 806,485 transactions and only one number is asserted.
ANCHOR_TYPE = "Excavator"
ANCHOR_DAY_RATE_INR = 15000

# Industries that actually operate heavy plant - used to pick booking customers.
OPERATOR_INDUSTRIES = [
    "Construction Contractor", "Construction", "Mining", "Oil&Gas",
    "Railway Contractor", "Conglomerate",
]

INDIA_COUNTRY = "India"


MANIFEST = HERE / "source_manifest.json"


def _manifest() -> dict:
    """The fingerprint of the file every committed number was derived from."""
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}


def _find_csv() -> pathlib.Path:
    """Locate the source CSV, or explain precisely why it is not here.

    The file is 153 MB, past GitHub's 100 MB hard limit, so it is deliberately
    outside the repository and always will be. That is not a broken checkout, and
    the message has to say so - "file not found" reads like a bug and sends
    somebody hunting for a mistake nobody made.
    """
    for p in CSV_CANDIDATES:
        if p.exists():
            return p

    m = _manifest()
    lines = [
        "",
        "hmd_python.csv is not in this checkout, and it never is.",
        "  " + m.get("why_not_in_the_repo", "It exceeds GitHub's file-size limit."),
        "",
        "NOTHING NEEDS IT TO RUN. What it produces is already committed:",
        "  " + ", ".join(m.get("derived_artifacts", ["catalogue_*.json"])) + ", seed_*.json",
        "  Start the API and the whole system works from those.",
        "",
        "You only need it to REGENERATE them. Ask a teammate for the file, then",
        "put it at one of:",
    ]
    lines += ["  " + str(p) for p in CSV_CANDIDATES]
    if m.get("sha256"):
        lines += [
            "",
            "Check you were handed the right one:",
            "  sha256   " + m["sha256"],
            "  size     {:,} bytes".format(m["size_bytes"]),
            "  contents {:,} rows x {} columns".format(m["rows"], len(m["columns"])),
        ]
    raise SystemExit("\n".join(lines) + "\n")


def _verify(csv_path: pathlib.Path) -> None:
    """Confirm the CSV in hand is the one the committed numbers came from.

    A differently-sourced copy of a public BI dataset would regenerate the seeds
    silently, and quietly invalidate the test suite, the ledger and the pitch. One
    hash up front is cheaper than learning that from a failing assertion on the
    morning of the demo.
    """
    m = _manifest()
    expected = m.get("sha256")
    if not expected:
        print("  no source_manifest.json - skipping the integrity check")
        return

    size = csv_path.stat().st_size
    if size != m.get("size_bytes"):
        print("  WARNING size is {:,} bytes, manifest says {:,}".format(
            size, m.get("size_bytes", 0)))

    h = hashlib.sha256()
    with csv_path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)

    if h.hexdigest() == expected:
        print("  sha256 matches the manifest - {:,} rows, {} SKUs, {} branches".format(
            m["rows"], m["distinct_product_keys"], m["distinct_stores"]))
    else:
        print("  WARNING sha256 does NOT match source_manifest.json.")
        print("    expected " + expected)
        print("    got      " + h.hexdigest())
        print("    Regenerating from this file will change the committed seeds and")
        print("    can break the test suite. Confirm you have the right CSV first.")


def _write(name: str, payload) -> None:
    path = HERE / name
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    n = len(payload) if isinstance(payload, list) else len(payload)
    print(f"  wrote {name:28} {n:>5} top-level records")


def main() -> None:
    csv_path = _find_csv()
    print(f"reading {csv_path} ...")
    _verify(csv_path)
    df = pd.read_csv(csv_path, encoding=ENCODING)
    df["TransactionDate"] = pd.to_datetime(df["TransactionDate"], format=DATE_FORMAT)
    df["DeliveryDate"] = pd.to_datetime(df["DeliveryDate"], format=DATE_FORMAT)
    df["Category"] = df["ProductDescription"].str.split("-").str[0]
    print(f"  {len(df):,} rows x {df.shape[1]} columns, "
          f"{df['TransactionDate'].min().date()} -> {df['TransactionDate'].max().date()}")

    # ---- 1. SKU master ------------------------------------------------------
    # Price and Cost are FIXED per ProductKey (verified: nunique() == 1 for both),
    # so dropping duplicates is lossless - a genuine product master, not a sample.
    max_prices = df.groupby("ProductKey")["Price"].nunique().max()
    max_costs = df.groupby("ProductKey")["Cost"].nunique().max()
    assert max_prices == 1 and max_costs == 1, (
        f"price/cost not fixed per SKU (price={max_prices}, cost={max_costs}) - "
        "the SKU master would be lossy; investigate before trusting derived rates"
    )

    sku_df = (
        df.drop_duplicates("ProductKey")
          .sort_values("ProductKey")
          [["ProductKey", "ProductDescription", "Category", "Brand",
            "Type", "Color", "Cost", "Price"]]
    )
    skus = [{
        "product_key": r.ProductKey,
        "description": r.ProductDescription,
        "category": r.Category,
        "brand": r.Brand,
        "duty_type": r.Type,
        "color": r.Color,
        "cost": int(r.Cost),
        "price": int(r.Price),
    } for r in sku_df.itertuples()]

    # ---- 2. Branch network --------------------------------------------------
    # StoreID <-> CityName is 1:1 and City -> Country is 1:1 (both verified), so a
    # store IS a city. 83 branches across 36 countries; four of them are in India.
    assert df.groupby("StoreID")["CityName"].nunique().max() == 1
    assert df.groupby("CityName")["CountryName"].nunique().max() == 1

    branch_df = (
        df.groupby(["StoreID", "CityName", "CountryName"])
          .size().reset_index(name="rows")
          .sort_values(["CountryName", "StoreID"])
    )
    branches = [{
        "store_id": r.StoreID,
        "city": r.CityName,
        "country": r.CountryName,
        "invoice_rows": int(r.rows),
        "is_india": r.CountryName == INDIA_COUNTRY,
    } for r in branch_df.itertuples()]

    # ---- 3. Customers -------------------------------------------------------
    cust_df = (
        df[df["Industry"].isin(OPERATOR_INDUSTRIES)]
          .groupby(["CustomerName", "Industry"])
          .size().reset_index(name="rows")
          .sort_values("rows", ascending=False)
    )
    customers = [{
        "name": r.CustomerName,
        "industry": r.Industry,
        "invoice_rows": int(r.rows),
    } for r in cust_df.itertuples()]

    # ---- 4. Price-implied day rates ----------------------------------------
    med = sku_df.groupby("Category")["Price"].median()
    anchor_price = float(med[TYPE_TO_CATEGORY[ANCHOR_TYPE]])
    k = ANCHOR_DAY_RATE_INR / anchor_price

    rates = {}
    for rental_type, category in TYPE_TO_CATEGORY.items():
        raw = float(med[category]) * k
        rates[rental_type] = {
            "category": category,
            "median_sku_price": float(med[category]),
            "day_rate_inr": int(round(raw / 500) * 500),   # to the nearest 500
            "exact": round(raw, 2),
            "sku_count": int((sku_df["Category"] == category).sum()),
        }
    rate_payload = {
        "basis": "price_implied",
        "anchor_type": ANCHOR_TYPE,
        "anchor_day_rate_inr": ANCHOR_DAY_RATE_INR,
        "anchor_median_price": anchor_price,
        "scale_factor_k": round(k, 6),
        "formula": ("day_rate = median(category SKU list price) * k, "
                    f"k = {ANCHOR_DAY_RATE_INR} / {anchor_price:.0f}"),
        "caveat": ("Grader has no category in the source; mapped to RoadPavers, which "
                   "prices above an excavator. This is why price_implied is a cross-check "
                   "column and not the default rate card."),
        "rates": rates,
    }

    # ---- 5. Real defects in the source --------------------------------------
    # Not decoration. R4 is a cross-field contradiction rule; these are contradictions
    # in data we did not author, which is the strongest demonstration of it available.
    neg_margin = df[df["Price"] <= df["Cost"]]
    dup_invoices = df[df["Invoice"].duplicated(keep=False)]
    # A "stray year" is one carrying a negligible number of rows next to a normal year
    # (~73,300). 2013 holds 2 rows, which is a truncated export, not a real trading year.
    per_year = df["TransactionDate"].dt.year.value_counts()
    stray_year_labels = per_year[per_year < per_year.median() * 0.01].index
    stray_years = df[df["TransactionDate"].dt.year.isin(stray_year_labels)]

    defects = {
        "negative_margin": [{
            "invoice": r.Invoice,
            "product": r.ProductDescription,
            "cost": int(r.Cost),
            "price": int(r.Price),
            "margin": int(r.Price - r.Cost),
            "city": r.CityName,
        } for r in neg_margin.itertuples()],
        "duplicate_invoice_ids": int(df["Invoice"].duplicated().sum()),
        "duplicate_invoice_examples": sorted(dup_invoices["Invoice"].unique().tolist())[:10],
        "stray_year_rows": [{
            "invoice": r.Invoice,
            "date": r.TransactionDate.date().isoformat(),
            "product": r.ProductDescription,
        } for r in stray_years.itertuples()],
        "note": ("Found by cross-field validation over the source catalogue. Price < Cost "
                 "cannot be true for a sold unit; this is the same class of contradiction "
                 "as rule R4 (operating_days > rental window)."),
    }

    print("writing catalogue ...")
    _write("catalogue_skus.json", skus)
    _write("catalogue_branches.json", branches)
    _write("catalogue_customers.json", customers)
    _write("catalogue_rates.json", rate_payload)
    _write("catalogue_defects.json", defects)

    india = [b for b in branches if b["is_india"]]
    countries = len({b["country"] for b in branches})
    print(f"\n{len(skus)} SKUs | {len(branches)} branches in {countries} countries "
          f"| {len(customers)} operator customers")
    print("India branches: "
          + ", ".join(b["store_id"] + " " + b["city"] for b in india))
    print(f"scale factor k = {k:.4f}  (anchor: {ANCHOR_TYPE} @ INR {ANCHOR_DAY_RATE_INR}/day)")
    for t, r in rates.items():
        print(f"  {t:10} -> {r['category']:12} median {r['median_sku_price']:>8.0f}"
              f"   price-implied INR {r['day_rate_inr']:>6,}/day")
    print(f"defects: {len(defects['negative_margin'])} negative-margin rows, "
          f"{defects['duplicate_invoice_ids']} duplicate invoice ids, "
          f"{len(defects['stray_year_rows'])} stray-year rows")


if __name__ == "__main__":
    main()
