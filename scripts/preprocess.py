#!/usr/bin/env python3
"""
Preprocess parquet trajectory data into JSON for the flu dashboard.
Reads from data/processed/ and writes to dashboard/data/.

Outputs:
  - dashboard_data.json: trend/activity probabilities per location/horizon/refdate
  - locations.json: location metadata
  - target_data.json: historical observed data for all locations
  - historical_seasons.json: aligned seasonal curves for context overlay
  - trajectories/{fips}.json: per-location sampled trajectories with trend tags
"""

import pandas as pd
import numpy as np
import json
import os
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "processed"
TRAJ_DIR = DATA_DIR / "trajectories"
OUT_DIR = BASE_DIR / "dashboard" / "data"

# --- Trend thresholds (rate per 100k) by horizon ---
TREND_THRESHOLDS = {
    0: {"stable": 0.3, "large": 1.7},
    1: {"stable": 0.5, "large": 3.0},
    2: {"stable": 0.7, "large": 4.0},
    3: {"stable": 1.0, "large": 5.0},
    4: {"stable": 1.0, "large": 5.0},
}
COUNT_STABLE_THRESHOLD = 10

# --- Category orderings ---
TREND_ORDER = ["large_decrease", "decrease", "stable", "increase", "large_increase"]
ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"]  # 4 categories (minimal merged into low)

SAMPLE_TRAJECTORIES = 200  # number of trajectories to export per ref date


def classify_trend(rate_change, count_change, horizon):
    """Classify a single trajectory run into a trend category."""
    h = min(horizon, 4)
    t = TREND_THRESHOLDS[h]
    if abs(rate_change) < t["stable"] or abs(count_change) < COUNT_STABLE_THRESHOLD:
        return "stable"
    elif rate_change >= t["large"]:
        return "large_increase"
    elif rate_change > 0:
        return "increase"
    elif rate_change <= -t["large"]:
        return "large_decrease"
    else:
        return "decrease"


def classify_activity(forecast_rate, p25_rate, p50_rate, p75_rate):
    """Classify a single trajectory run into an activity category (4 levels)."""
    if forecast_rate <= p25_rate:
        return "low"
    elif forecast_rate <= p50_rate:
        return "moderate"
    elif forecast_rate <= p75_rate:
        return "high"
    else:
        return "very_high"


def get_percentile_category(probs, order, percentile):
    """Walk the CDF and return the category at the given percentile."""
    cumulative = 0.0
    for cat in order:
        cumulative += probs.get(cat, 0.0)
        if cumulative >= percentile:
            return cat
    return order[-1]


def compute_probs(categories, order):
    """Compute probability distribution from a list of category assignments."""
    total = len(categories)
    if total == 0:
        return {cat: 0.0 for cat in order}
    counts = pd.Series(categories).value_counts()
    return {cat: float(counts.get(cat, 0)) / total for cat in order}


def export_target_data(target_data):
    """Export historical observed data as JSON grouped by location."""
    print("\nExporting target_data.json...")
    result = {}
    for loc, group in target_data.groupby("location"):
        if loc == "72":
            continue
        records = []
        for _, row in group.sort_values("date").iterrows():
            records.append({
                "date": row["date"],
                "value": round(float(row["value"]), 1) if pd.notna(row["value"]) else None,
                "rate": round(float(row["weekly_rate"]), 4) if pd.notna(row["weekly_rate"]) else None,
            })
        result[loc] = records
    with open(OUT_DIR / "target_data.json", "w") as f:
        json.dump(result, f)
    print(f"  Wrote target_data.json ({len(result)} locations)")


