"""
Season rule and manifest shared by the pipeline scripts.

A season runs from the first Saturday on/after Aug 1 to the day before the
next season starts. Saturdays are MMWR week-ending dates, so every observed
week and every forecast reference date falls inside exactly one season.

SEASONS lists every season the site knows about. Seasons before
FIRST_SELECTABLE are only drawn as "Previous seasons" overlays; later ones get
their own docs/data/seasons/{name}/ outputs and appear in the Season dropdown.
"""

from datetime import date, timedelta

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
FIRST_SELECTABLE = "2025-26"

# Left edge of the chart's x-axis (moved earlier by the page when needed to
# show enough reported weeks before the forecast date).
CHART_START_MONTH_DAY = (10, 1)


def season_start(start_year):
    d = date(start_year, 8, 1)
    return d + timedelta(days=(5 - d.weekday()) % 7)   # Saturday on/after Aug 1


def season_bounds(name):
    """("2026-27") -> (start, end) as dates."""
    y = int(name[:4])
    return season_start(y), season_start(y + 1) - timedelta(days=1)


def season_for_date(d):
    """Season name containing date `d` (a date or YYYY-MM-DD string)."""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    y = d.year if d >= season_start(d.year) else d.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def chart_start(name):
    y = int(name[:4])
    return date(y, *CHART_START_MONTH_DAY)


def is_selectable(name):
    return SEASONS.index(name) >= SEASONS.index(FIRST_SELECTABLE)
