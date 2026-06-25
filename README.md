# Flu Dashboard — Trajectory Scoring

Static dashboard visualizing EpyStrain trajectory forecasts alongside the FluSight-Baseline, with WIS and Energy Score evaluations. Published from [`docs/`](docs/) via Netlify.

## Adding a new reference date

When a new trajectory parquet is ready:

1. Drop the file into [`raw/multistrain_retrospective_trajectories/`](raw/multistrain_retrospective_trajectories/) using the naming convention `epystrain_trajectories_YYYY-MM-DD.parquet`.
2. Run the update commands below (all 5 steps, in order).
3. Commit and push — Netlify will redeploy from `main`.

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

Reads from `data/processed/` (trajectories, locations, target data, thresholds) and writes the JSON files the main dashboard and trajectory pages use:
- `docs/data/dashboard_data.json`
- `docs/data/locations.json`
- `docs/data/target_data.json`
- `docs/data/historical_seasons.json`
- `docs/data/trajectories/{fips}.json` (one per state)

### Step 3 — Compute evaluation scores

```bash
python scripts/compute_all_scores.py
```

Reads raw parquets from `raw/multistrain_retrospective_trajectories/` (not from `data/processed/`), pulls CDC surveillance data and FluSight-Baseline forecasts from GitHub, and writes four CSVs to `data/scores/`:
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
