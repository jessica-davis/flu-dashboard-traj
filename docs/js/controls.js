// Controls: tabs, estimate buttons, date selector

function initControls() {
    initTabs();
    initEstimateButtons();
    buildDateButtons();
}

function initTabs() {
    d3.selectAll(".tab").on("click", function () {
        const tab = d3.select(this).attr("data-tab");
        AppState.currentTab = tab;
        d3.selectAll(".tab").classed("active", false);
        d3.select(this).classed("active", true);
        updateAll();
    });
}

function initEstimateButtons() {
    d3.selectAll(".estimate-btn").on("click", function () {
        const est = d3.select(this).attr("data-estimate");
        AppState.currentEstimate = est;
        d3.selectAll(".estimate-btn").classed("active", false);
        d3.select(this).classed("active", true);
        updateAll();
    });
}

function buildDateButtons() {
    const refDate = AppState.currentRefDate;
    const container = d3.select("#date-buttons");
    container.selectAll("*").remove();

    const horizonLabels = ["Current", "+1 Week", "+2 Weeks", "+3 Weeks", "+4 Weeks"];

    for (let h = 0; h <= 4; h++) {
        const targetSat = new Date(refDate + "T00:00:00");
        targetSat.setDate(targetSat.getDate() + h * 7);

        const targetSun = new Date(targetSat);
        targetSun.setDate(targetSun.getDate() - 6);

        const label = horizonLabels[h];
        const dateRange = `${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}`;

        const btn = container.append("button")
            .attr("class", `date-btn${h === 0 ? " active" : ""}`)
            .attr("data-horizon", h)
            .on("click", function () {
                const horizon = +d3.select(this).attr("data-horizon");
                AppState.currentHorizon = horizon;
                d3.selectAll(".date-btn").classed("active", false);
                d3.select(this).classed("active", true);
                updateAll();
            });

        btn.append("div").attr("class", "date-label").text(label);
        btn.append("div").attr("class", "date-range").text(dateRange);
    }
}

function formatShortDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}
