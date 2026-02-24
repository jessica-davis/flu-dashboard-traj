// US Choropleth Map with rich tooltip bar plots

const MAP_WIDTH = 800;
const MAP_HEIGHT = 500;

let mapSvg, mapPath, stateFeatures;
let fipsToName = {};

function initMap(topoData) {
    mapSvg = d3.select("#us-map")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    stateFeatures = topojson.feature(topoData, topoData.objects.states).features;

    locationsData.forEach(loc => {
        fipsToName[loc.fips] = loc.name;
    });

    const projection = d3.geoAlbersUsa()
        .fitSize([MAP_WIDTH - 40, MAP_HEIGHT - 20], {
            type: "FeatureCollection",
            features: stateFeatures
        });

    mapPath = d3.geoPath().projection(projection);

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

    addDCInset();
}

function addDCInset() {
    const insetX = MAP_WIDTH - 55;
    const insetY = MAP_HEIGHT - 45;
    const boxSize = 16;

    const g = mapSvg.append("g")
        .attr("class", "dc-inset")
        .attr("transform", `translate(${insetX}, ${insetY})`);

    g.append("rect")
        .attr("class", "dc-inset-box state")
        .attr("width", boxSize)
        .attr("height", boxSize)
        .attr("rx", 2)
        .attr("fill", getColorForFips("11") || NO_DATA_COLOR)
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5)
        .attr("cursor", "pointer")
        .datum({ id: 11 })
        .on("mouseenter", handleMouseEnter)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleStateClick);

    g.append("text")
        .attr("class", "dc-inset-label")
        .attr("x", boxSize / 2)
        .attr("y", boxSize + 11)
        .attr("text-anchor", "middle")
        .text("DC");
}

function getStateFips(d) {
    return String(d.id).padStart(2, "0");
}

function getColorForFips(fips) {
    const type = AppState.currentTab;
    const estimate = AppState.currentEstimate;
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;

    const entry = dashboardData.data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return null;

    let category;
    if (type === "trend") {
        category = estimate === "most_likely" ? entry.trend_most_likely
            : estimate === "lower" ? entry.trend_lower
                : entry.trend_upper;
    } else {
        category = estimate === "most_likely" ? entry.activity_most_likely
            : estimate === "lower" ? entry.activity_lower
                : entry.activity_upper;
    }

    const colorMap = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    return colorMap[category] || NO_DATA_COLOR;
}

function getStateColor(d) {
    const fips = getStateFips(d);
    return getColorForFips(fips) || NO_DATA_COLOR;
}

function updateMapColors() {
    mapSvg.selectAll("path.state")
        .transition()
        .duration(300)
        .attr("fill", d => getStateColor(d));

    mapSvg.select(".dc-inset-box")
        .transition()
        .duration(300)
        .attr("fill", getColorForFips("11") || NO_DATA_COLOR);
}

// --- State click → update trajectory chart ---
function handleStateClick(event, d) {
    const fips = getStateFips(d);
    if (typeof setTrajectoryLocation === "function") {
        setTrajectoryLocation(fips);
    }
    // Scroll to trajectory section
    document.getElementById("trajectory-section")?.scrollIntoView({ behavior: "smooth" });
}

// --- Rich Tooltip with Bar Plot PMF ---

