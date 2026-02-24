// Semi-circular gauge components with animated needle

const GAUGE_WIDTH = 130;
const GAUGE_HEIGHT = 90;
const GAUGE_RADIUS = 52;
const GAUGE_INNER_RADIUS = 30;
const GAUGE_CENTER_Y = GAUGE_HEIGHT - 12;

function initGauges() {
    createGauge("#gauge-trend", "trend");
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
        ? ["Lg↓", "Dec", "Stbl", "Inc", "Lg↑"]
        : ["Low", "Med", "High", "V.Hi"];

    categories.forEach((cat, i) => {
        const midAngle = -Math.PI / 2 + (i + 0.5) * segmentAngle;
        const labelR = GAUGE_RADIUS + 10;

        // D3 arc convention: x = sin(θ)*r, y = -cos(θ)*r
        g.append("text")
            .attr("x", Math.sin(midAngle) * labelR)
            .attr("y", -Math.cos(midAngle) * labelR)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "7px")
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
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");

    // Center circle
    g.append("circle")
        .attr("cx", 0).attr("cy", 0)
        .attr("r", 3.5)
        .attr("fill", "#1a1a1a");
}

function updateGauges() {
    updateSingleGauge("#gauge-trend", "trend");
    updateSingleGauge("#gauge-activity", "activity");
    updateOverviewText();
}

function updateSingleGauge(selector, type) {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const probs = type === "trend" ? entry.trend_probs : entry.activity_probs;

    // Compute probability-weighted angle
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

    // D3 arc convention: x = sin(θ)*r, y = -cos(θ)*r
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

function updateOverviewText() {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    const trendLabel = TREND_LABELS[entry.trend_most_likely].toLowerCase();
    const activityLabel = ACTIVITY_LABELS[entry.activity_most_likely].toLowerCase();

    // Build date range string
    const refDt = new Date(refDate + "T00:00:00");
    const targetSat = new Date(refDt);
    targetSat.setDate(targetSat.getDate() + horizon * 7);
    const targetSun = new Date(targetSat);
    targetSun.setDate(targetSun.getDate() - 6);

    const fmt = d => {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    };

    const dateStr = `${fmt(targetSun)}\u2013${fmt(targetSat)}`;

    const text = `For the week of ${dateStr}, influenza hospitalizations nationally show a ${trendLabel} trend, with ${activityLabel} activity levels.`;
    d3.select("#gauges-overview").text(text);
}