def export_historical_seasons(target_data):
    """Export historical season curves aligned by week offset from Oct 1."""
    print("\nExporting historical_seasons.json...")
    seasons = {
        "2022-23": ("2022-10-01", "2023-09-30"),
        "2023-24": ("2023-10-01", "2024-09-30"),
        "2024-25": ("2024-10-01", "2025-09-30"),
    }

    result = {}
    for loc, group in target_data.groupby("location"):
        if loc == "72":
            continue
        loc_seasons = {}
        for season_name, (start, end) in seasons.items():
            mask = (group["date"] >= start) & (group["date"] <= end)
            season_data = group[mask].sort_values("date")
            if len(season_data) == 0:
                continue
            start_dt = datetime.strptime(start, "%Y-%m-%d")
            records = []
            for idx, (_, row) in enumerate(season_data.iterrows()):
                records.append({
                    "week": idx,
                    "date": row["date"],
                    "value": round(float(row["value"]), 1) if pd.notna(row["value"]) else None,
                    "rate": round(float(row["weekly_rate"]), 4) if pd.notna(row["weekly_rate"]) else None,
                })
            loc_seasons[season_name] = records
        result[loc] = loc_seasons

    with open(OUT_DIR / "historical_seasons.json", "w") as f:
        json.dump(result, f)
    print(f"  Wrote historical_seasons.json ({len(result)} locations)")


def export_trajectories(ref_dates, loc_pop, target_lookup, thresh_by_fips, loc_name):
    """Export sampled trajectories with trend tags per location."""
    print("\nExporting per-location trajectory files...")
    traj_out_dir = OUT_DIR / "trajectories"
    os.makedirs(traj_out_dir, exist_ok=True)

    # Collect all FIPS codes across all ref dates
    all_fips = set()
    for ref_date in ref_dates:
        ref_dir = TRAJ_DIR / f"ref_{ref_date}"
        for loc_file in os.listdir(ref_dir):
            if loc_file.startswith("loc_") and loc_file.endswith(".parquet"):
                traj = pd.read_parquet(ref_dir / loc_file, columns=["fips"])
                fips = str(traj["fips"].iloc[0])
                if hasattr(fips, "item"):
                    fips = fips.item()
                all_fips.add(str(fips))

    for fips in sorted(all_fips):
        if fips == "72":
            continue
        population = loc_pop.get(fips)
        if not population:
            continue

        loc_result = {"reference_dates": ref_dates, "data": {}}

        for ref_date in ref_dates:
            ref_dir = TRAJ_DIR / f"ref_{ref_date}"
            ref_dt = datetime.strptime(ref_date, "%Y-%m-%d")
            baseline_date = (ref_dt - timedelta(days=7)).strftime("%Y-%m-%d")

            baseline_info = target_lookup.get((fips, baseline_date))
            baseline_rate = baseline_info["weekly_rate"] if baseline_info else 0.0
            baseline_value = baseline_info["value"] if baseline_info else 0.0

            # Find the right loc file for this FIPS
            loc_file = None
            for f in os.listdir(ref_dir):
                if f.startswith("loc_") and f.endswith(".parquet"):
                    test_traj = pd.read_parquet(ref_dir / f, columns=["fips"])
                    test_fips = str(test_traj["fips"].iloc[0])
                    if hasattr(test_fips, "item"):
                        test_fips = test_fips.item()
                    if str(test_fips) == fips:
                        loc_file = f
                        break

            if loc_file is None:
                continue

            traj = pd.read_parquet(ref_dir / loc_file)

            # Get unique dates per horizon
            dates_by_horizon = {}
            for _, row in traj[traj["run_id"] == traj["run_id"].iloc[0]].sort_values("horizon").iterrows():
                dates_by_horizon[int(row["horizon"])] = row["date"]

            all_dates = [dates_by_horizon.get(h, "") for h in range(max(dates_by_horizon.keys()) + 1)]

            # Sample trajectories
            all_run_ids = sorted(traj["run_id"].unique())
            np.random.seed(42)
            sample_ids = sorted(np.random.choice(all_run_ids, size=min(SAMPLE_TRAJECTORIES, len(all_run_ids)), replace=False))

            trajectories = []
            for run_id in sample_ids:
                run_data = traj[traj["run_id"] == run_id].sort_values("horizon")
                values = run_data["value"].tolist()

                # Classify trend at each horizon
                trend_tags = {}
                for _, row in run_data.iterrows():
                    h = int(row["horizon"])
                    if h > 4:
                        continue
                    forecast_rate = row["value"] / population * 100000
                    rate_change = forecast_rate - baseline_rate
                    count_change = row["value"] - baseline_value
                    trend_tags[f"h{h}"] = classify_trend(rate_change, count_change, h)

                trajectories.append({
                    "run_id": int(run_id),
                    "values": [round(float(v), 1) for v in values],
                    "trends": trend_tags,
                })

            loc_result["data"][ref_date] = {
                "dates": all_dates,
                "trajectories": trajectories,
            }

        with open(traj_out_dir / f"{fips}.json", "w") as f:
            json.dump(loc_result, f)

    print(f"  Wrote trajectory files for {len(all_fips)} locations")


