// Color schemes and category constants for the flu dashboard

// Trend colors (diverging blue–gray–orange, colorblind-safe)
const TREND_COLORS = {
    large_decrease: "#2166AC",
    decrease: "#67A9CF",
    stable: "#E0E0E0",
    increase: "#FDAE61",
    large_increase: "#D95F02"
};

const TREND_ORDER = ["large_decrease", "decrease", "stable", "increase", "large_increase"];

const TREND_LABELS = {
    large_decrease: "Large Decrease",
    decrease: "Decrease",
    stable: "Stable",
    increase: "Increase",
    large_increase: "Large Increase"
};

// Activity colors (teal sequential scale)
const ACTIVITY_COLORS = {
    low: "#D5EEEA",
    moderate: "#99D3C7",
    high: "#4DA89E",
    very_high: "#1A6E5F"
};

const ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"];

const ACTIVITY_LABELS = {
    low: "Low",
    moderate: "Medium",
    high: "High",
    very_high: "Very High"
};

const NO_DATA_COLOR = "#f9f9f9";

// Gauge descriptive text
const TREND_DESCRIPTIONS = {
    large_decrease: "Flu hospitalizations are forecast to decrease sharply",
    decrease: "Flu hospitalizations are forecast to decrease",
    stable: "Flu hospitalizations are forecast to remain stable",
    increase: "Flu hospitalizations are forecast to increase",
    large_increase: "Flu hospitalizations are forecast to increase sharply"
};

const ACTIVITY_DESCRIPTIONS = {
    low: "Flu activity is at low levels nationally",
    moderate: "Flu activity is at moderate levels nationally",
    high: "Flu activity is at high levels nationally",
    very_high: "Flu activity is at very high levels nationally"
};

// Historical season colors for "Add Context"
const SEASON_COLORS = {
    "2022-23": "#bbb",
    "2023-24": "#999",
    "2024-25": "#777"
};
