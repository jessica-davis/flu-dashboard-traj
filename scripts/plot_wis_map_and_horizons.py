"""Generate a two-panel PDF figure:
  Left:  US map colored by state-level WIS ratio (model / baseline), full season avg
  Right: 5 horizontal box plots — all horizons combined, then horizons 0-3 individually

"All Horizons" map and box use evaluation_scores.json (same data as webpage).
Per-horizon boxes use per-horizon WIS computed from raw trajectory parquets
and FluSight-baseline quantile forecasts.
"""

import numpy as np
import pandas as pd
import json
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.collections import PatchCollection
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIGURES = ROOT / "figures"
FIGURES.mkdir(exist_ok=True)
TRAJ_DIR = ROOT / "raw" / "multistrain_retrospective_trajectories"
CODEBOOK = ROOT.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"
EVAL_JSON = ROOT / "docs" / "data" / "evaluation_scores.json"
SURV_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"

QUANTILES = [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
             0.55, 0.60, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99]


def wis_from_quantiles(q_values, y_val):
    """Compute WIS for a single horizon from quantile values and a scalar observation."""
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


# ── Load evaluation_scores.json (same data as webpage) ─────────────────────
print("Loading evaluation_scores.json...")
with open(EVAL_JSON) as f:
    eval_data = json.load(f)
eval_df = pd.DataFrame(eval_data)

# Compute "All Horizons" ratio from evaluation_scores.json: mean(model) / mean(baseline)
eval_df = eval_df[eval_df["location"] != "US"].copy()
eval_valid = eval_df.dropna(subset=["WIS", "baseline_WIS"])
all_horizons_ratios = eval_valid.groupby("location").agg(
    mean_model=("WIS", "mean"),
    mean_baseline=("baseline_WIS", "mean"),
).reset_index()
all_horizons_ratios["ratio"] = all_horizons_ratios["mean_model"] / all_horizons_ratios["mean_baseline"]
all_horizons_ratios["label"] = "All Horizons"

print(f"  All Horizons (from JSON) — median ratio: {all_horizons_ratios['ratio'].median():.4f}, "
      f"mean: {all_horizons_ratios['ratio'].mean():.4f}, states: {len(all_horizons_ratios)}")

# ── Load location codebook ──────────────────────────────────────────────────
loc_df = pd.read_csv(CODEBOOK)[["location_code", "location_name", "location_name_epydemix"]]
epydemix_to_code = dict(zip(loc_df["location_name_epydemix"], loc_df["location_code"]))

# ── Load surveillance data ──────────────────────────────────────────────────
print("Loading surveillance data...")
observations = pd.read_csv(SURV_URL, dtype={"location": str})
observations["date"] = pd.to_datetime(observations["date"])
obs_weekly = observations.groupby(
    ["location", pd.Grouper(key="date", freq="W-SAT")]
).sum(numeric_only=True).reset_index()
obs_max_date = obs_weekly.date.max()

# ── Get reference dates from ALL parquet files ─────────────────────────────
parquet_files = sorted(TRAJ_DIR.glob("epystrain_trajectories_*.parquet"))
ref_dates = [f.stem.replace("epystrain_trajectories_", "") for f in parquet_files]
print(f"Reference dates ({len(ref_dates)}): {ref_dates}")

# ── Compute per-horizon WIS for model (from trajectories) ──────────────────
print("Computing model per-horizon WIS...")
model_rows = []

for ref_date_str in ref_dates:
    pq_path = TRAJ_DIR / f"epystrain_trajectories_{ref_date_str}.parquet"
    traj = pd.read_parquet(pq_path)

    for loc_epydemix in traj["location"].unique():
        loc_code = epydemix_to_code.get(loc_epydemix)
        if loc_code is None or loc_code == "US":
            continue

        loc_traj = traj[traj["location"] == loc_epydemix]

        for horizon in [0, 1, 2, 3]:
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

            X = h_traj["target_total"].values
            q_values = np.quantile(X, QUANTILES)
            wis = wis_from_quantiles(q_values, y_val)

            model_rows.append({
                "location": loc_code,
                "reference_date": ref_date_str,
                "horizon": horizon,
                "WIS": wis,
            })

model_df = pd.DataFrame(model_rows)
print(f"  Model: {len(model_df)} rows")

# ── Compute per-horizon WIS for baseline ────────────────────────────────────
print("Computing baseline per-horizon WIS...")
baseline_rows = []

