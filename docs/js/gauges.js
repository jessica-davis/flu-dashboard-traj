// Semi-circular gauge components with animated needle

const GAUGE_WIDTH = 240;
const GAUGE_HEIGHT = 125;
const GAUGE_RADIUS = 80;
const GAUGE_INNER_RADIUS = 48;
const GAUGE_CENTER_Y = GAUGE_HEIGHT - 16;

const ARROW_WIDTH = 200;
const ARROW_HEIGHT = 100;

function initGauges() {
    createTrendArrow();
    createGauge("#gauge-activity", "activity");
}

function createGauge(selector, type) {
    const svg = d3.select(selector)
        .attr("width", GAUGE_WIDTH)
        .attr("height", GAUGE_HEIGHT);

    const g = svg.append("g")
        .attr("class", "gauge-group")
        .attr("transform", `translate(${GAUGE_WIDTH / 2}, ${GAUGE_CENTER_Y})`);

    const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;

    const arcGen = d3.arc()
        .innerRadius(GAUGE_INNER_RADIUS)
        .outerRadius(GAUGE_RADIUS);

    const segmentAngle = Math.PI / categories.length;

    // Draw arc segments
    categories.forEach((cat, i) => {
        const startAngle = -Math.PI / 2 + i * segmentAngle;
        const endAngle = startAngle + segmentAngle;

        g.append("path")
            .attr("class", `gauge-segment gauge-segment-${cat}`)
            .attr("d", arcGen({ startAngle, endAngle }))
            .attr("fill", colors[cat])
            .attr("stroke", "#fff")
            .attr("stroke-width", 0.8);
    });

    // Abbreviated labels
    const shortLabels = type === "trend"
        ? ["Lg\u2193", "Dec", "Stbl", "Inc", "Lg\u2191"]
        : ["Low", "Med", "High", "V.High"];

    categories.forEach((cat, i) => {
        const midAngle = -Math.PI / 2 + (i + 0.5) * segmentAngle;
        const labelR = GAUGE_RADIUS + 18;

        g.append("text")
            .attr("x", Math.sin(midAngle) * labelR)
            .attr("y", -Math.cos(midAngle) * labelR)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "9px")
            .attr("fill", "#777")
            .attr("font-weight", "500")
            .text(shortLabels[i]);
    });

    // Needle
    g.append("line")
        .attr("class", "gauge-needle")
        .attr("x1", 0).attr("y1", 4)
        .attr("x2", 0).attr("y2", -(GAUGE_RADIUS - 6))
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 2.5)
        .attr("stroke-linecap", "round");

    // Center circle
    g.append("circle")
        .attr("cx", 0).attr("cy", 0)
        .attr("r", 5)
        .attr("fill", "#1a1a1a");
}

// --- Trend arrow indicator ---

function createTrendArrow() {
    const svg = d3.select("#trend-arrow-svg")
        .attr("width", ARROW_WIDTH)
        .attr("height", ARROW_HEIGHT);

    const g = svg.append("g")
        .attr("class", "trend-arrow-group")
        .attr("transform", `translate(${ARROW_WIDTH / 2}, ${ARROW_HEIGHT / 2})`);

    // Arrow shape pointing right (stable = 0°), centered at origin
    g.append("path")
        .attr("class", "trend-arrow-path")
        .attr("d", "M-32,-10 L18,-10 L18,-22 L48,0 L18,22 L18,10 L-32,10 Z")
        .attr("fill", "#D1E5B7")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 1);
}

