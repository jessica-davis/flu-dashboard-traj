"""Compute Energy Score and WIS for both the EpyStrain model and FluSight-Baseline,
using ALL available trajectory parquet files.

Produces 4 CSV files in data/scores/:
  - epystrain_energyscore_dat.csv
  - epystrain_WIS_dat.csv
  - baseline_energyscore_dat.csv
  - baseline_WIS_dat.csv

Math:
  Energy Score:
    ES = (1/N) * Σ_i ||X_i - y||₂ − (1/(2N²)) * Σ_i Σ_j ||X_i - X_j||₂
    ES_norm = ES / Σ(y)

  WIS (per location, per reference_date):
    For each horizon h, compute WIS_h from 23 quantile levels:
      For each of 11 symmetric pairs (α_k):
        IS_k = (Q_upper - Q_lower) + (2/α) * max(Q_lower - y_h, 0)
                                    + (2/α) * max(y_h - Q_upper, 0)
      WIS_h = [Σ_k (α_k/2) * IS_k + 0.5 * |Q_0.5 - y_h|] / 11.5
    WIS = mean(WIS_h) over horizons 0-3
    WIS_norm = WIS / Σ(y)

  Prediction-interval coverage (model only, per location, per reference_date):
    For each nominal central level c (10%, 20%, ..., 90%), the interval is
    [Q_{(1-c)/2}, Q_{(1+c)/2}]. A horizon is "covered" when
    Q_lower <= y_h <= Q_upper. We store, per record, the number of covered
    horizons and the number of scored horizons (cov_n_obs) so the frontend
    can pool observation counts across dates/locations to get empirical
    coverage = Σ covered / Σ cov_n_obs. Perfect calibration → empirical ≈ nominal.
"""

import json
import numpy as np
import pandas as pd
import time
from pathlib import Path

from seasons import season_for_date

ROOT = Path(__file__).resolve().parent.parent
# Every season's trajectories, already split per location with FIPS codes and
# the data/exclusions.json states removed (scripts/csv_to_parquet.py).
TRAJ_DIR = ROOT / "data" / "processed" / "trajectories"
# Observed admissions: the FluSight hub series the dashboard uses
# (scripts/fetch_flusight_target_data.py).
TARGET_FILE = ROOT / "data" / "processed" / "target_data.parquet"
EXCLUSIONS_FILE = ROOT / "data" / "exclusions.json"
SCORES_DIR = ROOT / "data" / "scores"
CODEBOOK = ROOT / "data" / "location_codebook.csv"
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"

N_BASELINE_SAMPLES = 500
HORIZONS = [0, 1, 2, 3]
QUANTILES = np.array([0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
                       0.55, 0.60, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99])

# Nominal central prediction-interval levels for empirical coverage, in steps of
# 10% across the full range. Each maps to a (lower, upper) quantile pair present
# in QUANTILES (e.g. 10% -> [0.45, 0.55], 90% -> [0.05, 0.95]).
COVERAGE_LEVELS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]
COVERAGE_BOUNDS = {
    lvl: (int(np.argmin(np.abs(QUANTILES - (1 - lvl) / 2))),
          int(np.argmin(np.abs(QUANTILES - (1 + lvl) / 2))))
    for lvl in COVERAGE_LEVELS
}


# ── Scoring functions ───────────────────────────────────────────────────────

def energyscore(X, y):
    """Vectorized energy score. X: (N, T), y: (T,)."""
    term1 = np.mean(np.sqrt(np.sum((X - y) ** 2, axis=1)))
    diff = X[:, np.newaxis, :] - X[np.newaxis, :, :]
    term2 = np.mean(np.sqrt(np.sum(diff ** 2, axis=2)))
    return term1 - term2 / 2


def wis_from_trajectories(X, y):
    """Compute WIS from trajectory matrix X (N, T) and observations y (T,).
    Extracts quantiles from X, then applies the WIS formula."""
    Q = np.quantile(X, QUANTILES, axis=0)  # (23, T)
    return wis_from_quantile_matrix(Q, y)


def wis_from_quantile_matrix(Q, y):
    """Compute WIS from quantile matrix Q (n_quantiles, T) and observations y (T,).
    Returns scalar WIS averaged over all T horizons."""
    K = len(QUANTILES) // 2  # 11
    wis_per_h = np.zeros(len(y))

    for i in range(K):
        lower = Q[i]
        upper = Q[-i - 1]
        alpha = 1 - (QUANTILES[-i - 1] - QUANTILES[i])
        is_val = (upper - lower) + (2.0 / alpha) * np.maximum(lower - y, 0) + \
                 (2.0 / alpha) * np.maximum(y - upper, 0)
        wis_per_h += is_val * alpha / 2

    median_idx = len(QUANTILES) // 2
    wis_per_h += 0.5 * np.abs(Q[median_idx] - y)
    return np.mean(wis_per_h) / (K + 0.5)


