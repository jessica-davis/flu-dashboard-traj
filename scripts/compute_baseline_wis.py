"""Download FluSight-Baseline forecasts and compute WIS directly from quantiles
for comparison with our model. Mirrors compute_baseline_scores.py but for WIS."""

import numpy as np
import pandas as pd
import time
from pathlib import Path

HORIZONS = [0, 1, 2, 3]
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"
SCORES_DIR = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "scores"
CODEBOOK = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"

# Quantile levels matching the model's WIS computation
QUANTILES = [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
             0.55, 0.60, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99]


def compute_wis_from_quantiles(q_levels, q_matrix, y):
    """Compute WIS from quantile forecasts and observations.

    q_levels: array of quantile levels (e.g. 23 levels)
    q_matrix: (n_quantiles, n_horizons) quantile values
    y: (n_horizons,) observations

    Uses the same formula as the scoring notebook:
    WIS = mean over horizons of [ sum of alpha/2 * IS for each symmetric pair
          + 0.5 * |median - y| ] / (K/2 + 0.5)
    """
    n_quantiles = len(q_levels)
    n_horizons = len(y)
    K = n_quantiles // 2

    wis_per_horizon = np.zeros(n_horizons)

    for i in range(K):
        lower = q_matrix[i]        # lower quantile values
        upper = q_matrix[-i - 1]   # upper quantile values
        alpha = 1 - (q_levels[-i - 1] - q_levels[i])
        interval_range = 100 * (q_levels[-i - 1] - q_levels[i])

        # Interval score
        is_val = (upper - lower) + (2.0 / alpha) * np.maximum(lower - y, 0) + \
                 (2.0 / alpha) * np.maximum(y - upper, 0)

        wis_per_horizon += is_val * alpha / 2

    # Add median component
    median_idx = n_quantiles // 2
    wis_per_horizon += 0.5 * np.abs(q_matrix[median_idx] - y)

    # Average over horizons, normalize by number of components
    wis = np.mean(wis_per_horizon) / (K + 0.5)
    return wis


# ── Get reference dates from existing scores ────────────────────────────────
existing = pd.read_csv(SCORES_DIR / "epystrain_WIS_dat.csv")
ref_dates = sorted(existing["reference_date"].unique())
print(f"Reference dates to process: {ref_dates}")

# ── Load location codebook ──────────────────────────────────────────────────
locations = pd.read_csv(CODEBOOK)[["location_code", "location_name"]]
loc_code_to_name = dict(zip(locations["location_code"], locations["location_name"]))

# ── Load surveillance data ──────────────────────────────────────────────────
print("Loading surveillance data...")
surv_url = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"
observations = pd.read_csv(surv_url, dtype={"location": str})
observations["date"] = pd.to_datetime(observations["date"])
obs_weekly = observations.groupby(
    ["location", pd.Grouper(key="date", freq="W-SAT")]
).sum(numeric_only=True).reset_index()
obs_max_date = obs_weekly.date.max()
print(f"Observations max date: {obs_max_date.date()}")

# ── Process each reference date ─────────────────────────────────────────────
results = []
t_start = time.time()

for idx, ref_date_str in enumerate(ref_dates):
    ref_date = pd.Timestamp(ref_date_str)
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)
    t0 = time.time()

    # Download baseline forecast
    url = f"{BASE_URL}/{ref_date_str}-FluSight-baseline.csv"
    try:
        bl = pd.read_csv(url, dtype={"location": str})
    except Exception as e:
        print(f" FAILED: {e}")
        continue

    # Filter to quantile forecasts for hospitalizations, horizons 0-3
    bl = bl[
        (bl["output_type"] == "quantile")
        & (bl["target"] == "wk inc flu hosp")
        & (bl["horizon"].isin(HORIZONS))
    ].copy()
    bl["output_type_id"] = bl["output_type_id"].astype(float)
    bl["value"] = bl["value"].astype(float)
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"])

    for loc in sorted(bl["location"].unique()):
        loc_bl = bl[bl["location"] == loc]

        # Get available horizons that have observation data
        available_dates = sorted(loc_bl["target_end_date"].unique())
        available_dates = [d for d in available_dates if d <= obs_max_date]
        if not available_dates:
            continue

        obs_filt = obs_weekly[
            (obs_weekly.location == loc)
            & (obs_weekly.date.isin(available_dates))
        ].sort_values("date")

        common_dates = sorted(
            set(pd.Timestamp(d) for d in available_dates) & set(obs_filt.date)
        )
        if not common_dates:
            continue

        y = np.array(
            obs_filt[obs_filt.date.isin(common_dates)].sort_values("date").value
        )

        # Build quantile matrix from baseline forecasts
        # Interpolate to match our 23 quantile levels
        n_horizons = len(common_dates)
        q_matrix = np.zeros((len(QUANTILES), n_horizons))

        for h_idx, date in enumerate(common_dates):
            h_data = loc_bl[loc_bl["target_end_date"] == date].sort_values("output_type_id")
            if len(h_data) == 0:
                continue
            bl_q_levels = h_data["output_type_id"].values
            bl_q_values = h_data["value"].values
            # Interpolate baseline quantiles to our quantile levels
            q_matrix[:, h_idx] = np.interp(QUANTILES, bl_q_levels, bl_q_values)

        wis = compute_wis_from_quantiles(np.array(QUANTILES), q_matrix, y)
        wis_norm = wis / np.sum(y) if np.sum(y) > 0 else np.nan

        results.append({
            "location": loc,
            "reference_date": ref_date_str,
            "WIS": wis,
            "WIS_norm": wis_norm,
            "location_name": loc_code_to_name.get(loc, loc),
        })

    print(f" {time.time()-t0:.1f}s ({len([r for r in results if r['reference_date']==ref_date_str])} locs)")

# ── Save ────────────────────────────────────────────────────────────────────
df = pd.DataFrame(results)
output_path = SCORES_DIR / "baseline_WIS_dat.csv"
df.to_csv(output_path, index=False)
print(f"\nSaved {len(df)} rows to {output_path}")
print(f"Total time: {time.time()-t_start:.1f}s")
