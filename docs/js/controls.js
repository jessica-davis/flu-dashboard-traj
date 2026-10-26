// Controls: the two tabs, "Show all chances" toggles, the forecast-week
// buttons, the map's Uncertainty buttons, and choosing which gauge the map
// shows (click a gauge; switching tabs maps that tab's first gauge).

function initControls() {
    initTabs();
    initSpreadToggles();
    initGaugeMapping();
    initEstimateButtons();
    buildDateButtons();
}

// --- Tabs -----------------------------------------------------------------

const TAB_FIRST_VIEW = { now: "activity", season: "onset" };

function initTabs() {
    d3.selectAll("#tab-bar .tab").on("click", function () {
        selectTab(d3.select(this).attr("data-tab"));
    });
    showTab(AppState.currentPage);
}

function showTab(page) {
    d3.selectAll("#tab-bar .tab").classed("active", function () { return this.dataset.tab === page; });
    d3.selectAll(".summary-pane").classed("active", function () { return this.dataset.tab === page; });
}

function selectTab(page) {
    AppState.currentPage = page;
    showTab(page);
    setMapView(TAB_FIRST_VIEW[page]);
}

// --- Which gauge the map shows ------------------------------------------------

function initGaugeMapping() {
    d3.selectAll(".gauge-row").on("click", function (event) {
        // Buttons inside the gauge ("?", "Show all chances") keep their own job.
        if (event.target.closest("button")) return;
        setMapView(this.dataset.view);
    });
}

function setMapView(view) {
    AppState.mapView = view;
    AppState.currentTab = view;   // the chart emphasises the same measure
    updateRateToggleVisibility();
    if (typeof applyTabDefaults === "function") applyTabDefaults(view);
    updateAll();
    if (typeof drawTrajectories === "function") drawTrajectories();
}

// --- Map uncertainty ----------------------------------------------------------

function initEstimateButtons() {
    d3.selectAll(".estimate-seg").on("click", function () {
        AppState.currentEstimate = d3.select(this).attr("data-estimate");
        d3.selectAll(".estimate-seg").classed("active", false);
        d3.select(this).classed("active", true);
        updateAll();
    });
    updateRateToggleVisibility();
}

// The Uncertainty buttons apply to the category maps (activity, trend); the
// season-start and peak maps show a single chance.
function updateRateToggleVisibility() {
    const group = document.getElementById("estimate-group");
    if (group) group.style.display = (AppState.mapView === "activity" || AppState.mapView === "trend") ? "" : "none";
}

// --- "Show all chances" ------------------------------------------------------

function initSpreadToggles() {
    d3.selectAll(".spread-toggle").on("click", function () {
        const btn = this;
        const bars = btn.closest(".gauge-row").querySelector(".panel-bars");
        const open = bars.hasAttribute("hidden");
        if (open) bars.removeAttribute("hidden"); else bars.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.innerHTML = open ? "Hide all chances &#9652;" : "Show all chances &#9662;";
    });
}

// --- Forecast week ----------------------------------------------------------

function buildDateButtons() {
    const refDate = AppState.currentRefDate;
    const container = d3.select("#date-buttons");
    container.selectAll("*").remove();
    if (!refDate) return;  // no forecasts for this season yet

    for (let h = 0; h <= 3; h++) {
        const targetSat = new Date(refDate + "T00:00:00");
        targetSat.setDate(targetSat.getDate() + h * 7);
        const targetSun = new Date(targetSat);
        targetSun.setDate(targetSun.getDate() - 6);
        const dateRange = `${formatShortDate(targetSun)}–${formatShortDate(targetSat)}`;
        const label = targetSun.getMonth() === targetSat.getMonth()
            ? `${formatShortDate(targetSun)}–${targetSat.getDate()}`
            : dateRange;

        const btn = container.append("button")
            .attr("class", `seg-btn${h === AppState.currentHorizon ? " active" : ""}`)
            .attr("data-horizon", h)
            .attr("title", `Week ${h + 1} of the forecast: ${dateRange}`)
            .on("click", function () {
                AppState.currentHorizon = +d3.select(this).attr("data-horizon");
                container.selectAll(".seg-btn").classed("active", false);
                d3.select(this).classed("active", true);
                updateAll();
                if (typeof drawTrajectories === "function") drawTrajectories();  // moves the week marker
            });
        btn.append("span").attr("class", "date-range").text(label);
        btn.append("span").attr("class", "date-label").text(`Wk ${h + 1}`);
    }
}

function formatShortDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}