function updateTrendArrow() {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    const probs = entry.trend_probs;
    const mostLikely = entry.trend_most_likely;

    // Map each category to a rotation angle (degrees)
    // Negative = arrow points up-left (decrease), positive = up-right (increase)
    const angleMap = {
        large_decrease: -60,
        decrease: -30,
        stable: 0,
        increase: 30,
        large_increase: 60
    };

    // Weighted angle from probabilities
    let weightedAngle = 0;
    let totalWeight = 0;
    TREND_ORDER.forEach(cat => {
        const w = probs[cat] || 0;
        weightedAngle += angleMap[cat] * w;
        totalWeight += w;
    });
    const rotation = totalWeight > 0 ? weightedAngle / totalWeight : 0;

    // Animate rotation (negative because SVG positive rotation is clockwise,
    // but we want "increase" to point upward)
    d3.select("#trend-arrow-svg").select(".trend-arrow-group")
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .attr("transform",
            `translate(${ARROW_WIDTH / 2}, ${ARROW_HEIGHT / 2}) rotate(${-rotation})`);

    // Color arrow by most likely category
    const isStable = mostLikely === "stable";
    d3.select("#trend-arrow-svg").select(".trend-arrow-path")
        .transition()
        .duration(500)
        .attr("fill", TREND_COLORS[mostLikely] || "#D1E5B7")
        .attr("stroke", isStable ? "#ccc" : "none");

    // Update label below arrow
    const label = TREND_LABELS[mostLikely] || "";
    d3.select("#trend-arrow-label")
        .html(`<span style="color:${TREND_COLORS[mostLikely]};font-weight:700;font-size:15px">${label}</span>`);
}

function updateGauges() {
    updateTrendArrow();
    updateSingleGauge("#gauge-activity", "activity");
    updateOverviewText();
    updateProbabilityLabels();
}

function updateSingleGauge(selector, type) {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const probs = type === "trend" ? entry.trend_probs : entry.activity_probs;

    const segmentAngle = Math.PI / categories.length;
    let weightedAngle = 0;
    let totalWeight = 0;
    categories.forEach((cat, i) => {
        const angle = -Math.PI / 2 + (i + 0.5) * segmentAngle;
        const w = probs[cat] || 0;
        weightedAngle += angle * w;
        totalWeight += w;
    });
    const needleAngle = totalWeight > 0 ? weightedAngle / totalWeight : 0;

    const needleLength = GAUGE_RADIUS - 6;
    const nx = Math.sin(needleAngle) * needleLength;
    const ny = -Math.cos(needleAngle) * needleLength;
    const nx1 = -Math.sin(needleAngle) * 4;
    const ny1 = Math.cos(needleAngle) * 4;

    d3.select(selector).select(".gauge-needle")
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .attr("x2", nx)
        .attr("y2", ny)
        .attr("x1", nx1)
        .attr("y1", ny1);
}

// --- Probability labels below each gauge ---

function updateProbabilityLabels() {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    renderGaugeLabels("gauge-trend-labels", "trend", entry);
    renderGaugeLabels("gauge-activity-labels", "activity", entry);
}

function renderGaugeLabels(containerId, type, entry) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();

    const probs = type === "trend" ? entry.trend_probs : entry.activity_probs;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = type === "trend" ? TREND_LABELS : ACTIVITY_LABELS;

    // Sort by probability descending, take top 2
    const sorted = Object.entries(probs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);

    sorted.forEach(([cat, prob], i) => {
        const span = container.append("span")
            .attr("class", "prob-label")
            .style("color", colors[cat])
            .style("font-size", i === 0 ? "14px" : "12px")
            .style("font-weight", i === 0 ? "700" : "600");
        span.text(`${labels[cat]} ${Math.round(prob * 100)}%`);
    });
}

// --- Enhanced overview text ---

