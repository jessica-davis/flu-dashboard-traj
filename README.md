# Flu Dashboard — Trajectory Scoring

Static dashboard visualizing EpyStrain trajectory forecasts alongside the FluSight-Baseline, with WIS and Energy Score evaluations. Published from [`docs/`](docs/) via Netlify.

## Adding a new reference date (2026-27 season)

When a new weekly trajectory file is ready:

1. Drop it into [`raw/2026-27/`](raw/2026-27/) as delivered (`long_form_trajectories_{YYYYWW}_*.parquet`, one reference date per file). Raw folders and their formats are listed in `SOURCES` in [`scripts/csv_to_parquet.py`](scripts/csv_to_parquet.py).
2. If any states should be left out of that week's forecast, list them under its reference date (the Saturday) in [`data/exclusions.json`](data/exclusions.json).
3. Refresh observed data and rebuild the dashboard:
   ```bash
   source .venv/bin/activate
   python scripts/fetch_flusight_target_data.py   # observed + as-reported data from cdcepi/FluSight-forecast-hub
   python scripts/csv_to_parquet.py
   python scripts/preprocess.py
   ```
4. Commit and push — Netlify will redeploy from `main`.

`fetch_flusight_target_data.py` reads `target-data/time-series.csv` from the `upstream` remote of a FluSight-forecast-hub clone next to this repo (`git fetch` + `git show`, so the clone's working tree is never touched). It writes `data/processed/target_data.parquet` (latest value per week) and `target_vintages.parquet` (every weekly snapshot, for the chart's "Data as reported" layer).

Seasons are defined in [`scripts/seasons.py`](scripts/seasons.py): a season runs from the first Saturday on/after Aug 1. Reference dates are grouped into seasons automatically; each selectable season gets `docs/data/seasons/{season}/` and appears in the Season dropdown. Activity levels and the season-start (epidemic) threshold come from [`data/threshold_levels.csv`](data/threshold_levels.csv) (MEM), written to `docs/data/activity_thresholds.json` on every run.

To refresh the Evaluations page as well (both seasons), run steps 3–5 below afterwards. `compute_all_scores.py` scores the processed trajectories in `data/processed/trajectories/` against `data/processed/target_data.parquet`, tags each row with its season, and skips excluded states for the baseline too. It downloads FluSight-Baseline files from GitHub, so set `SSL_CERT_FILE` as shown below first.

## Updating the dashboard

All scripts run from the repo root. **Run all 5 steps in order every time you add new data.**

First, activate the project virtualenv. The scripts require the package versions pinned in `.venv` (e.g. pandas 3.x) — running them with a system or conda `python` will fail:
```bash
source .venv/bin/activate
```

If you have SSL issues, also prefix your session with:
```bash
export SSL_CERT_FILE=$(python -c "import certifi; print(certifi.where())")
```

### Step 1 — Convert raw trajectories to processed format

```bash
python scripts/csv_to_parquet.py
```

Reads raw parquets from `raw/multistrain_retrospective_trajectories/`, maps location names to FIPS codes using `data/processed/locations.parquet`, and writes per-location parquets to `data/processed/trajectories/ref_YYYY-MM-DD/loc_XX.parquet`.

### Step 2 — Build dashboard JSONs from processed trajectories

```bash
python scripts/preprocess.py
```

Reads from `data/processed/` (trajectories, locations, target data and vintages) and `data/threshold_levels.csv`, and writes the JSON files the dashboard and Methods pages use:
- `docs/data/seasons.json`, `locations.json`, `target_data.json`, `historical_seasons.json`, `activity_thresholds.json`
- `docs/data/seasons/{season}/dashboard_data.json` and `peak_week.json`
- `docs/data/seasons/{season}/trajectories/{fips}.json` (quantiles + 200 sampled trajectories)
- `docs/data/seasons/{season}/vintages/{fips}.json` (data as reported each week)

### Step 3 — Compute evaluation scores

```bash
python scripts/compute_all_scores.py
```

