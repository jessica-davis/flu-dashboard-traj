"""Generate a 2x2 panel PDF showing WIS ratio (model/baseline) over time
for 4 locations (US + 3 states), with scaled hospitalization time series
in the background.
"""

import numpy as np
import pandas as pd
import json
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIGURES = ROOT / "figures"
FIGURES.mkdir(exist_ok=True)
TRAJ_DIR = ROOT / "raw" / "multistrain_retrospective_trajectories"
CODEBOOK = ROOT.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"
SURV_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"

QUANTILES = [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
             0.55, 0.60, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99]

# Locations to plot: US + 3 representative states
LOCATIONS = [
    ("US", "United States", "United_States"),
    ("06", "California", "United_States_California"),
    ("36", "New York", "United_States_New_York"),
    ("48", "Texas", "United_States_Texas"),
]


def wis_from_quantiles(q_values, y_val):
    K = len(QUANTILES) // 2
    wis = 0.0
    for i in range(K):
        lower = q_values[i]
        upper = q_values[-i - 1]
        alpha = 1 - (QUANTILES[-i - 1] - QUANTILES[i])
        is_val = (upper - lower) + (2.0 / alpha) * max(lower - y_val, 0) + \
                 (2.0 / alpha) * max(y_val - upper, 0)
        wis += is_val * alpha / 2
    median_idx = len(QUANTILES) // 2
    wis += 0.5 * abs(q_values[median_idx] - y_val)
    wis /= (K + 0.5)
    return wis


# ── Load surveillance data ──────────────────────────────────────────────────
print("Loading surveillance data...")
observations = pd.read_csv(SURV_URL, dtype={"location": str})
observations["date"] = pd.to_datetime(observations["date"])
obs_weekly = observations.groupby(
    ["location", pd.Grouper(key="date", freq="W-SAT")]
).sum(numeric_only=True).reset_index()
obs_max_date = obs_weekly.date.max()

# ── Get reference dates ─────────────────────────────────────────────────────
parquet_files = sorted(TRAJ_DIR.glob("epystrain_trajectories_*.parquet"))
ref_dates = [f.stem.replace("epystrain_trajectories_", "") for f in parquet_files]
print(f"Reference dates: {ref_dates}")

# ── Compute per-location WIS over time (all horizons combined) ──────────────
print("Computing WIS over time...")
rows = []

for ref_date_str in ref_dates:
    ref_date = pd.Timestamp(ref_date_str)
    pq_path = TRAJ_DIR / f"epystrain_trajectories_{ref_date_str}.parquet"
    traj = pd.read_parquet(pq_path)

    # Download baseline
    url = f"{BASE_URL}/{ref_date_str}-FluSight-baseline.csv"
    try:
        bl = pd.read_csv(url, dtype={"location": str})
    except Exception as e:
        print(f"  FAILED {ref_date_str}: {e}")
        continue

    bl = bl[
        (bl["output_type"] == "quantile")
        & (bl["target"] == "wk inc flu hosp")
        & (bl["horizon"].isin([0, 1, 2, 3]))
    ].copy()
    bl["output_type_id"] = bl["output_type_id"].astype(float)
    bl["value"] = bl["value"].astype(float)
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"])

    for loc_code, loc_name, loc_epydemix in LOCATIONS:
        # Model WIS: compute per horizon then average
        loc_traj = traj[traj["location"] == loc_epydemix]
        if len(loc_traj) == 0:
            continue

        model_wis_horizons = []
        baseline_wis_horizons = []

        for horizon in [0, 1, 2, 3]:
            # Model
            h_traj = loc_traj[loc_traj["horizon"] == horizon]
            if len(h_traj) == 0:
                continue
            target_date = h_traj["date"].iloc[0]
            if target_date > obs_max_date:
                continue

            obs_val = obs_weekly[
                (obs_weekly.location == loc_code) & (obs_weekly.date == target_date)
            ]
            if len(obs_val) == 0:
                continue
            y_val = obs_val["value"].iloc[0]

            # Model WIS
            X = h_traj["target_total"].values
            q_values = np.quantile(X, QUANTILES)
            model_wis_horizons.append(wis_from_quantiles(q_values, y_val))

            # Baseline WIS
            h_bl = bl[(bl["location"] == loc_code) & (bl["horizon"] == horizon)].sort_values("output_type_id")
            if len(h_bl) > 0:
                bl_q_levels = h_bl["output_type_id"].values
                bl_q_values = h_bl["value"].values
                q_interp = np.interp(QUANTILES, bl_q_levels, bl_q_values)
                baseline_wis_horizons.append(wis_from_quantiles(q_interp, y_val))

        if model_wis_horizons and baseline_wis_horizons:
            model_avg = np.mean(model_wis_horizons)
            baseline_avg = np.mean(baseline_wis_horizons)
            ratio = model_avg / baseline_avg if baseline_avg > 0 else np.nan

            rows.append({
                "location": loc_code,
                "location_name": loc_name,
                "reference_date": ref_date_str,
                "model_wis": model_avg,
                "baseline_wis": baseline_avg,
                "ratio": ratio,
            })

    print(f"  {ref_date_str} done")

