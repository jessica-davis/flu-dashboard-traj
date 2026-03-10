"""Compute Energy Score and WIS for both the EpyStrain model and FluSight-Baseline,
using ALL available trajectory parquet files.

Produces 4 CSV files in the epystrain-trajectory-analytics scores directory:
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
"""

import numpy as np
import pandas as pd
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRAJ_DIR = ROOT / "raw" / "multistrain_retrospective_trajectories"
SCORES_DIR = ROOT.parent / "epystrain-trajectory-analytics" / "data" / "scores"
CODEBOOK = ROOT.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"
SURV_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"

N_BASELINE_SAMPLES = 500
HORIZONS = [0, 1, 2, 3]
QUANTILES = np.array([0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
                       0.55, 0.60, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99])


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


# ── Load location codebook ──────────────────────────────────────────────────
loc_df = pd.read_csv(CODEBOOK)[["location_code", "location_name", "location_name_epydemix"]]
epydemix_to_code = dict(zip(loc_df["location_name_epydemix"], loc_df["location_code"]))
code_to_name = dict(zip(loc_df["location_code"], loc_df["location_name"]))

# ── Load surveillance data ──────────────────────────────────────────────────
print("Loading surveillance data...")
observations = pd.read_csv(SURV_URL, dtype={"location": str})
observations["date"] = pd.to_datetime(observations["date"])
obs_weekly = observations.groupby(
    ["location", pd.Grouper(key="date", freq="W-SAT")]
).sum(numeric_only=True).reset_index()
obs_max_date = obs_weekly.date.max()
print(f"  Observations max date: {obs_max_date.date()}")

# ── Get reference dates from parquet files ──────────────────────────────────
parquet_files = sorted(TRAJ_DIR.glob("epystrain_trajectories_*.parquet"))
ref_dates = [f.stem.replace("epystrain_trajectories_", "") for f in parquet_files]
print(f"Reference dates ({len(ref_dates)}): {ref_dates}")

# ── Compute model scores ────────────────────────────────────────────────────
print("\n=== Computing MODEL scores (ES + WIS) ===")
model_es_rows = []
model_wis_rows = []
t_start = time.time()

for idx, ref_date_str in enumerate(ref_dates):
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)
    t0 = time.time()
    pq_path = TRAJ_DIR / f"epystrain_trajectories_{ref_date_str}.parquet"
    traj = pd.read_parquet(pq_path)

    n_locs = 0
    for loc_epydemix in sorted(traj["location"].unique()):
        loc_code = epydemix_to_code.get(loc_epydemix)
        if loc_code is None:
            continue

        loc_traj = traj[traj["location"] == loc_epydemix]

        # Build trajectory matrix X (N_samples, n_horizons) and obs vector y
        horizon_dates = []
        obs_vals = []
        for h in HORIZONS:
            h_data = loc_traj[loc_traj["horizon"] == h]
            if len(h_data) == 0:
                break
            target_date = h_data["date"].iloc[0]
            if target_date > obs_max_date:
                break
            obs_row = obs_weekly[
                (obs_weekly.location == loc_code) & (obs_weekly.date == target_date)
            ]
            if len(obs_row) == 0:
                break
            horizon_dates.append(target_date)
            obs_vals.append(obs_row["value"].iloc[0])

        if len(obs_vals) == 0:
            continue

        n_horizons = len(obs_vals)
        y = np.array(obs_vals)

        # Build X matrix: (N_samples, n_horizons)
        sample_ids = sorted(loc_traj["sample_id"].unique())
        X = np.zeros((len(sample_ids), n_horizons))
        for h_idx, h in enumerate(HORIZONS[:n_horizons]):
            h_data = loc_traj[loc_traj["horizon"] == h].set_index("sample_id")
            for s_idx, sid in enumerate(sample_ids):
                if sid in h_data.index:
                    X[s_idx, h_idx] = h_data.loc[sid, "target_total"]

        # Energy Score
        ES = energyscore(X, y)
        ES_norm = ES / np.sum(y) if np.sum(y) > 0 else np.nan
        model_es_rows.append({
            "location": loc_code,
            "reference_date": ref_date_str,
            "energyscore": ES,
            "energyscore_norm": ES_norm,
            "location_name": code_to_name.get(loc_code, loc_code),
        })

        # WIS
        WIS = wis_from_trajectories(X, y)
        WIS_norm = WIS / np.sum(y) if np.sum(y) > 0 else np.nan
        model_wis_rows.append({
            "location": loc_code,
            "reference_date": ref_date_str,
            "WIS": WIS,
            "WIS_norm": WIS_norm,
            "location_name": code_to_name.get(loc_code, loc_code),
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
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"])

    n_locs = 0
    for loc in sorted(bl["location"].unique()):
        loc_bl = bl[bl["location"] == loc]

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

        # Baseline WIS
        WIS = wis_from_quantile_matrix(q_matrix, y)
        WIS_norm = WIS / np.sum(y) if np.sum(y) > 0 else np.nan
        baseline_wis_rows.append({
            "location": loc,
            "reference_date": ref_date_str,
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
