// US choropleth map. It is colored by the gauge selected in the summary panel
// (AppState.mapView: activity, trend, onset or peak) for the selected forecast
// week. Clicking a state makes it the location the panel and chart describe.

const MAP_WIDTH = 800;
const MAP_HEIGHT = 480;

let mapSvg, mapPath, stateFeatures;
let fipsToName = {};

const MAP_VIEW_TITLES = {
    activity: "Influenza Activity",
    trend: "Influenza Trend",
    onset: "Projected Season Start",
    peak: "Projected Peak Week",
};

function initMap(topoData) {
    mapSvg = d3.select("#us-map")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    stateFeatures = topojson.feature(topoData, topoData.objects.states).features;
    locationsData.forEach(loc => { fipsToName[loc.fips] = loc.name; });

    const projection = d3.geoAlbersUsa()
        .fitSize([MAP_WIDTH - 20, MAP_HEIGHT - 10], { type: "FeatureCollection", features: stateFeatures });
    mapPath = d3.geoPath().projection(projection);

    // Hatched pattern for states with no forecast
    const pattern = mapSvg.append("defs").append("pattern")
        .attr("id", "no-data-pattern")
        .attr("width", 6).attr("height", 6)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("patternTransform", "rotate(45)");
    pattern.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#f5f5f5");
    pattern.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
        .attr("stroke", "#ddd").attr("stroke-width", 1.5);

    // Hatched fill for "season started" (reported), so it reads apart from
    // the blue chance-started shading.
    const started = mapSvg.select("defs").append("pattern")
        .attr("id", "started-pattern")
        .attr("width", 6).attr("height", 6)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("patternTransform", "rotate(45)");
    started.append("rect").attr("width", 6).attr("height", 6).attr("fill", SEASON_STARTED_COLOR);
    started.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
        .attr("stroke", "#fff").attr("stroke-width", 2.2);

    mapSvg.selectAll(".state")
        .data(stateFeatures)
        .join("path")
        .attr("class", "state")
        .attr("d", mapPath)
        .attr("fill", d => getStateColor(d))
        .on("mouseenter", handleMouseEnter)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleStateClick);

    mapSvg.append("path")
        .attr("class", "state-border")
        .datum(topojson.mesh(topoData, topoData.objects.states, (a, b) => a !== b))
        .attr("d", mapPath);

    // Outline of the selected state, drawn above the borders.
    mapSvg.append("path").attr("class", "state-selected")
        .attr("fill", "none").attr("stroke", "#1a1a1a").attr("stroke-width", 2)
        .attr("pointer-events", "none");

    addDCInset();
}

function addDCInset() {
    // Position near the VA/MD coast on AlbersUSA projection
    const boxSize = 16;
    const g = mapSvg.append("g")
        .attr("class", "dc-inset")
        .attr("transform", "translate(700, 235)");

    g.append("rect")
        .attr("class", "dc-inset-box state")
        .attr("width", boxSize).attr("height", boxSize).attr("rx", 2)
        .attr("fill", getColorForFips("11"))
        .attr("stroke", "#999").attr("stroke-width", 0.5)
        .attr("cursor", "pointer")
        .datum({ id: 11 })
        .on("mouseenter", handleMouseEnter)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleStateClick);

    g.append("text")
        .attr("class", "dc-inset-label")
        .attr("x", boxSize + 4).attr("y", boxSize / 2 + 4)
        .attr("font-size", "9px").attr("fill", "#666")
        .text("DC");
}

function getStateFips(d) {
    return String(d.id).padStart(2, "0");
}

function mapEntry(fips) {
    return dashboardData?.data?.[AppState.currentRefDate]?.[fips]?.[String(AppState.currentHorizon)] || null;
}

function mapTargetSat() {
    return d3.timeFormat("%Y-%m-%d")(targetWeekRange(AppState.currentRefDate, AppState.currentHorizon).sat);
}

// Activity level or trend category shown for a state at the chosen uncertainty.
function mapCategory(fips, entry) {
    const est = AppState.currentEstimate;
    if (AppState.mapView === "trend") {
        return est === "lower" ? entry.trend_lower : est === "upper" ? entry.trend_upper : entry.trend_most_likely;
    }
    const raw = est === "lower" ? entry.p10_value : est === "upper" ? entry.p90_value : entry.median_value;
    return classifyActivity(raw, fips) || entry.activity_most_likely;
}

