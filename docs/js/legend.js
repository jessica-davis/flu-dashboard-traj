// Color bar legend component

function initLegend() {
    updateLegend();
}

function updateLegend() {
    const container = d3.select("#legend");
    container.selectAll("*").remove();

    const type = AppState.currentTab;
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