for ref_date_str in ref_dates:
    url = f"{BASE_URL}/{ref_date_str}-FluSight-baseline.csv"
    try:
        bl = pd.read_csv(url, dtype={"location": str})
    except Exception as e:
        print(f"  SKIP baseline {ref_date_str}: {e}")
        continue

    bl = bl[
        (bl["output_type"] == "quantile")
        & (bl["target"] == "wk inc flu hosp")
        & (bl["horizon"].isin([0, 1, 2, 3]))
    ].copy()
    bl["output_type_id"] = bl["output_type_id"].astype(float)
    bl["value"] = bl["value"].astype(float)
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"])

    for loc in sorted(bl["location"].unique()):
        if loc == "US":
            continue
        loc_bl = bl[bl["location"] == loc]

        for horizon in [0, 1, 2, 3]:
            h_data = loc_bl[loc_bl["horizon"] == horizon].sort_values("output_type_id")
            if len(h_data) == 0:
                continue

            target_date = h_data["target_end_date"].iloc[0]
            if target_date > obs_max_date:
                continue

            obs_val = obs_weekly[
                (obs_weekly.location == loc) & (obs_weekly.date == target_date)
            ]
            if len(obs_val) == 0:
                continue
            y_val = obs_val["value"].iloc[0]

            bl_q_levels = h_data["output_type_id"].values
            bl_q_values = h_data["value"].values
            q_interp = np.interp(QUANTILES, bl_q_levels, bl_q_values)
            wis = wis_from_quantiles(q_interp, y_val)

            baseline_rows.append({
                "location": loc,
                "reference_date": ref_date_str,
                "horizon": horizon,
                "WIS": wis,
            })

baseline_df = pd.DataFrame(baseline_rows)
print(f"  Baseline: {len(baseline_rows)} rows")

# ── Merge per-horizon data and compute per-horizon ratios ─────────────────
merged = model_df.merge(
    baseline_df, on=["location", "reference_date", "horizon"],
    suffixes=("_model", "_baseline")
)
print(f"  Merged: {len(merged)} rows")


def compute_state_ratios(df, horizons, label):
    sub = df[df["horizon"].isin(horizons)]
    grouped = sub.groupby("location").agg(
        mean_model=("WIS_model", "mean"),
        mean_baseline=("WIS_baseline", "mean"),
    ).reset_index()
    grouped["ratio"] = grouped["mean_model"] / grouped["mean_baseline"]
    grouped["label"] = label
    return grouped


ratio_h0 = compute_state_ratios(merged, [0], "Horizon 0\n(1 wk)")
ratio_h1 = compute_state_ratios(merged, [1], "Horizon 1\n(2 wk)")
ratio_h2 = compute_state_ratios(merged, [2], "Horizon 2\n(3 wk)")
ratio_h3 = compute_state_ratios(merged, [3], "Horizon 3\n(4 wk)")

# Use all_horizons_ratios from evaluation_scores.json for "All Horizons"
ratios = pd.concat([all_horizons_ratios, ratio_h0, ratio_h1, ratio_h2, ratio_h3])

# Map uses "All Horizons" ratios (from evaluation_scores.json)
ratio_all = all_horizons_ratios
map_data = ratio_all[["location", "ratio"]].copy()

# ── Load US states TopoJSON and decode ──────────────────────────────────────
topo_path = ROOT / "docs" / "data" / "us-states.json"
with open(topo_path) as f:
    topo = json.load(f)


def decode_arc(arc_index, arcs, transform):
    """Decode a single arc from TopoJSON into absolute coordinates."""
    scale = transform["scale"]
    translate = transform["translate"]
    reverse = arc_index < 0
    idx = ~arc_index if reverse else arc_index
    coords = arcs[idx]
    # Delta-decode first (must happen in original order)
    x, y = 0, 0
    result = []
    for dx, dy in coords:
        x += dx
        y += dy
        result.append([x * scale[0] + translate[0], y * scale[1] + translate[1]])
    # Then reverse if needed
    if reverse:
        result = result[::-1]
    return result


def decode_ring(arc_indices, arcs, transform):
    """Decode a ring (list of arc indices) into a coordinate ring."""
    ring = []
    for idx in arc_indices:
        decoded = decode_arc(idx, arcs, transform)
        if ring:
            ring.extend(decoded[1:])
        else:
            ring.extend(decoded)
    return ring


arcs = topo["arcs"]
transform = topo["transform"]
geometries = topo["objects"]["states"]["geometries"]

ratio_lookup = dict(zip(map_data["location"], map_data["ratio"]))

# ── Build figure ────────────────────────────────────────────────────────────
print("Building figure...")