def coverage_counts(Q, y):
    """Empirical central-interval coverage from quantile matrix Q (n_quantiles, T)
    and observations y (T,). Returns (counts, n) where counts maps each nominal
    level to the number of horizons whose observation fell inside that interval,
    and n is the number of scored horizons."""
    counts = {}
    for lvl, (lo_idx, hi_idx) in COVERAGE_BOUNDS.items():
        lower = Q[lo_idx]
        upper = Q[hi_idx]
        counts[lvl] = int(np.sum((y >= lower) & (y <= upper)))
    return counts, len(y)


def coverage_row_fields(counts, n, prefix=""):
    """Flatten coverage counts into record fields: per-level fraction plus n_obs."""
    fields = {}
    for lvl in COVERAGE_LEVELS:
        key = f"{prefix}coverage_{int(round(lvl * 100))}"
        fields[key] = counts[lvl] / n if n > 0 else np.nan
    fields[f"{prefix}cov_n_obs"] = n
    return fields


# ── Load location codebook ──────────────────────────────────────────────────
loc_df = pd.read_csv(CODEBOOK)[["location_code", "location_name", "location_name_epydemix"]]
code_to_name = dict(zip(loc_df["location_code"], loc_df["location_name"]))
name_to_code = dict(zip(loc_df["location_name"], loc_df["location_code"]))

# States left out of a forecast are left out of the baseline's scores too, so
# both models are compared on the same locations.
excluded = {}
if EXCLUSIONS_FILE.exists():
    with open(EXCLUSIONS_FILE) as f:
        excluded = {k: {name_to_code.get(n, n) for n in v}
                    for k, v in json.load(f).items() if not k.startswith("_")}

# ── Load surveillance data ──────────────────────────────────────────────────
print("Loading surveillance data...")
obs = pd.read_parquet(TARGET_FILE)
obs = obs[obs["value"].notna()]
obs_lookup = {(r.location, r.date): float(r.value) for r in obs.itertuples()}
obs_max_date = obs["date"].max()
print(f"  Observations max date: {obs_max_date}")

# ── Get reference dates from the processed trajectories ─────────────────────
ref_dates = sorted(d.name.replace("ref_", "") for d in TRAJ_DIR.iterdir()
                   if d.is_dir() and d.name.startswith("ref_"))
print(f"Reference dates ({len(ref_dates)}): {ref_dates}")

# ── Compute model scores ────────────────────────────────────────────────────
print("\n=== Computing MODEL scores (ES + WIS) ===")
model_es_rows = []
model_wis_rows = []
t_start = time.time()

for idx, ref_date_str in enumerate(ref_dates):
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)
    t0 = time.time()
    season = season_for_date(ref_date_str)

    n_locs = 0
    for pq_path in sorted((TRAJ_DIR / f"ref_{ref_date_str}").glob("loc_*.parquet")):
        loc_traj = pd.read_parquet(pq_path, columns=["run_id", "horizon", "date", "value", "fips"])
        loc_code = str(loc_traj["fips"].iloc[0])

        # Scored horizons: consecutive from week 1 while the week has been reported.
        dates_by_h = loc_traj.drop_duplicates("horizon").set_index("horizon")["date"].to_dict()
        obs_vals = []
        for h in HORIZONS:
            target_date = dates_by_h.get(h)
            if target_date is None or target_date > obs_max_date or (loc_code, target_date) not in obs_lookup:
                break
            obs_vals.append(obs_lookup[(loc_code, target_date)])

        if len(obs_vals) == 0:
            continue

        n_horizons = len(obs_vals)
        y = np.array(obs_vals)

        # Trajectory matrix X: (N_samples, n_horizons)
        X = (loc_traj[loc_traj["horizon"].isin(HORIZONS[:n_horizons])]
             .pivot_table(index="run_id", columns="horizon", values="value")
             [HORIZONS[:n_horizons]].fillna(0).values)

        # Energy Score
        ES = energyscore(X, y)
        ES_norm = ES / np.sum(y) if np.sum(y) > 0 else np.nan
        model_es_rows.append({
            "location": loc_code,
            "reference_date": ref_date_str,
            "season": season,
            "energyscore": ES,
            "energyscore_norm": ES_norm,
            "location_name": code_to_name.get(loc_code, loc_code),
        })

        # WIS + coverage (share one quantile matrix built from the trajectories)
        Q = np.quantile(X, QUANTILES, axis=0)
        WIS = wis_from_quantile_matrix(Q, y)
        WIS_norm = WIS / np.sum(y) if np.sum(y) > 0 else np.nan
        cov_counts, cov_n = coverage_counts(Q, y)
        model_wis_rows.append({
            "location": loc_code,
            "reference_date": ref_date_str,
            "season": season,
            "WIS": WIS,
            "WIS_norm": WIS_norm,
            "location_name": code_to_name.get(loc_code, loc_code),
            **coverage_row_fields(cov_counts, cov_n),
        })
        n_locs += 1

    print(f" {time.time()-t0:.1f}s ({n_locs} locs)")

