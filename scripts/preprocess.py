#!/usr/bin/env python3
"""
Preprocess parquet trajectory data into JSON for the flu dashboard.
Reads from data/processed/ and writes to docs/data/.

Reference dates are grouped into seasons (scripts/seasons.py). Each selectable
season gets its own folder; shared files sit at the top level.

Outputs (docs/data/):
  - seasons.json: season manifest read by the Season dropdown
  - locations.json: location metadata
  - target_data.json: observed weekly admissions (final values) for all locations
  - historical_seasons.json: each season's observed curve, by week of season
  - seasons/{season}/dashboard_data.json: per refdate/location/horizon trend and
    activity probabilities, forecast quantiles and season-start chances
  - seasons/{season}/peak_week.json: peak-week distribution per refdate/location
  - seasons/{season}/trajectories/{fips}.json: sampled trajectories + quantiles
  - seasons/{season}/vintages/{fips}.json: observed data as reported each week
"""

import pandas as pd
import numpy as np
import json
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone

import seasons as S

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "processed"
TRAJ_DIR = DATA_DIR / "trajectories"
OUT_DIR = BASE_DIR / "docs" / "data"

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
ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"]

SAMPLE_TRAJECTORIES = 200  # number of trajectories to export per ref date
QUANTILES = {"p025": 2.5, "p05": 5, "p10": 10, "p25": 25, "p50": 50,
             "p75": 75, "p90": 90, "p95": 95, "p975": 97.5}


def classify_trend(rate_change, count_change, horizon):
    """Trend category for each run (arrays of rate and count change)."""
    t = TREND_THRESHOLDS[min(horizon, 4)]
    return np.select(
        [(np.abs(rate_change) < t["stable"]) | (np.abs(count_change) < COUNT_STABLE_THRESHOLD),
         rate_change >= t["large"],
         rate_change > 0,
         rate_change <= -t["large"]],
        ["stable", "large_increase", "increase", "large_decrease"],
        default="decrease")


def classify_activity(values, th):
    """Activity level for each run, from the weekly-admission thresholds."""
    return np.select([values >= th["very_high"], values >= th["high"], values >= th["moderate"]],
                     ["very_high", "high", "moderate"], default="low")


def get_percentile_category(probs, order, percentile):
    """Walk the CDF and return the category at the given percentile."""
    cumulative = 0.0
    for cat in order:
        cumulative += probs.get(cat, 0.0)
        if cumulative >= percentile:
            return cat
    return order[-1]


def compute_probs(categories, order):
    """Probability distribution from an array of category assignments."""
    total = len(categories)
    if total == 0:
        return {cat: 0.0 for cat in order}
    cats, counts = np.unique(categories, return_counts=True)
    found = dict(zip(cats, counts))
    return {cat: float(found.get(cat, 0)) / total for cat in order}


# ---------------------------------------------------------------------------
# Seasonal metrics from raw sample trajectories: season start and peak week.
# Every metric is computed from the individual sample trajectories across
# every horizon present.
# ---------------------------------------------------------------------------

def observed_onset(obs_series, ref_date, season_start, threshold):
    """First reported week at/above the epidemic threshold this season.

    Only weeks reported when the forecast was made (before ref_date) count, and
    the whole season so far is scanned so a dip back below threshold cannot
    reset onset. Returns (started, onset_date).
    """
    if threshold is None or obs_series is None:
        return False, None
    for date_str, value in obs_series:
        if date_str < season_start or date_str >= ref_date:
            continue
        if value is not None and value >= threshold:
            return True, date_str
    return False, None


def first_date_at(weeks, key, p):
    """Date of the first week whose cumulative `key` reaches p, else None."""
    for w in weeks:
        if w[key] >= p:
            return w["date"]
    return None


