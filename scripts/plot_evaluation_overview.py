"""Generate overview box plots of model vs baseline performance.

Plot 1: mean WIS (model) / mean WIS (baseline) per state
Plot 2: mean ES (model) / mean ES (baseline) per state
Each point is a state, aggregated over the full season.
"""

import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data" / "evaluation_scores.json"
FIGURES = ROOT / "figures"
FIGURES.mkdir(exist_ok=True)

# ── Load data ───────────────────────────────────────────────────────────────
with open(DATA) as f:
    records = json.load(f)

df = pd.DataFrame(records)

# Exclude US national aggregate — keep only states
df = df[df["location"] != "US"].copy()

# Drop rows with missing scores
df = df.dropna(subset=["WIS", "baseline_WIS", "energyscore", "baseline_energyscore"])

# ── Compute per-state season averages and ratios ────────────────────────────
state_avg = df.groupby(["location", "location_name"]).agg(
    mean_WIS=("WIS", "mean"),
    mean_baseline_WIS=("baseline_WIS", "mean"),
    mean_ES=("energyscore", "mean"),
    mean_baseline_ES=("baseline_energyscore", "mean"),
).reset_index()

state_avg["WIS_ratio"] = state_avg["mean_WIS"] / state_avg["mean_baseline_WIS"]
state_avg["ES_ratio"] = state_avg["mean_ES"] / state_avg["mean_baseline_ES"]

print(f"States: {len(state_avg)}")
print(f"WIS ratio — median: {state_avg['WIS_ratio'].median():.3f}, "
      f"mean: {state_avg['WIS_ratio'].mean():.3f}")
print(f"ES ratio  — median: {state_avg['ES_ratio'].median():.3f}, "
      f"mean: {state_avg['ES_ratio'].mean():.3f}")

# ── Plot ────────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(10, 5), sharey=False)

for ax, col, label in zip(
    axes,
    ["WIS_ratio", "ES_ratio"],
    ["WIS (Model / Baseline)", "Energy Score (Model / Baseline)"],
):
    # Box plot
    bp = ax.boxplot(
        state_avg[col].values,
        vert=True, widths=0.4, patch_artist=True,
        showfliers=False,
        boxprops=dict(facecolor="teal", alpha=0.3, edgecolor="teal"),
        medianprops=dict(color="teal", linewidth=2),
        whiskerprops=dict(color="teal"),
        capprops=dict(color="teal"),
    )

    # Swarm/strip of individual state points
    jitter = np.random.default_rng(42).uniform(-0.08, 0.08, size=len(state_avg))
    ax.scatter(
        1 + jitter, state_avg[col].values,
        color="teal", alpha=0.5, s=25, zorder=3,
    )

    # Reference line at 1.0
    ax.axhline(1.0, color="gray", linestyle="--", linewidth=1, zorder=1)

    ax.set_ylabel(label, fontsize=13)
    ax.set_xticks([])
    ax.set_title(label, fontsize=13, fontweight="bold")

fig.suptitle("Full Season: Model vs FluSight-Baseline", fontsize=14, fontweight="bold", y=1.02)
fig.tight_layout()

output_path = FIGURES / "evaluation_overview_boxplots.png"
fig.savefig(output_path, dpi=150, bbox_inches="tight")
print(f"\nSaved to {output_path}")
plt.close()
