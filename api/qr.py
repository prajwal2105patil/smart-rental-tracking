"""
One QR tag per asset into qr/. Print them before the demo.

    python qr.py

A judge holding a printed tag scans it with the phone view and the status flips on the
main screen. Ten lines of code; it scores on UX, on innovation, and on being remembered.
"""
from __future__ import annotations
import json
import pathlib

import qrcode

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "qr"
DATA = HERE.parent / "data"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    assets = json.loads((DATA / "seed_assets.json").read_text(encoding="utf-8"))
    for a in assets:
        eq = a["equipment_id"]
        qrcode.make(eq).save(OUT / f"{eq}.png")
    print(f"wrote {len(assets)} tags to {OUT}")


if __name__ == "__main__":
    main()