function handleMouseEnter(event, d) {
    const fips = getStateFips(d);
    const name = fipsToName[fips] || `State ${fips}`;
    const type = AppState.currentTab;
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.[fips]?.[String(horizon)];

    const tooltip = d3.select("#tooltip");
    tooltip.selectAll("*").remove();

    tooltip.append("div")
        .attr("class", "tooltip-header")
        .text(name);

    if (!entry) {
        tooltip.append("div")
            .style("color", "#999")
            .text("No forecast data available");
        tooltip.classed("visible", true);
        positionTooltip(event);
        return;
    }

    const probs = type === "trend" ? entry.trend_probs : entry.activity_probs;
    const order = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = type === "trend" ? TREND_LABELS : ACTIVITY_LABELS;
    const estimate = AppState.currentEstimate;
    let selectedCat;
    if (type === "trend") {
        selectedCat = estimate === "most_likely" ? entry.trend_most_likely
            : estimate === "lower" ? entry.trend_lower : entry.trend_upper;
    } else {
        selectedCat = estimate === "most_likely" ? entry.activity_most_likely
            : estimate === "lower" ? entry.activity_lower : entry.activity_upper;
    }

    // Build bar plot SVG
    const chartW = 240;
    const chartH = 110;
    const margin = { top: 8, right: 12, bottom: 30, left: 38 };
    const innerW = chartW - margin.left - margin.right;
    const innerH = chartH - margin.top - margin.bottom;

    const svg = tooltip.append("div")
        .attr("class", "tooltip-chart")
        .append("svg")
        .attr("width", chartW)
        .attr("height", chartH)
        .style("overflow", "visible");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
        .domain(order)
        .range([0, innerW])
        .padding(0.2);

    const maxProb = Math.max(0.15, d3.max(order, cat => probs[cat] || 0));
    const y = d3.scaleLinear()
        .domain([0, Math.min(1, maxProb * 1.15)])
        .range([innerH, 0]);

    // Grid lines
    [0, 0.25, 0.5, 0.75, 1.0].filter(v => v <= maxProb * 1.2).forEach(v => {
        g.append("line")
            .attr("x1", 0).attr("y1", y(v))
            .attr("x2", innerW).attr("y2", y(v))
            .attr("stroke", "#eee")
            .attr("stroke-width", 0.5);

        g.append("text")
            .attr("x", -4)
            .attr("y", y(v))
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "8px")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("fill", "#999")
            .text(`${Math.round(v * 100)}%`);
    });

    // Bars
    order.forEach(cat => {
        const prob = probs[cat] || 0;
        const isSelected = cat === selectedCat;
        const needsStroke = (cat === "low" || cat === "stable");

        g.append("rect")
            .attr("x", x(cat))
            .attr("y", y(prob))
            .attr("width", x.bandwidth())
            .attr("height", Math.max(0, innerH - y(prob)))
            .attr("fill", colors[cat])
            .attr("stroke", isSelected ? "#1a1a1a" : (needsStroke ? "#ccc" : "none"))
            .attr("stroke-width", isSelected ? 2 : 0.5)
            .attr("rx", 1);

        if (prob > 0.01) {
            g.append("text")
                .attr("class", "tooltip-bar-value")
                .attr("x", x(cat) + x.bandwidth() / 2)
                .attr("y", y(prob) - 3)
                .attr("text-anchor", "middle")
                .attr("font-family", "Helvetica Neue, Arial, sans-serif")
                .text(`${Math.round(prob * 100)}%`);
        }
    });

    // X-axis labels
    const shortLabels = type === "trend"
        ? { large_decrease: "Lg↓", decrease: "Dec", stable: "Stbl", increase: "Inc", large_increase: "Lg↑" }
        : { low: "Low", moderate: "Med", high: "High", very_high: "V.Hi" };

    order.forEach(cat => {
        g.append("text")
            .attr("class", "tooltip-bar-label")
            .attr("x", x(cat) + x.bandwidth() / 2)
            .attr("y", innerH + 13)
            .attr("text-anchor", "middle")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .text(shortLabels[cat]);
    });

    // Y-axis line
    g.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", 0).attr("y2", innerH)
        .attr("stroke", "#ddd")
        .attr("stroke-width", 0.5);

    tooltip.classed("visible", true);
    positionTooltip(event);
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
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let left = event.clientX + 15;
    let top = event.clientY - 10;

    if (left + ttWidth > viewW - 10) {
        left = event.clientX - ttWidth - 15;
    }
    if (top + ttHeight > viewH - 10) {
        top = viewH - ttHeight - 10;
    }
    if (top < 10) top = 10;

    d3.select("#tooltip")
        .style("left", left + "px")
        .style("top", top + "px");
}
