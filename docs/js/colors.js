// Color schemes and category constants for the flu dashboard

// Trend colors
const TREND_COLORS = {
    large_decrease: "#75BFBD",
    decrease: "#9CD3B4",
    stable: "#D3D3CD",
    increase: "#EFDA86",
    large_increase: "#E8A56D"
};

const TREND_ORDER = ["large_decrease", "decrease", "stable", "increase", "large_increase"];

const TREND_LABELS = {
    large_decrease: "Sharply Decreasing",
    decrease: "Decreasing",
    stable: "Stable",
    increase: "Increasing",
    large_increase: "Sharply Increasing"
};

// Activity colors
const ACTIVITY_COLORS = {
    low: "#E4F7EE",
    moderate: "#9CD8D3",
    high: "#4B9AC1",
    very_high: "#4D6891"
};

const ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"];

const ACTIVITY_LABELS = {
    low: "Low",
    moderate: "Medium",
    high: "High",
    very_high: "Very High"
};

const NO_DATA_COLOR = "#f9f9f9";

// Darker variants for readable text on white backgrounds
const TREND_TEXT_COLORS = {
    large_decrease: "#4FA09E",
    decrease: "#6BAD8A",
    stable: "#999",
    increase: "#C4A840",
    large_increase: "#CF7A3A"
};

const ACTIVITY_TEXT_COLORS = {
    low: "#4A9A6F",
    moderate: "#4AA099",
    high: "#3A7BA0",
    very_high: "#4D6891"
};

// Gauge descriptive text
const TREND_DESCRIPTIONS = {
    large_decrease: "Flu hospitalizations are forecast to largely decrease",
    decrease: "Flu hospitalizations are forecast to decrease",
    stable: "Flu hospitalizations are forecast to remain stable",
    increase: "Flu hospitalizations are forecast to increase",
    large_increase: "Flu hospitalizations are forecast to largely increase"
};

const ACTIVITY_DESCRIPTIONS = {
    low: "Flu activity is at low levels nationally",
    moderate: "Flu activity is at moderate levels nationally",
    high: "Flu activity is at high levels nationally",
    very_high: "Flu activity is at very high levels nationally"
};

// Semi-transparent activity colors for chart band overlay (less fading)
const ACTIVITY_BAND_COLORS = {
    low: "rgba(228, 247, 238, 0.55)",
    moderate: "rgba(156, 216, 211, 0.45)",
    high: "rgba(75, 154, 193, 0.35)",
    very_high: "rgba(77, 104, 145, 0.35)"
};

// Line styles for the "Compare to Previous Seasons" overlay. Assigned by a
// season's position (oldest first) in the previous-seasons list for the active
// season, so 2022-23 / 2023-24 / 2024-25 keep their original colors when
// viewing 2025-26, and 2025-26 takes the fourth style when viewing 2026-27.
const SEASON_PALETTE = [
    { color: "#E07B54", dash: "8,4",     width: 2 },
    { color: "#7B68AE", dash: "4,4",     width: 2 },
    { color: "#4A9A6F", dash: "2,3",     width: 2 },
    { color: "#C9840A", dash: "6,2,2,2", width: 2 },
    { color: "#3A7BA0", dash: "1,3",     width: 2 },
    { color: "#B5566B", dash: "10,3",    width: 2 },
];

// Classify a raw hospitalization value into an activity level using thresholds
function classifyActivity(value, fips) {
    if (typeof activityThresholds === "undefined" || !activityThresholds) return null;
    const th = activityThresholds[fips];
    if (!th || value == null) return null;
    if (value >= th.very_high) return "very_high";
    if (value >= th.high) return "high";
    if (value >= th.moderate) return "moderate";
    return "low";
}

// Season-start sequential color scale: probability the flu season has started
// (weekly ED visits at/above the MEM epidemic threshold). Pale = unlikely
// started; deep blue = very likely started. Deliberately not red/orange.
const SEASON_START_SEQ = d3.scaleSequential(d3.interpolateBlues).domain([0, 1]).clamp(true);

function seasonStartColor(p) {
    return (p == null) ? NO_DATA_COLOR : SEASON_START_SEQ(p);
}

// Solid fill used once the season is confirmed started (observed crossing) — a
// flat "started" state, deliberately not a probability shade.
const SEASON_STARTED_COLOR = "#3B6EA5";

// Peak-week sequential color scale. The domain is the full chronological list of
// candidate forecast weeks for a location (peak_week.json `_domain`), so a given
// calendar week maps to the same color across submissions. Earlier weeks render
// dark, later weeks bright.
let _weekScaleCache = {};

function getWeekColorScale(location) {
    const domain = (typeof peakWeekData !== "undefined" && peakWeekData
        && peakWeekData._domain && peakWeekData._domain[location]) || [];
    const cached = _weekScaleCache[location];
    if (cached && cached.domain.length === domain.length) return cached;

    const indexOf = {};
    domain.forEach((d, i) => { indexOf[d] = i; });
    const seq = d3.scaleSequential(d3.interpolateViridis).domain([0, Math.max(1, domain.length - 1)]);
    const scale = {
        domain,
        indexOf,
        colorByIndex: i => seq(i),
        color: dateStr => (indexOf[dateStr] == null ? NO_DATA_COLOR : seq(indexOf[dateStr])),
    };
    if (domain.length) _weekScaleCache[location] = scale;
    return scale;
}

function weekColor(location, dateStr) {
    return getWeekColorScale(location).color(dateStr);
}