print(f"Model ES: {len(model_es_rows)} rows, Model WIS: {len(model_wis_rows)} rows")

# ── Compute baseline scores ─────────────────────────────────────────────────
print("\n=== Computing BASELINE scores (ES + WIS) ===")
np.random.seed(42)
baseline_es_rows = []
baseline_wis_rows = []

for idx, ref_date_str in enumerate(ref_dates):
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)
    t0 = time.time()

    url = f"{BASE_URL}/{ref_date_str}-FluSight-baseline.csv"
    try:
        bl = pd.read_csv(url, dtype={"location": str})
    except Exception as e:
        print(f" SKIP: {e}")
        continue

    bl = bl[
        (bl["output_type"] == "quantile")
        & (bl["target"] == "wk inc flu hosp")
        & (bl["horizon"].isin(HORIZONS))
    ].copy()
    bl["output_type_id"] = bl["output_type_id"].astype(float)
    bl["value"] = bl["value"].astype(float)
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"]).dt.strftime("%Y-%m-%d")
    season = season_for_date(ref_date_str)

    n_locs = 0
    for loc in sorted(bl["location"].unique()):
        if loc in excluded.get(ref_date_str, ()):
            continue
        loc_bl = bl[bl["location"] == loc]

        common_dates = [d for d in sorted(loc_bl["target_end_date"].unique())
                        if d <= obs_max_date and (loc, d) in obs_lookup]
        if not common_dates:
            continue

        y = np.array([obs_lookup[(loc, d)] for d in common_dates])
        n_horizons = len(common_dates)

        # Build quantile matrix for WIS
        q_matrix = np.zeros((len(QUANTILES), n_horizons))
        for h_idx, date in enumerate(common_dates):
            h_data = loc_bl[loc_bl["target_end_date"] == date].sort_values("output_type_id")
            if len(h_data) == 0:
                continue
            bl_q_levels = h_data["output_type_id"].values
            bl_q_values = h_data["value"].values
            q_matrix[:, h_idx] = np.interp(QUANTILES, bl_q_levels, bl_q_values)

        # Baseline WIS (coverage is model-only)
        WIS = wis_from_quantile_matrix(q_matrix, y)
        WIS_norm = WIS / np.sum(y) if np.sum(y) > 0 else np.nan
        baseline_wis_rows.append({
            "location": loc,
            "reference_date": ref_date_str,
            "season": season,
            "WIS": WIS,
            "WIS_norm": WIS_norm,
            "location_name": code_to_name.get(loc, loc),
        })

        # Baseline ES: sample trajectories from quantile CDF
        traj_samples = np.zeros((N_BASELINE_SAMPLES, n_horizons))
        for h_idx, date in enumerate(common_dates):
            h_data = loc_bl[loc_bl["target_end_date"] == date].sort_values("output_type_id")
            if len(h_data) == 0:
                continue
            q_levels = h_data["output_type_id"].values
            q_values = h_data["value"].values
            u = np.random.uniform(q_levels[0], q_levels[-1], size=N_BASELINE_SAMPLES)
            traj_samples[:, h_idx] = np.interp(u, q_levels, q_values)

        ES = energyscore(traj_samples, y)
        ES_norm = ES / np.sum(y) if np.sum(y) > 0 else np.nan
        baseline_es_rows.append({
            "location": loc,
            "reference_date": ref_date_str,
            "season": season,
            "energyscore": ES,
            "energyscore_norm": ES_norm,
            "location_name": code_to_name.get(loc, loc),
        })
        n_locs += 1

    print(f" {time.time()-t0:.1f}s ({n_locs} locs)")

print(f"Baseline ES: {len(baseline_es_rows)} rows, Baseline WIS: {len(baseline_wis_rows)} rows")

# ── Save all 4 CSVs ─────────────────────────────────────────────────────────
SCORES_DIR.mkdir(parents=True, exist_ok=True)

for name, rows in [
    ("epystrain_energyscore_dat.csv", model_es_rows),
    ("epystrain_WIS_dat.csv", model_wis_rows),
    ("baseline_energyscore_dat.csv", baseline_es_rows),
    ("baseline_WIS_dat.csv", baseline_wis_rows),
]:
    df = pd.DataFrame(rows)
    path = SCORES_DIR / name
    df.to_csv(path, index=False)
    dates = sorted(df["reference_date"].unique())
    print(f"  {name}: {len(df)} rows, {len(dates)} dates ({dates[0]} to {dates[-1]})")

print(f"\nTotal time: {time.time()-t_start:.1f}s")
print("Done. Now run: python3 scripts/convert_scores.py")