fig = plt.figure(figsize=(18, 7))
gs = fig.add_gridspec(1, 2, width_ratios=[1.8, 1], wspace=0.15)

# === LEFT PANEL: US Map ===
ax_map = fig.add_subplot(gs[0])

# Diverging colormap matching the webpage: steel blue (<1) → light gray (1) → warm brown (>1)
from matplotlib.colors import LinearSegmentedColormap
cmap = LinearSegmentedColormap.from_list(
    "eval_diverging", ["#4A7FB5", "#f0f0f0", "#B8663D"]
)
# Symmetric extent around 1.0, matching webpage dynamic range
all_ratios = ratio_all["ratio"].values
extent = max(abs(all_ratios.min() - 1), abs(all_ratios.max() - 1))
vmin, vmax = 1 - extent, 1 + extent
norm = mcolors.TwoSlopeNorm(vmin=vmin, vcenter=1.0, vmax=vmax)

patches = []
colors = []

for geom in geometries:
    fips = geom.get("id", "")
    ratio_val = ratio_lookup.get(fips, np.nan)
    geom_type = geom["type"]
    geom_arcs = geom["arcs"]

    if geom_type == "Polygon":
        for ring_arcs in geom_arcs:
            ring = decode_ring(ring_arcs, arcs, transform)
            patches.append(MplPolygon(np.array(ring), closed=True))
            colors.append(ratio_val)
    elif geom_type == "MultiPolygon":
        for polygon_arcs in geom_arcs:
            for ring_arcs in polygon_arcs:
                ring = decode_ring(ring_arcs, arcs, transform)
                patches.append(MplPolygon(np.array(ring), closed=True))
                colors.append(ratio_val)

colors = np.array(colors)
pc = PatchCollection(patches, cmap=cmap, norm=norm, edgecolor="#666", linewidth=0.3)
pc.set_array(colors)
ax_map.add_collection(pc)

ax_map.set_xlim(-128, -64)
ax_map.set_ylim(22, 52)
ax_map.set_aspect("auto")
ax_map.axis("off")
ax_map.set_title("WIS Ratio by State (Model / Baseline)", fontsize=13, fontweight="bold", pad=10)

# Colorbar
sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
sm.set_array([])
cbar = fig.colorbar(sm, ax=ax_map, shrink=0.6, aspect=20, pad=0.02)
cbar.set_label("WIS Ratio (Model / Baseline)", fontsize=11)
cbar.ax.axhline(1.0, color="black", linewidth=1.5, linestyle="-")

# === RIGHT PANEL: 5 horizontal box plots ===
ax_box = fig.add_subplot(gs[1])

labels_order = ["All Horizons", "Horizon 0\n(1 wk)", "Horizon 1\n(2 wk)", "Horizon 2\n(3 wk)", "Horizon 3\n(4 wk)"]
box_data = [ratios[ratios["label"] == lab]["ratio"].values for lab in labels_order]

positions = list(range(len(labels_order), 0, -1))

bp = ax_box.boxplot(
    box_data, positions=positions, vert=False, widths=0.5,
    patch_artist=True, showfliers=False,
    boxprops=dict(facecolor="teal", alpha=0.25, edgecolor="teal"),
    medianprops=dict(color="teal", linewidth=2),
    whiskerprops=dict(color="teal"),
    capprops=dict(color="teal"),
)

rng = np.random.default_rng(42)
for i, (data, pos) in enumerate(zip(box_data, positions)):
    jitter = rng.uniform(-0.12, 0.12, size=len(data))
    ax_box.scatter(data, pos + jitter, color="teal", alpha=0.45, s=18, zorder=3)

ax_box.axvline(1.0, color="gray", linestyle="--", linewidth=1, zorder=1)
ax_box.set_yticks(positions)
ax_box.set_yticklabels(labels_order, fontsize=11)
ax_box.set_xlabel("WIS Ratio (Model / Baseline)", fontsize=12)
ax_box.set_title("WIS Ratio by Forecast Horizon", fontsize=13, fontweight="bold", pad=10)
ax_box.spines["top"].set_visible(False)
ax_box.spines["right"].set_visible(False)

fig.suptitle("Full Season Evaluation: EpyStrain vs FluSight-Baseline", fontsize=15, fontweight="bold", y=1.0)

output_path = FIGURES / "wis_map_and_horizons.pdf"
fig.savefig(output_path, dpi=150, bbox_inches="tight")
print(f"\nSaved to {output_path}")
plt.close()
