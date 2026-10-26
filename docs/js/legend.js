// Map legend (vertical, left of the map) for the gauge the map shows.

function initLegend() {
    updateLegend();
}

function updateLegend() {
    const container = d3.select("#legend");
    container.selectAll("*").remove();
    const view = AppState.mapView;

    if (view === "onset") {
        drawGradientLegend(container, "onset-grad", seasonStartColor, "Chance started", "100%", "0%",
            { color: SEASON_STARTED_COLOR, label: "Started (reported)" });
    } else if (view === "peak") {
        drawGradientLegend(container, "peak-grad", peakRamp, "Chance peak passed", "100%", "0%");
    } else {
        drawCategoryLegend(container, view);
    }
}

function legendSwatch(g, y, fill, label, stroke) {
    g.append("rect").attr("x", 0).attr("y", y).attr("width", 16).attr("height", 12).attr("rx", 2)
        .attr("fill", fill).attr("stroke", stroke || "none").attr("stroke-width", 0.5);
    g.append("text").attr("x", 22).attr("y", y + 6).attr("dominant-baseline", "central")
        .attr("font-size", "11px").attr("fill", "#666").text(label);
}

function drawCategoryLegend(container, view) {
    const order = view === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = view === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = view === "trend" ? TREND_LABELS : ACTIVITY_LABELS;
    const rowH = 15;
    const svg = container.append("svg").attr("width", 140).attr("height", (order.length + 1) * rowH + 4);
    const g = svg.append("g").attr("transform", "translate(2, 2)");
    order.forEach((cat, i) => {
        legendSwatch(g, i * rowH, colors[cat], labels[cat], (cat === "low" || cat === "stable") ? "#ccc" : null);
    });
    legendSwatch(g, order.length * rowH, "url(#no-data-pattern)", "No forecast", "#ccc");
}

// A vertical 0->1 gradient bar with a title, end labels and optional extra swatch.
function drawGradientLegend(container, gid, colorOf, title, topLabel, botLabel, extra) {
    const barW = 16, gradientH = 70;
    const svg = container.append("svg").attr("width", 140).attr("height", gradientH + 60);
    const g = svg.append("g").attr("transform", "translate(2, 14)");
    const grad = g.append("defs").append("linearGradient").attr("id", gid)
        .attr("x1", "0%").attr("x2", "0%").attr("y1", "100%").attr("y2", "0%");
    for (let i = 0; i <= 10; i++) {
        grad.append("stop").attr("offset", `${i * 10}%`).attr("stop-color", colorOf(i / 10));
    }
    g.append("text").attr("x", 0).attr("y", -4).attr("font-size", "10px").attr("font-weight", "600")
        .attr("fill", "#666").text(title);
    g.append("rect").attr("y", 2).attr("width", barW).attr("height", gradientH).attr("rx", 2)
        .attr("fill", `url(#${gid})`).attr("stroke", "#ccc").attr("stroke-width", 0.5);
    g.append("text").attr("x", barW + 5).attr("y", 6).attr("dominant-baseline", "hanging")
        .attr("font-size", "10px").attr("fill", "#666").text(topLabel);
    g.append("text").attr("x", barW + 5).attr("y", gradientH + 2)
        .attr("font-size", "10px").attr("fill", "#666").text(botLabel);
    let y = gradientH + 10;
    if (extra) { legendSwatch(g, y, extra.color, extra.label); y += 15; }
    legendSwatch(g, y, "url(#no-data-pattern)", "No forecast", "#ccc");
}