function getColorForFips(fips) {
    const NONE = "url(#no-data-pattern)";
    if (!AppState.currentRefDate) return NONE;
    const view = AppState.mapView;

    if (view === "peak") {
        const p = peakChanceBy(peakWeekData?.[fips]?.[AppState.currentRefDate], mapTargetSat());
        return p == null ? NONE : peakRamp(p);
    }
    const entry = mapEntry(fips);
    if (!entry) return NONE;
    if (view === "onset") {
        if (entry.season_started_observed) return "url(#started-pattern)";
        return entry.onset_prob == null ? NONE : seasonStartColor(entry.onset_prob);
    }
    const colors = view === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    return colors[mapCategory(fips, entry)] || NONE;
}

function getStateColor(d) {
    return getColorForFips(getStateFips(d));
}

function updateMapColors() {
    if (!mapSvg) return;
    mapSvg.selectAll("path.state")
        .transition().duration(300)
        .attr("fill", d => getStateColor(d));
    mapSvg.select(".dc-inset-box")
        .transition().duration(300)
        .attr("fill", getColorForFips("11"));
    updateMapSelection();
    updateMapTitle();
}

function updateMapSelection() {
    const fips = AppState.selectedState;
    const feature = stateFeatures.find(f => getStateFips(f) === fips);
    mapSvg.select(".state-selected").attr("d", feature ? mapPath(feature) : null);
    mapSvg.select(".dc-inset-box").attr("stroke", fips === "11" ? "#1a1a1a" : "#999")
        .attr("stroke-width", fips === "11" ? 2 : 0.5);
    d3.select("#map-us-btn").classed("active", fips === "US");
}

function updateMapTitle() {
    const el = d3.select("#map-title");
    if (el.empty()) return;
    if (!AppState.currentRefDate) {
        el.html(`<span class="map-title-main">No forecasts yet this season</span>`);
        return;
    }
    el.html(`<span class="map-title-main">${MAP_VIEW_TITLES[AppState.mapView]}</span>` +
        `<span class="map-title-week">Week of ${weekRangeText(mapTargetSat())}</span>`);
}

// --- State click: make it the selected location ---
function handleStateClick(event, d) {
    selectLocation(getStateFips(d));
}

// --- Tooltip ---

function handleMouseEnter(event, d) {
    const fips = getStateFips(d);
    const tooltip = d3.select("#tooltip");
    tooltip.selectAll("*").remove();
    tooltip.append("div").attr("class", "tooltip-header").text(fipsToName[fips] || `State ${fips}`);

    const entry = AppState.currentRefDate ? mapEntry(fips) : null;
    const view = AppState.mapView;
    if (!entry && view !== "peak") {
        tooltip.append("div").style("color", "#999").text("No forecast for this week");
    } else if (view === "onset") {
        drawOnsetTooltip(tooltip, entry);
    } else if (view === "peak") {
        drawPeakTooltip(tooltip, peakWeekData?.[fips]?.[AppState.currentRefDate]);
    } else {
        drawCategoryTooltip(tooltip, fips, entry, view);
    }
    tooltip.append("div").attr("class", "tooltip-hint").text("Click to see this state");
    tooltip.classed("visible", true);
    positionTooltip(event);
}