function updateOverviewText() {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;

    // Paragraph 1: Current epiweek, hospitalizations, activity level
    const h0Entry = dashboardData.data[refDate]?.["US"]?.["0"];
    if (!h0Entry) return;

    const refDt = new Date(refDate + "T00:00:00");
    const epiweek = getMMWRWeek(refDt);
    const hospFormatted = d3.format(",")(Math.round(h0Entry.median_value));
    const activityLabel = ACTIVITY_LABELS[h0Entry.activity_most_likely];

    const para1 = `For MMWR Week ${epiweek} (${formatLongDate(refDt)}), ` +
        `there were an estimated <strong>${hospFormatted}</strong> influenza hospitalizations nationally, ` +
        `with <strong>${activityLabel.toLowerCase()}</strong> activity levels.`;

    d3.select("#overview-primary").html(para1);

    // Map summary: tab-dependent state aggregation
    const horizonData = dashboardData.data[refDate];
    if (!horizonData) return;

    const targetSat = new Date(refDt);
    targetSat.setDate(targetSat.getDate() + horizon * 7);
    const targetSun = new Date(targetSat);
    targetSun.setDate(targetSun.getDate() - 6);
    const dateStr = `${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}`;
    const horizonLabel = horizon === 0 ? "(current week)" : `(+${horizon} week${horizon > 1 ? "s" : ""})`;

    const tab = AppState.currentTab;
    let para2 = "";

    if (tab === "trend") {
        let increasing = 0, decreasing = 0, stableCount = 0;
        locationsData.forEach(loc => {
            if (loc.fips === "US") return;
            const stateEntry = horizonData[loc.fips]?.[String(horizon)];
            if (!stateEntry) return;
            const trend = stateEntry.trend_most_likely;
            if (trend === "increase" || trend === "large_increase") increasing++;
            else if (trend === "decrease" || trend === "large_decrease") decreasing++;
            else stableCount++;
        });
        para2 = `For the week of ${dateStr} ${horizonLabel}, ` +
            `<strong>${increasing}</strong> state${increasing !== 1 ? "s" : ""} forecast increasing, ` +
            `<strong>${decreasing}</strong> decreasing, and <strong>${stableCount}</strong> stable.`;
    } else if (tab === "activity") {
        const counts = { low: 0, moderate: 0, high: 0, very_high: 0 };
        locationsData.forEach(loc => {
            if (loc.fips === "US") return;
            const stateEntry = horizonData[loc.fips]?.[String(horizon)];
            if (!stateEntry) return;
            const activity = stateEntry.activity_most_likely;
            if (counts[activity] !== undefined) counts[activity]++;
        });
        para2 = `For the week of ${dateStr} ${horizonLabel}, ` +
            `<strong>${counts.very_high}</strong> state${counts.very_high !== 1 ? "s" : ""} at very high activity, ` +
            `<strong>${counts.high}</strong> high, ` +
            `<strong>${counts.moderate}</strong> moderate, and ` +
            `<strong>${counts.low}</strong> low.`;
    } else if (tab === "admissions") {
        const isPerCap = AppState.admissionsRate === "percapita";
        const usEntry = horizonData["US"]?.[String(horizon)];
        if (usEntry) {
            const estimate = AppState.currentEstimate;
            let raw;
            if (estimate === "most_likely") raw = usEntry.median_value;
            else if (estimate === "lower") raw = usEntry.p10_value;
            else raw = usEntry.p90_value;
            const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
            const pop = fipsToPopulation["US"];
            const val = isPerCap && pop ? raw / pop * 100000 : raw;
            const unit = isPerCap ? "per 100k" : "hospitalizations";
            para2 = `For the week of ${dateStr} ${horizonLabel}, ` +
                `an estimated <strong>${fmt(val)}</strong> ${unit} nationally.`;
        }
    }

    d3.select("#map-trend-summary").html(para2);
}

// --- Helper functions ---

function getMMWRWeek(date) {
    const d = new Date(date);
    // Find the Saturday of this MMWR week
    const day = d.getDay();
    const saturday = new Date(d);
    saturday.setDate(d.getDate() + (6 - day));
    const mmwrYear = saturday.getFullYear();

    // Jan 4 of the MMWR year — find the Sunday on or before it
    const jan4 = new Date(mmwrYear, 0, 4);
    const jan4Day = jan4.getDay();
    const firstSunday = new Date(jan4);
    firstSunday.setDate(jan4.getDate() - jan4Day);

    const diffMs = saturday - firstSunday;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}

function formatLongDate(d) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