def main():
    print("Loading data files...")
    locations = pd.read_parquet(DATA_DIR / "locations.parquet")
    target_data = pd.read_parquet(DATA_DIR / "target_data.parquet")
    hist_thresh = pd.read_parquet(DATA_DIR / "historical_thresholds.parquet")

    # Build lookup dictionaries
    loc_pop = dict(zip(locations["location"], locations["population"]))
    loc_abbrev = dict(zip(locations["location"], locations["abbreviation"]))
    loc_name = dict(zip(locations["location"], locations["location_name"]))

    # Historical thresholds by FIPS
    thresh_by_fips = {}
    for _, row in hist_thresh.iterrows():
        thresh_by_fips[row["location"]] = {
            "p25_rate": row["p25_rate"],
            "p50_rate": row["p50_rate"],
            "p75_rate": row["p75_rate"],
        }

    # Target data lookup: (location, date) -> (value, weekly_rate)
    target_lookup = {}
    for _, row in target_data.iterrows():
        target_lookup[(row["location"], row["date"])] = {
            "value": row["value"],
            "weekly_rate": row["weekly_rate"],
        }

    # Find all reference date directories
    ref_dirs = sorted([
        d for d in os.listdir(TRAJ_DIR)
        if d.startswith("ref_") and (TRAJ_DIR / d).is_dir()
    ])
    ref_dates = [d.replace("ref_", "") for d in ref_dirs]
    most_recent = ref_dates[-1]

    print(f"Found {len(ref_dates)} reference dates: {ref_dates}")
    print(f"Most recent: {most_recent}")

    # --- 1. Dashboard data (probabilities) ---
    output = {
        "most_recent_reference_date": most_recent,
        "reference_dates": ref_dates,
        "trend_categories": TREND_ORDER,
        "activity_categories": ACTIVITY_ORDER,
        "data": {},
    }

    for ref_date in ref_dates:
        print(f"\nProcessing reference date: {ref_date}")
        ref_dir = TRAJ_DIR / f"ref_{ref_date}"
        ref_dt = datetime.strptime(ref_date, "%Y-%m-%d")
        baseline_date = (ref_dt - timedelta(days=7)).strftime("%Y-%m-%d")

        ref_data = {}
        loc_files = sorted([
            f for f in os.listdir(ref_dir)
            if f.startswith("loc_") and f.endswith(".parquet")
        ])

        for loc_file in loc_files:
            traj = pd.read_parquet(ref_dir / loc_file)
            fips = traj["fips"].iloc[0]
            if hasattr(fips, "item"):
                fips = fips.item()
            fips = str(fips)

            population = loc_pop.get(fips)
            if population is None or population == 0:
                continue

            baseline_info = target_lookup.get((fips, baseline_date))
            if baseline_info is None:
                baseline_rate = 0.0
                baseline_value = 0.0
            else:
                baseline_rate = baseline_info["weekly_rate"]
                baseline_value = baseline_info["value"]

            thresh = thresh_by_fips.get(fips, {
                "p25_rate": 0.5, "p50_rate": 1.0, "p75_rate": 2.0
            })

            loc_data = {}
            for horizon in range(5):
                h_traj = traj[traj["horizon"] == horizon]
                if len(h_traj) == 0:
                    continue

                trend_cats = []
                activity_cats = []

                for _, run in h_traj.iterrows():
                    forecast_value = run["value"]
                    forecast_rate = forecast_value / population * 100000
                    rate_change = forecast_rate - baseline_rate
                    count_change = forecast_value - baseline_value

                    trend_cats.append(
                        classify_trend(rate_change, count_change, horizon)
                    )
                    activity_cats.append(
                        classify_activity(
                            forecast_rate,
                            thresh["p25_rate"],
                            thresh["p50_rate"],
                            thresh["p75_rate"],
                        )
                    )

                trend_probs = compute_probs(trend_cats, TREND_ORDER)
                activity_probs = compute_probs(activity_cats, ACTIVITY_ORDER)

                trend_most_likely = max(trend_probs, key=trend_probs.get)
                activity_most_likely = max(activity_probs, key=activity_probs.get)

                forecast_dt = ref_dt + timedelta(days=horizon * 7)
                forecast_date = forecast_dt.strftime("%Y-%m-%d")

                median_value = float(h_traj["value"].median())
                median_rate = median_value / population * 100000

                loc_data[str(horizon)] = {
                    "trend_probs": {k: round(v, 4) for k, v in trend_probs.items()},
                    "activity_probs": {k: round(v, 4) for k, v in activity_probs.items()},
                    "trend_most_likely": trend_most_likely,
                    "trend_lower": get_percentile_category(trend_probs, TREND_ORDER, 0.10),
                    "trend_upper": get_percentile_category(trend_probs, TREND_ORDER, 0.90),
                    "activity_most_likely": activity_most_likely,
                    "activity_lower": get_percentile_category(activity_probs, ACTIVITY_ORDER, 0.10),
                    "activity_upper": get_percentile_category(activity_probs, ACTIVITY_ORDER, 0.90),
                    "forecast_date": forecast_date,
                    "median_value": round(median_value, 1),
                    "median_rate": round(median_rate, 2),
                }

            if loc_data:
                ref_data[fips] = loc_data
                print(f"  {fips} ({loc_name.get(fips, '?')}): {len(loc_data)} horizons")

        output["data"][ref_date] = ref_data

    # Write locations.json
    os.makedirs(OUT_DIR, exist_ok=True)
    locations_out = []
    for _, row in locations.iterrows():
        fips = row["location"]
        if fips == "72":
            continue
        locations_out.append({
            "fips": fips,
            "abbreviation": row["abbreviation"],
            "name": row["location_name"],
            "population": int(row["population"]),
        })

    with open(OUT_DIR / "locations.json", "w") as f:
        json.dump(locations_out, f)
    print(f"\nWrote {OUT_DIR / 'locations.json'} ({len(locations_out)} locations)")

    # Write dashboard_data.json
    with open(OUT_DIR / "dashboard_data.json", "w") as f:
        json.dump(output, f)
    print(f"Wrote {OUT_DIR / 'dashboard_data.json'}")

    # Validate
    latest = output["data"][most_recent]
    print(f"\nValidation for {most_recent}:")
    print(f"  Locations with data: {len(latest)}")
    if "US" in latest:
        us_h0 = latest["US"]["0"]
        print(f"  US H0 trend: {us_h0['trend_probs']}")
        print(f"  US H0 activity: {us_h0['activity_probs']}")

    # --- 2. Target data ---
    export_target_data(target_data)

    # --- 3. Historical seasons ---
    export_historical_seasons(target_data)

    # --- 4. Per-location trajectories ---
    export_trajectories(ref_dates, loc_pop, target_lookup, thresh_by_fips, loc_name)

    print("\nDone!")


if __name__ == "__main__":
    main()