def compute_seasonal_metrics(traj, threshold, started_obs):
    """Season-start chances by week and the peak-week distribution.

    traj: DataFrame for one (reference_date, location) with columns
          run_id, horizon, value, date (every horizon present).
    Returns (onset_weeks, peak) where onset_weeks is
    [{horizon, date, start_prob}] for h >= 0 and peak is the peak_week.json
    entry, or None for either when it cannot be computed.
    """
    piv = traj.pivot_table(index="run_id", columns="horizon", values="value")
    horizons = sorted(int(h) for h in piv.columns)
    if not horizons:
        return None, None
    vals = piv[horizons].values  # (N_runs, N_horizons)
    date_by_h = traj.drop_duplicates("horizon").set_index("horizon")["date"].to_dict()
    hz = np.array(horizons)

    # ---- Peak week (argmax across ALL horizons; ties -> earliest) ----
    valid = ~np.isnan(vals).all(axis=1)
    safe = np.where(np.isnan(vals), -np.inf, vals)
    peak_h = hz[safe.argmax(axis=1)][valid]
    peak = None
    if peak_h.size:
        shares = np.array([np.mean(peak_h == h) for h in horizons])
        ml = horizons[int(shares.argmax())]
        peak = {
            "weeks": [date_by_h[h] for h in horizons],
            "proportions": [round(float(s), 4) for s in shares],
            "most_likely": {"date": date_by_h[ml]},
            "past_peak_share": round(float(np.mean(peak_h < 0)), 4),
            "peak_at_last_share": round(float(shares[-1]), 4),
        }

    # ---- Season start over forecast horizons (h >= 0) ----
    onset_weeks = None
    if threshold is not None:
        pos = hz >= 0
        above = vals[:, pos] >= threshold                 # NaN >= x -> False
        has_epi = above.any(axis=1)
        onset_idx = np.where(has_epi, above.argmax(axis=1), -1)
        onset_weeks = []
        for j, h in enumerate(hz[pos]):
            p = 1.0 if started_obs else float(np.mean((onset_idx >= 0) & (onset_idx <= j)))
            onset_weeks.append({"horizon": int(h), "date": date_by_h[int(h)], "start_prob": round(p, 4)})

    return onset_weeks, peak


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def write_json(path, obj):
    os.makedirs(path.parent, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def r1(v):
    return None if v is None or pd.isna(v) else round(float(v), 1)


def export_activity_thresholds():
    """MEM thresholds per location from data/threshold_levels.csv.

    Activity levels use the intensity thresholds (Medium, High, Very High).
    Season start uses the separate epidemic threshold (MEM's baseline ->
    epidemic boundary), which is not the same as the Medium cutoff.
    """
    th = pd.read_csv(BASE_DIR / "data" / "threshold_levels.csv", dtype={"location": str})
    out = {r["location"]: {"moderate": float(r["Medium"]), "high": float(r["High"]),
                           "very_high": float(r["Very High"]), "epidemic": float(r["Epidemic"]),
                           "population": int(r["population"])}
           for _, r in th.iterrows()}
    write_json(OUT_DIR / "activity_thresholds.json", out)
    print(f"  Wrote activity_thresholds.json ({len(out)} locations)")
    return out


def export_target_data(target_data):
    """Observed weekly admissions (final values), grouped by location."""
    result = {}
    for loc, group in target_data.groupby("location"):
        result[loc] = [{"date": r.date, "value": r1(r.value),
                        "rate": None if pd.isna(r.weekly_rate) else round(float(r.weekly_rate), 4)}
                       for r in group.sort_values("date").itertuples()]
    write_json(OUT_DIR / "target_data.json", result)
    print(f"  Wrote target_data.json ({len(result)} locations)")


def export_historical_seasons(target_data):
    """Each season's observed curve, indexed by week since the season start."""
    result = {}
    for loc, group in target_data.groupby("location"):
        loc_seasons = {}
        for name in S.SEASONS:
            start, end = (d.isoformat() for d in S.season_bounds(name))
            season_data = group[(group["date"] >= start) & (group["date"] <= end)].sort_values("date")
            if season_data.empty:
                continue
            start_dt = datetime.fromisoformat(start)
            loc_seasons[name] = [{"week": (datetime.fromisoformat(r.date) - start_dt).days // 7,
                                  "date": r.date, "value": r1(r.value)}
                                 for r in season_data.itertuples()]
        result[loc] = loc_seasons
    write_json(OUT_DIR / "historical_seasons.json", result)
    print(f"  Wrote historical_seasons.json ({len(result)} locations)")


def export_vintages(season, vintages, out_dir):
    """Observed data as reported on each as_of date within the season."""
    start, end = (d.isoformat() for d in S.season_bounds(season))
    v = vintages[(vintages["as_of"] >= start) & (vintages["as_of"] <= end) & (vintages["date"] >= start)]
    n = 0
    for loc, group in v.groupby("location"):
        data = {as_of: [{"date": r.date, "value": r1(r.value)} for r in g.sort_values("date").itertuples()]
                for as_of, g in group.groupby("as_of")}
        write_json(out_dir / "vintages" / f"{loc}.json", {"pulled": sorted(data), "data": data})
        n += 1
    print(f"  Wrote vintages for {n} locations ({v['as_of'].nunique()} snapshots)")


def load_ref(ref_date):
    """{fips: trajectory DataFrame} for one reference date."""
    ref_dir = TRAJ_DIR / f"ref_{ref_date}"
    out = {}
    for f in sorted(ref_dir.glob("loc_*.parquet")):
        traj = pd.read_parquet(f)
        out[str(traj["fips"].iloc[0])] = traj
    return out


def build_season(season, ref_dates, ctx):
    """Write every per-season output for one season."""
    out_dir = OUT_DIR / "seasons" / season
    season_start = S.season_bounds(season)[0].isoformat()
    dashboard = {
        "season": season,
        "most_recent_reference_date": ref_dates[-1] if ref_dates else None,
        "reference_dates": ref_dates,
        "trend_categories": TREND_ORDER,
        "activity_categories": ACTIVITY_ORDER,
        # Trend limits as rate change per 100k (the page converts them to
        # admissions); a change under count_stable_threshold is always Stable.
        "trend_thresholds": {str(h): {"large_dec": -t["large"], "dec": -t["stable"],
                                      "inc": t["stable"], "large_inc": t["large"]}
                             for h, t in TREND_THRESHOLDS.items() if h <= 3},
        "count_stable_threshold": COUNT_STABLE_THRESHOLD,
        "data": {},
        "onset": {},
    }
    peak_week = {"_domain": {}, "_observed_peak": {}}
    traj_out = {}   # fips -> {"reference_dates": [...], "data": {ref: ...}}

    for ref_date in ref_dates:
        print(f"\n  {season} {ref_date}")
        ref_dt = datetime.strptime(ref_date, "%Y-%m-%d")
        baseline_date = (ref_dt - timedelta(days=7)).strftime("%Y-%m-%d")
        ref_data, ref_onset = {}, {}

        for fips, traj in load_ref(ref_date).items():
            population = ctx["loc_pop"].get(fips)
            th = ctx["act_thr"].get(fips)
            if not population or not th:
                continue
            base = ctx["target_lookup"].get((fips, baseline_date), {"value": 0.0, "weekly_rate": 0.0})
            threshold = th.get("epidemic", th.get("moderate"))
            started_obs, onset_date_obs = observed_onset(
                ctx["obs_by_fips"].get(fips), ref_date, season_start, threshold)
            onset_weeks, peak = compute_seasonal_metrics(traj, threshold, started_obs)
            onset_by_h = {w["horizon"]: w["start_prob"] for w in (onset_weeks or [])}

            # One row per run, one column per forecast horizon (h >= 0).
            fut = traj[traj["horizon"] >= 0]
            piv = fut.pivot_table(index="run_id", columns="horizon", values="value").sort_index()
            dates_by_h = fut.drop_duplicates("horizon").set_index("horizon")["date"].to_dict()
            horizons = sorted(int(h) for h in piv.columns)

            loc_data = {}
            for h in [h for h in horizons if h <= 4]:
                v = piv[h].dropna().values
                if v.size == 0:
                    continue
                rate_change = v / population * 100000 - base["weekly_rate"]
                trend_probs = compute_probs(classify_trend(rate_change, v - base["value"], h), TREND_ORDER)
                activity_probs = compute_probs(classify_activity(v, th), ACTIVITY_ORDER)
                median_value = float(np.median(v))
                entry = {
                    "trend_probs": {k: round(p, 4) for k, p in trend_probs.items()},
                    "activity_probs": {k: round(p, 4) for k, p in activity_probs.items()},
                    "trend_most_likely": max(trend_probs, key=trend_probs.get),
                    "trend_lower": get_percentile_category(trend_probs, TREND_ORDER, 0.10),
                    "trend_upper": get_percentile_category(trend_probs, TREND_ORDER, 0.90),
                    "activity_most_likely": max(activity_probs, key=activity_probs.get),
                    "forecast_date": (ref_dt + timedelta(days=h * 7)).strftime("%Y-%m-%d"),
                    "median_value": round(median_value, 1),
                    "median_rate": round(median_value / population * 100000, 2),
                    "p10_value": round(float(np.percentile(v, 10)), 1),
                    "p90_value": round(float(np.percentile(v, 90)), 1),
                }
                if onset_weeks is not None:
                    entry["onset_prob"] = onset_by_h.get(h)
                    entry["season_started_observed"] = bool(started_obs)
                    entry["observed_onset_date"] = onset_date_obs
                loc_data[str(h)] = entry
            if not loc_data:
                continue
            ref_data[fips] = loc_data

            # Likely range for the week the season starts (10th-90th percentile).
            if onset_weeks and not started_obs:
                ref_onset[fips] = {"lower": first_date_at(onset_weeks, "start_prob", 0.10),
                                   "upper": first_date_at(onset_weeks, "start_prob", 0.90)}
            if peak:
                peak_week.setdefault(fips, {})[ref_date] = peak

            # Trajectory file entry: quantiles from every run, a fixed sample of runs.
            run_ids = piv.index.values
            rng = np.random.RandomState(42)
            sample = np.sort(rng.choice(run_ids, size=min(SAMPLE_TRAJECTORIES, len(run_ids)), replace=False))
            sp = piv.loc[sample, horizons]
            trajectories = []
            for run_id, row in sp.iterrows():
                trends = {}
                for h in [h for h in horizons if h <= 4]:
                    val = row[h]
                    if pd.notna(val):
                        trends[f"h{h}"] = str(classify_trend(
                            np.array([val / population * 100000 - base["weekly_rate"]]),
                            np.array([val - base["value"]]), h)[0])
                trajectories.append({"run_id": int(run_id),
                                     "values": [r1(x) for x in row.values],
                                     "trends": trends})
            qs = {k: [r1(x) for x in np.nanpercentile(piv[horizons].values, q, axis=0)]
                  for k, q in QUANTILES.items()}
            t = traj_out.setdefault(fips, {"reference_dates": [], "data": {}})
            t["reference_dates"].append(ref_date)
            t["data"][ref_date] = {"dates": [dates_by_h[h] for h in horizons],
                                   "quantiles": qs, "trajectories": trajectories}

        dashboard["data"][ref_date] = ref_data
        dashboard["onset"][ref_date] = ref_onset
        print(f"    {len(ref_data)} locations")

    # Peak-week color domain (every candidate week) and the observed peak so far.
    for fips, by_ref in list(peak_week.items()):
        if fips.startswith("_"):
            continue
        peak_week["_domain"][fips] = sorted({w for p in by_ref.values() for w in p["weeks"]})
    start, end = (d.isoformat() for d in S.season_bounds(season))
    obs = ctx["target_data"]
    obs = obs[(obs["date"] >= start) & (obs["date"] <= end) & obs["value"].notna()]
    for fips, g in obs.groupby("location"):
        top = g.loc[g["value"].idxmax()]
        peak_week["_observed_peak"][fips] = {"date": top["date"], "value": r1(top["value"])}

    write_json(out_dir / "dashboard_data.json", dashboard)
    write_json(out_dir / "peak_week.json", peak_week)
    for fips, t in traj_out.items():
        write_json(out_dir / "trajectories" / f"{fips}.json", t)
    print(f"\n  Wrote seasons/{season}/: dashboard_data.json, peak_week.json, "
          f"{len(traj_out)} trajectory files")
    export_vintages(season, ctx["vintages"], out_dir)


def main():
    print("Loading data files...")
    locations = pd.read_parquet(DATA_DIR / "locations.parquet")
    locations = locations[locations["location"] != "72"]
    target_data = pd.read_parquet(DATA_DIR / "target_data.parquet")
    target_data = target_data[target_data["location"] != "72"]
    vintages = pd.read_parquet(DATA_DIR / "target_vintages.parquet")
    act_thr = export_activity_thresholds()

    ctx = {
        "loc_pop": dict(zip(locations["location"], locations["population"])),
        "act_thr": act_thr,
        "target_data": target_data,
        "vintages": vintages,
        "target_lookup": {(r.location, r.date): {"value": r.value, "weekly_rate": r.weekly_rate}
                          for r in target_data.itertuples()},
        "obs_by_fips": {loc: [(r.date, None if pd.isna(r.value) else float(r.value))
                              for r in g.itertuples()]
                        for loc, g in target_data.sort_values("date").groupby("location")},
    }

    ref_dates = sorted(d.name.replace("ref_", "") for d in TRAJ_DIR.iterdir()
                       if d.is_dir() and d.name.startswith("ref_"))
    by_season = {}
    for rd in ref_dates:
        by_season.setdefault(S.season_for_date(rd), []).append(rd)
    print(f"Found {len(ref_dates)} reference dates: "
          + ", ".join(f"{s} ({len(v)})" for s, v in sorted(by_season.items())))

    manifest = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "seasons": []}
    us_obs = target_data[(target_data["location"] == "US") & target_data["value"].notna()]
    for name in S.SEASONS:
        start, end = S.season_bounds(name)
        in_season = us_obs[(us_obs["date"] >= start.isoformat()) & (us_obs["date"] <= end.isoformat())]
        refs = by_season.get(name, [])
        manifest["seasons"].append({
            "name": name,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "chart_start": S.chart_start(name).isoformat(),
            "selectable": S.is_selectable(name),
            "has_forecasts": bool(refs),
            "observed_through": in_season["date"].max() if len(in_season) else None,
        })
        if S.is_selectable(name):
            print(f"\nBuilding season {name}...")
            build_season(name, refs, ctx)
    with_fc = [s["name"] for s in manifest["seasons"] if s["selectable"] and s["has_forecasts"]]
    manifest["default_season"] = with_fc[-1] if with_fc else S.SEASONS[-1]

    print("\nWriting shared files...")
    write_json(OUT_DIR / "seasons.json", manifest)
    print(f"  Wrote seasons.json (default {manifest['default_season']})")
    write_json(OUT_DIR / "locations.json", [
        {"fips": r.location, "abbreviation": r.abbreviation, "name": r.location_name,
         "population": int(r.population)}
        for r in locations.itertuples()])
    print(f"  Wrote locations.json ({len(locations)} locations)")
    export_target_data(target_data)
    export_historical_seasons(target_data)
    print("\nDone!")


if __name__ == "__main__":
    main()