df = pd.DataFrame(rows)
df["reference_date"] = pd.to_datetime(df["reference_date"])

# ── Build figure ────────────────────────────────────────────────────────────
print("Building figure...")

fig, axes = plt.subplots(2, 2, figsize=(14, 8), sharex=True)
axes = axes.flatten()

for idx, (loc_code, loc_name, _) in enumerate(LOCATIONS):
    ax = axes[idx]
    loc_df = df[df["location"] == loc_code].sort_values("reference_date")

    if len(loc_df) == 0:
        ax.set_title(loc_name, fontsize=13, fontweight="bold")
        ax.text(0.5, 0.5, "No data", ha="center", va="center", transform=ax.transAxes)
        continue

    # Background: scaled hospitalization time series
    loc_obs = obs_weekly[obs_weekly.location == loc_code].sort_values("date")
    # Filter to season range
    season_start = pd.Timestamp("2025-10-01")
    season_end = obs_max_date
    loc_obs = loc_obs[(loc_obs.date >= season_start) & (loc_obs.date <= season_end)]

    ax2 = ax.twinx()
    ax2.fill_between(loc_obs["date"], loc_obs["value"], alpha=0.12, color="#888")
    ax2.plot(loc_obs["date"], loc_obs["value"], color="#aaa", linewidth=1, alpha=0.6)
    ax2.set_ylabel("Hospitalizations", fontsize=9, color="#999")
    ax2.tick_params(axis="y", labelcolor="#bbb", labelsize=8)
    ax2.spines["right"].set_color("#ddd")

    # Foreground: WIS ratio over time
    ax.plot(loc_df["reference_date"], loc_df["ratio"], "o-", color="teal",
            linewidth=2, markersize=5, zorder=5)
    ax.axhline(1.0, color="gray", linestyle="--", linewidth=1, zorder=1)

    ax.set_title(loc_name, fontsize=13, fontweight="bold")
    ax.set_ylabel("WIS Ratio\n(Model / Baseline)", fontsize=10)
    ax.set_zorder(ax2.get_zorder() + 1)
    ax.patch.set_visible(False)

    # Y-axis range
    ymin = min(0.2, loc_df["ratio"].min() - 0.1)
    ymax = max(1.8, loc_df["ratio"].max() + 0.1)
    ax.set_ylim(ymin, ymax)

# Format x-axis dates, starting from Nov 15
for ax in axes:
    ax.set_xlim(left=pd.Timestamp("2025-11-15"))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(byweekday=mdates.SA, interval=3))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=9)

fig.suptitle("WIS Ratio Over Time: EpyStrain vs FluSight-Baseline",
             fontsize=14, fontweight="bold", y=1.01)
fig.tight_layout()

output_path = FIGURES / "wis_timeseries_4locations.pdf"
fig.savefig(output_path, dpi=150, bbox_inches="tight")
print(f"\nSaved to {output_path}")
plt.close()
