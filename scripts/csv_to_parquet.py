#!/usr/bin/env python3
"""
Convert raw trajectory files (CSV or parquet) into per-location parquet files
in data/processed/trajectories/ for use by preprocess.py.

Each entry in SOURCES is one raw folder and its file format:
  - 2025-26 retrospective (epystrain_trajectories_*): value in target_baseline_k5
  - 2026-27 real-time (long_form_trajectories_*): value in `value`, one row per
    `series`; only the "total" series is kept

Transforms raw columns (sample_id, location, ...) into the processed schema
(location_id, run_id, location_name_epydemix, value, fips, ...). States listed
for a reference date in data/exclusions.json are dropped from that forecast.
"""

import json
import pandas as pd
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "data" / "processed" / "trajectories"
LOCATIONS_FILE = BASE_DIR / "data" / "processed" / "locations.parquet"
EXCLUSIONS_FILE = BASE_DIR / "data" / "exclusions.json"

SOURCES = [
    {"dir": BASE_DIR / "raw" / "retro20260615_trajectories",
     "patterns": ["epystrain_trajectories_*.csv", "epystrain_trajectories_*.parquet"],
     "value": "target_baseline_k5"},
    {"dir": BASE_DIR / "raw" / "2026-27",
     "patterns": ["long_form_trajectories_*.parquet"],
     "value": "value", "series": "total"},
]


def load_exclusions():
    """{reference_date: set of location names} from data/exclusions.json."""
    if not EXCLUSIONS_FILE.exists():
        return {}
    with open(EXCLUSIONS_FILE) as f:
        raw = json.load(f)
    return {k: set(v) for k, v in raw.items() if not k.startswith("_")}


def epydemix_name(name):
    """Location name as written in the raw files ("New York" -> "United_States__New_York")."""
    return "United_States" if name == "US" else "United_States__" + name.replace(" ", "_")


def build_location_mapping(locations_df):
    """Build mapping from epydemix location name -> (location_id, fips)."""
    mapping = {}
    for idx, (_, row) in enumerate(locations_df.iterrows()):
        mapping[epydemix_name(row["location_name"])] = {"location_id": idx, "fips": row["location"]}
    return mapping


def process_file(filepath, loc_map, source, exclusions):
    """Read a CSV or parquet file and split into per-location parquet files."""
    print(f"\nProcessing {filepath.name}...")
    if filepath.suffix == ".parquet":
        df = pd.read_parquet(filepath)
    else:
        df = pd.read_csv(filepath)

    if "series" in source:
        keep = df["series"] == source["series"]
        # The series are expected to agree for a single-strain run; say so if not.
        others = df[~keep]
        if len(others) and len(others) == keep.sum():
            a = df.loc[keep, source["value"]].reset_index(drop=True)
            b = others[source["value"]].reset_index(drop=True)
            if not a.equals(b):
                print(f"  Note: series differ; using '{source['series']}'")
        df = df[keep]

    # Normalize date columns to string YYYY-MM-DD
    df["reference_date"] = pd.to_datetime(df["reference_date"]).dt.strftime("%Y-%m-%d")
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    ref_dates = sorted(df["reference_date"].unique())
    print(f"  Reference dates: {ref_dates}")

    for ref_date in ref_dates:
        ref_df = df[df["reference_date"] == ref_date]
        ref_dir = OUT_DIR / f"ref_{ref_date}"
        os.makedirs(ref_dir, exist_ok=True)
        excluded = {epydemix_name(n) for n in exclusions.get(ref_date, ())}
        if excluded:
            print(f"  Excluding: {', '.join(sorted(exclusions[ref_date]))}")

        for location, loc_df in ref_df.groupby("location"):
            if location in excluded:
                continue
            if location not in loc_map:
                print(f"  Warning: unknown location '{location}', skipping")
                continue

            loc_info = loc_map[location]
            loc_id = loc_info["location_id"]
            fips = loc_info["fips"]

            out_df = pd.DataFrame({
                "location_id": loc_id,
                "run_id": loc_df["sample_id"].values,
                "location_name_epydemix": location,
                "date": loc_df["date"].values,
                "value": loc_df[source["value"]].values,
                "epiweek": loc_df["epiweek"].values,
                "reference_date": loc_df["reference_date"].values,
                "horizon": loc_df["horizon"].values,
                "fips": fips,
            })

            out_df["location_id"] = out_df["location_id"].astype("int64")
            out_df["run_id"] = out_df["run_id"].astype("int64")
            out_df["value"] = out_df["value"].astype("float64")
            out_df["epiweek"] = out_df["epiweek"].astype("int64")
            out_df["horizon"] = out_df["horizon"].astype("int64")

            out_path = ref_dir / f"loc_{loc_id:02d}.parquet"
            out_df.to_parquet(out_path, index=False)

        n_files = len(list(ref_dir.glob("loc_*.parquet")))
        print(f"  ref_{ref_date}: wrote {n_files} location files")


def main():
    locations = pd.read_parquet(LOCATIONS_FILE)
    loc_map = build_location_mapping(locations)
    exclusions = load_exclusions()
    known = set(locations["location_name"])
    for ref_date, names in exclusions.items():
        unknown = names - known
        if unknown:
            raise SystemExit(f"exclusions.json {ref_date}: unknown locations {sorted(unknown)}")

    inputs = [(f, src) for src in SOURCES
              for f in sorted(p for pat in src["patterns"] for p in src["dir"].glob(pat))]
    print(f"Found {len(inputs)} input files")

    # Clear existing ref_* directories
    if OUT_DIR.exists():
        for d in OUT_DIR.iterdir():
            if d.is_dir() and d.name.startswith("ref_"):
                shutil.rmtree(d)
                print(f"  Removed old {d.name}")

    for f, src in inputs:
        process_file(f, loc_map, src, exclusions)

    print("\nDone! Now run: python scripts/preprocess.py")


if __name__ == "__main__":
    main()