function drawCategoryTooltip(tooltip, fips, entry, type) {
    const probs = type === "trend" ? entry.trend_probs : entry.activity_probs;
    const order = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const selectedCat = mapCategory(fips, entry);

    const chartW = 240, chartH = 110;
    const margin = { top: 8, right: 12, bottom: 30, left: 38 };
    const innerW = chartW - margin.left - margin.right;
    const innerH = chartH - margin.top - margin.bottom;

    const svg = tooltip.append("div").attr("class", "tooltip-chart")
        .append("svg").attr("width", chartW).attr("height", chartH).style("overflow", "visible");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(order).range([0, innerW]).padding(0.2);
    const maxProb = Math.max(0.15, d3.max(order, cat => probs[cat] || 0));
    const y = d3.scaleLinear().domain([0, Math.min(1, maxProb * 1.15)]).range([innerH, 0]);

    [0, 0.25, 0.5, 0.75, 1.0].filter(v => v <= maxProb * 1.2).forEach(v => {
        g.append("line").attr("x1", 0).attr("y1", y(v)).attr("x2", innerW).attr("y2", y(v))
            .attr("stroke", "#eee").attr("stroke-width", 0.5);
        g.append("text").attr("x", -4).attr("y", y(v))
            .attr("text-anchor", "end").attr("dominant-baseline", "middle")
            .attr("font-size", "8px").attr("fill", "#999")
            .text(`${Math.round(v * 100)}%`);
    });

    order.forEach(cat => {
        const prob = probs[cat] || 0;
        const isSelected = cat === selectedCat;
        g.append("rect")
            .attr("x", x(cat)).attr("y", y(prob))
            .attr("width", x.bandwidth()).attr("height", Math.max(0, innerH - y(prob)))
            .attr("fill", colors[cat])
            .attr("stroke", isSelected ? "#1a1a1a" : ((cat === "low" || cat === "stable") ? "#ccc" : "none"))
            .attr("stroke-width", isSelected ? 2 : 0.5)
            .attr("rx", 1);
        if (prob > 0.01) {
            g.append("text").attr("class", "tooltip-bar-value")
                .attr("x", x(cat) + x.bandwidth() / 2).attr("y", y(prob) - 3)
                .attr("text-anchor", "middle")
                .text(`${Math.round(prob * 100)}%`);
        }
    });

    const shortLabels = type === "trend"
        ? { large_decrease: "Lg↓", decrease: "Dec", stable: "Stbl", increase: "Inc", large_increase: "Lg↑" }
        : { low: "Low", moderate: "Med", high: "High", very_high: "V.Hi" };
    order.forEach(cat => {
        g.append("text").attr("class", "tooltip-bar-label")
            .attr("x", x(cat) + x.bandwidth() / 2).attr("y", innerH + 13)
            .attr("text-anchor", "middle")
            .text(shortLabels[cat]);
    });
    g.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", innerH)
        .attr("stroke", "#ddd").attr("stroke-width", 0.5);
}

function drawOnsetTooltip(tooltip, entry) {
    const line = tooltip.append("div").attr("class", "tooltip-sub");
    if (entry.season_started_observed) {
        line.html(`<strong style="color:${SEASON_STARTED_COLOR}">Season started</strong> the week of ${weekRangeText(entry.observed_onset_date)}.`);
    } else if (entry.onset_prob != null) {
        line.html(`<strong>${pctText(entry.onset_prob)}</strong> chance the season has started by ${weekRangeText(mapTargetSat())}.`);
    } else {
        line.text("No season-start forecast for this week.");
    }
}

function drawPeakTooltip(tooltip, pw) {
    const line = tooltip.append("div").attr("class", "tooltip-sub");
    if (!pw) { line.text("No peak-week forecast for this week."); return; }
    const p = peakChanceBy(pw, mapTargetSat());
    line.html(`<strong>${pctText(p)}</strong> chance the peak has happened by ${weekRangeText(mapTargetSat())}.`);
    const w = peakWindow(pw);
    if (w) {
        tooltip.append("div").attr("class", "tooltip-sub")
            .html(`Most likely peak: <strong>${weekRangeText(pw.most_likely.date)}</strong><br>Likely range: ${w.span}`);
    }
}

function handleMouseMove(event) {
    positionTooltip(event);
}

function handleMouseLeave() {
    d3.select("#tooltip").classed("visible", false);
}

function positionTooltip(event) {
    const tooltip = d3.select("#tooltip").node();
    const ttWidth = tooltip.offsetWidth;
    const ttHeight = tooltip.offsetHeight;
    let left = event.clientX + 15;
    let top = event.clientY - 10;
    if (left + ttWidth > window.innerWidth - 10) left = event.clientX - ttWidth - 15;
    if (top + ttHeight > window.innerHeight - 10) top = window.innerHeight - ttHeight - 10;
    if (top < 10) top = 10;
    d3.select("#tooltip").style("left", left + "px").style("top", top + "px");
}
