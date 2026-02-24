// Color bar legend component

function initLegend() {
    updateLegend();
}

function updateLegend() {
    const container = d3.select("#legend");
    container.selectAll("*").remove();

    const type = AppState.currentTab;

    if (type === "admissions") {
        drawAdmissionsLegend(container);
        return;
    }

    const order = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = type === "trend" ? TREND_LABELS : ACTIVITY_LABELS;

    const boxWidth = 80;
    const boxHeight = 12;
    const gap = 2;
    const totalWidth = order.length * (boxWidth + gap) - gap;
    const svgWidth = totalWidth + 20;
    const svgHeight = 36;

    const svg = container.append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    const g = svg.append("g")
        .attr("transform", `translate(${(svgWidth - totalWidth) / 2}, 4)`);

    order.forEach((cat, i) => {
        const x = i * (boxWidth + gap);

        // Determine if we need a stroke for very light colors
        const needsStroke = (cat === "low" || cat === "stable" || cat === "minimal");

        g.append("rect")
            .attr("x", x)
            .attr("y", 0)
            .attr("width", boxWidth)
            .attr("height", boxHeight)
            .attr("fill", colors[cat])
            .attr("stroke", needsStroke ? "#ccc" : "none")
            .attr("stroke-width", 0.5)
            .attr("rx", 2);

        g.append("text")
            .attr("x", x + boxWidth / 2)
            .attr("y", boxHeight + 12)
            .attr("text-anchor", "middle")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "10px")
            .attr("fill", "#666")
            .text(labels[cat]);
    });
}

function drawAdmissionsLegend(container) {
    // Use the same scale as the map (p90-based, consistent across estimates)
    const scale = getAdmissionsColorScale();
    const maxVal = scale.domain()[1];

    const isPerCap = AppState.admissionsRate === "percapita";
    const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
    const unitLabel = isPerCap ? "Per 100k" : "Hospitalizations";

    const gradientW = 300;
    const svgWidth = gradientW + 60;
    const svgHeight = 36;

    const svg = container.append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "admissions-gradient")
        .attr("x1", "0%").attr("x2", "100%");

    const nStops = 10;
    for (let i = 0; i <= nStops; i++) {
        const t = i / nStops;
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", scale(t * maxVal));
    }

    const g = svg.append("g")
        .attr("transform", `translate(${(svgWidth - gradientW) / 2}, 4)`);

    g.append("rect")
        .attr("width", gradientW)
        .attr("height", 12)
        .attr("rx", 2)
        .attr("fill", "url(#admissions-gradient)")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.5);

    g.append("text")
        .attr("x", 0)
        .attr("y", 24)
        .attr("text-anchor", "start")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text("0");

    g.append("text")
        .attr("x", gradientW)
        .attr("y", 24)
        .attr("text-anchor", "end")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(fmt(maxVal));

    g.append("text")
        .attr("x", gradientW / 2)
        .attr("y", 24)
        .attr("text-anchor", "middle")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(unitLabel);
}
