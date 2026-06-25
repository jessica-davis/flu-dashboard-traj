"""Update data/processed/target_data.parquet from a raw flu hospitalization CSV.

Upsert semantics: rows from the new CSV win on any (date, location) they cover;
all other existing rows (older history, locations absent from the new file) are kept.

Raw CSV columns expected: location_iso, location_code, target_end_date, epiweek, hospitalizations
Target columns produced:  date, location, location_name, value, weekly_rate

weekly_rate = value / population * 100000  (population from locations.parquet)

Usage:
    python scripts/update_target_data.py raw/flu_hosp_25_202621_prelim.csv
"""
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "data" / "processed"
TARGET = DATA / "target_data.parquet"
LOCATIONS = DATA / "locations.parquet"


def main(csv_path: str) -> None:
    csv_path = Path(csv_path)
    print(f"Reading new surveillance: {csv_path}")
    new = pd.read_csv(csv_path, dtype={"location_code": str})
    new = new.rename(
        columns={
            "target_end_date": "date",
            "location_code": "location",
            "hospitalizations": "value",
        }
    )[["date", "location", "value"]]
    new["date"] = pd.to_datetime(new["date"]).dt.strftime("%Y-%m-%d")

    loc = pd.read_parquet(LOCATIONS)[["location", "location_name", "population"]]
    missing = set(new["location"]) - set(loc["location"])
    if missing:
        raise SystemExit(f"Location codes not found in locations.parquet: {sorted(missing)}")

    new = new.merge(loc, on="location", how="left")
    new["weekly_rate"] = new["value"] / new["population"] * 100000
    new = new[["date", "location", "location_name", "value", "weekly_rate"]]

    old = pd.read_parquet(TARGET)

    combined = pd.concat([old, new], ignore_index=True)
    before = len(combined)
    # keep last => new file wins on duplicate (date, location)
    combined = combined.drop_duplicates(subset=["date", "location"], keep="last")
    combined = combined.sort_values(["date", "location"]).reset_index(drop=True)

    print(f"  old rows:      {len(old)} (dates {old['date'].min()} -> {old['date'].max()})")
    print(f"  new rows:      {len(new)} (dates {new['date'].min()} -> {new['date'].max()})")
    print(f"  overlap upsert:{before - len(combined)} rows replaced")
    print(f"  final rows:    {len(combined)} (dates {combined['date'].min()} -> {combined['date'].max()})")

    combined.to_parquet(TARGET, index=False)
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/update_target_data.py <raw_csv_path>")
    main(sys.argv[1])
