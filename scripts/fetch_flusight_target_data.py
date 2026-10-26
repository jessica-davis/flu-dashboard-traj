#!/usr/bin/env python3
"""
Build observed hospital admissions from the FluSight-forecast-hub time series.

Reads target-data/time-series.csv from the cdcepi FluSight hub (the
`upstream` remote of a local clone, read with `git show` so the clone's
working tree is never touched) and writes:

  data/processed/target_data.parquet     final series: latest as_of per week
  data/processed/target_vintages.parquet every as_of snapshot ("data as reported")

Usage:
  python scripts/fetch_flusight_target_data.py               # fetch upstream, then read it
  python scripts/fetch_flusight_target_data.py --no-fetch    # read upstream/main as already fetched
  python scripts/fetch_flusight_target_data.py --hub PATH --ref upstream/main
"""

import argparse
import io
import subprocess
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "data" / "processed"
DEFAULT_HUB = BASE_DIR.parent / "FluSight-forecast-hub"
TIME_SERIES = "target-data/time-series.csv"
TARGET = "wk inc flu hosp"


def read_time_series(hub, ref, fetch):
    if fetch:
        remote = ref.split("/")[0]
        print(f"Fetching {remote} in {hub}...")
        subprocess.run(["git", "-C", str(hub), "fetch", remote], check=True)
    print(f"Reading {ref}:{TIME_SERIES}...")
    raw = subprocess.run(["git", "-C", str(hub), "show", f"{ref}:{TIME_SERIES}"],
                         check=True, capture_output=True).stdout
    df = pd.read_csv(io.BytesIO(raw), dtype={"location": str})
    df = df[(df["target"] == TARGET) & (df["location"] != "72")]
    return df.rename(columns={"target_end_date": "date", "observation": "value"})[
        ["as_of", "location", "date", "value", "weekly_rate"]]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hub", default=str(DEFAULT_HUB), help="path to a FluSight-forecast-hub clone")
    ap.add_argument("--ref", default="upstream/main", help="git ref to read (default upstream/main)")
    ap.add_argument("--no-fetch", action="store_true", help="skip `git fetch`")
    args = ap.parse_args()

    df = read_time_series(Path(args.hub), args.ref, not args.no_fetch)
    as_ofs = sorted(df["as_of"].unique())
    print(f"  {len(as_ofs)} snapshots, {as_ofs[0]} .. {as_ofs[-1]}")

    final = (df.sort_values("as_of")
               .drop_duplicates(["location", "date"], keep="last")
               .drop(columns="as_of")
               .sort_values(["location", "date"])
               .reset_index(drop=True))
    final.to_parquet(OUT_DIR / "target_data.parquet", index=False)
    print(f"Wrote target_data.parquet: {len(final)} rows, through {final['date'].max()}")

    df.sort_values(["as_of", "location", "date"]).reset_index(drop=True) \
      .to_parquet(OUT_DIR / "target_vintages.parquet", index=False)
    print(f"Wrote target_vintages.parquet: {len(df)} rows")


if __name__ == "__main__":
    main()