Reads the per-location trajectories in `data/processed/trajectories/` (every season) and observed data from `data/processed/target_data.parquet`, pulls FluSight-Baseline forecasts from GitHub, and writes four CSVs to `data/scores/` (each row has a `season`):
- `epystrain_energyscore_dat.csv`
- `epystrain_WIS_dat.csv`
- `baseline_energyscore_dat.csv`
- `baseline_WIS_dat.csv`

### Step 4 — Convert scores to dashboard JSON

```bash
python scripts/convert_scores.py
```

Merges the four CSVs from `data/scores/` into `docs/data/evaluation_scores.json`, which powers the evaluations page (WIS ratio map, horizon breakdown, state table).

### Step 5 — Convert baseline quantile forecasts

```bash
python scripts/convert_baseline_quantiles.py
```

Pulls FluSight-Baseline quantile forecasts from GitHub and writes `docs/data/baseline_quantiles/{fips}.json` for each state. These are displayed on the evaluations page.

### (Optional) Regenerate figures

```bash
python scripts/plot_wis_map_and_horizons.py   # figures/wis_map_and_horizons.pdf
python scripts/plot_wis_timeseries.py         # figures/wis_timeseries_4locations.pdf
python scripts/plot_evaluation_overview.py    # figures/evaluation_overview_boxplots.png
```

## Quick reference — copy/paste block

```bash
source .venv/bin/activate
export SSL_CERT_FILE=$(python -c "import certifi; print(certifi.where())")
python scripts/csv_to_parquet.py
python scripts/preprocess.py
python scripts/compute_all_scores.py
python scripts/convert_scores.py
python scripts/convert_baseline_quantiles.py
```

## How data flows

```
raw/multistrain_retrospective_trajectories/
    epystrain_trajectories_YYYY-MM-DD.parquet
                    |
        +-----------+-----------+
        |                       |
  csv_to_parquet.py       compute_all_scores.py
        |                  (reads raw/ directly)
        v                       |
  data/processed/               v
  trajectories/            data/scores/*.csv
  ref_*/loc_*.parquet           |
        |                       +---> convert_scores.py
        v                       |         |
  preprocess.py                 |         v
        |                       |   docs/data/evaluation_scores.json
        v                       |
  docs/data/                    +---> convert_baseline_quantiles.py
    dashboard_data.json               |
    locations.json                    v
    target_data.json            docs/data/baseline_quantiles/{fips}.json
    historical_seasons.json
    trajectories/{fips}.json
```

**Why two paths?** The scoring scripts (`compute_all_scores.py`) read the raw parquets directly because they need all 500+ sample trajectories for energy score computation. The dashboard trajectory scripts go through `csv_to_parquet.py` first to remap location names to FIPS codes, then `preprocess.py` subsamples 200 trajectories and computes trend/activity probabilities for display.

## Static files (checked into git, not regenerated)

These files in `data/processed/` are **not produced by any script in this repo**. Update them manually when needed:

- `data/processed/locations.parquet` — location metadata (FIPS, names, population)
- `data/processed/target_data.parquet` — observed hospital admissions (must be updated to include recent weeks)
- `data/processed/historical_thresholds.parquet` — percentile thresholds for activity levels
- `data/threshold_levels.csv` — threshold definitions

## Local preview

```bash
cd docs
python -m http.server 8000
# open http://localhost:8000
```

## Deployment

Netlify publishes the `docs/` folder as-is (see `netlify.toml`). There is no build step — all JSON in `docs/data/` must be regenerated locally and committed.

## Repo layout

```
raw/multistrain_retrospective_trajectories/  # input parquets (one per reference date)
raw/scoring code/                            # reference notebook for energy score
scripts/                                     # all processing scripts
data/processed/                              # intermediate parquets for trajectory view
data/scores/                                 # scoring CSVs (WIS, energy score)
data/location_codebook.csv                   # location name mapping
docs/                                        # static site (published by Netlify)
docs/data/                                   # JSON consumed by the site
figures/                                     # PDF/PNG exports
.github/workflows/                           # CI (auto-rescore on push)
```
