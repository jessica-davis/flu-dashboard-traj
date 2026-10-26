// Main entry point — app state, data loading, initialization

const DEFAULT_LOCATION = "US";

const AppState = {
    currentSeason: null,      // e.g. "2026-27" (see season.js)
    surveillanceOnly: false,  // true when the season has no forecasts yet
    currentPage: "now",       // tab: "now" (activity, trend) | "season" (onset, peak)
    mapView: "activity",      // gauge the map is colored by
    currentTab: "activity",   // chart emphasis; follows mapView
    currentEstimate: "most_likely",
    currentRefDate: null,
    // Date the "Data as reported" snapshot is taken as of. null follows
    // the selected forecast; clicking the chart sets it to any week.
    vintageAsOf: null,
    currentHorizon: 0,
    selectedState: DEFAULT_LOCATION,
};

let dashboardData = null;
let locationsData = null;
let topoData = null;
let targetDataAll = null;
let activityThresholds = null;
let peakWeekData = null;

async function init() {
    try {
        // Resolve the active season (from ?season= or the manifest default)
        // and wire the header dropdown before loading per-season data.
        await bootSeasonHeader();
        const season = seasonMeta.name;
        AppState.currentSeason = season;
        AppState.surveillanceOnly = !seasonMeta.has_forecasts;

        const [dd, ld, td, tgt, at, pw] = await Promise.all([
            d3.json(seasonDataPath(season, "dashboard_data.json")).catch(() => null),
            d3.json(dataUrl("data/locations.json")),
            d3.json("data/us-states.json"),
            d3.json(dataUrl("data/target_data.json")),
            d3.json(dataUrl("data/activity_thresholds.json")),
            d3.json(seasonDataPath(season, "peak_week.json")).catch(() => null),
        ]);

        dashboardData = dd || { reference_dates: [], data: {}, onset: {} };
        locationsData = ld;
        topoData = td;
        targetDataAll = tgt;
        activityThresholds = at;
        peakWeekData = pw;

        AppState.currentRefDate = dashboardData.most_recent_reference_date || null;
        if (!AppState.currentRefDate) AppState.surveillanceOnly = true;

        initControls();
        initRefDateDropdown();
        initPanels();
        initMap(topoData);
        initLegend();
        initTrajectoryChart();
        initInfoButtons();

        if (AppState.surveillanceOnly) applyNoForecastLayout();

        updateLastUpdatedLabel();
        updateAll();

    } catch (err) {
        console.error("Failed to load dashboard data:", err);
        document.body.innerHTML = `
            <div style="padding:40px;text-align:center;font-family:sans-serif;color:#c00">
                <h2>Error loading dashboard</h2>
                <p>${err.message}</p>
                <p>Make sure to serve this directory with a local web server.</p>
            </div>`;
    }
}

// A season whose forecasts have not started. The page keeps the same shape as
// a season with forecasts and each gauge explains what is missing.
function applyNoForecastLayout() {
    document.body.classList.add("no-forecast");

    const prev = latestSeasonWithForecasts(seasonManifest, seasonMeta.name);
    const through = seasonMeta.observed_through;
    const lines = {
        activity: "Activity level forecasts will appear here once the season's first forecast is issued.",
        trend: "Trend forecasts (decrease, stable or increase) will appear here once forecasting begins.",
        onset: "The chance the season has started will appear here once forecasting begins.",
        peak: "Peak-week estimates will appear here once forecasting begins.",
    };
    Object.entries(lines).forEach(([view, text]) => {
        const p = document.getElementById(`sentence-${view}`);
        if (p) p.innerHTML = `<span class="panel-empty-line">${text}</span>`;
    });
    const first = document.getElementById("sentence-activity");
    if (first) {
        first.innerHTML =
            `<strong>No forecast yet for ${seasonMeta.name}.</strong> ${lines.activity}` +
            (through ? ` Surveillance data through ${formatLongDateStr(through)}.` : "") +
            (prev ? ` <a href="index.html?season=${encodeURIComponent(prev.name)}">View the ${prev.name} season</a>.` : "");
    }
    if (typeof setForecastControlsEnabled === "function") setForecastControlsEnabled(false);
    const tourBtn = document.getElementById("tour-btn");
    if (tourBtn) tourBtn.style.display = "none";
}

function updateAll() {
    updateMapColors();
    updateLegend();
    if (AppState.surveillanceOnly) return;  // the panels need a reference date
    updatePanels();
}

// Make `fips` the location the panel and chart describe.
function selectLocation(fips) {
    if (!fips || fips === AppState.selectedState) return;
    AppState.selectedState = fips;
    updateAll();
    setTrajectoryLocation(fips);
}

function updateLastUpdatedLabel() {
    const el = document.getElementById("last-updated");
    if (!el) return;
    if (AppState.surveillanceOnly) {
        const through = seasonMeta?.observed_through;
        el.textContent = through
            ? `  |  Surveillance data through ${formatLongDateStr(through)}`
            : `  |  ${seasonMeta.name} season: no data reported yet`;
        return;
    }
    if (!AppState.currentRefDate) return;
    // Reference date is Saturday; Wednesday of that week is 3 days earlier.
    const refSat = new Date(AppState.currentRefDate + "T00:00:00");
    const wed = new Date(refSat);
    wed.setDate(wed.getDate() - 3);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formatted = `${months[wed.getMonth()]} ${wed.getDate()}, ${wed.getFullYear()}`;
    const isMostRecent = AppState.currentRefDate === dashboardData.most_recent_reference_date;
    const label = isMostRecent ? "Last Updated" : "Forecast issued";
    el.textContent = `  |  ${label}: ${formatted}`;
}

// --- Reference date (previous forecast) dropdown ---------------------------

function initRefDateDropdown() {
    const select = document.getElementById("ref-date-select");
    if (!select) return;

    const dates = [...(dashboardData.reference_dates || [])].sort().reverse();
    select.innerHTML = "";
    if (dates.length === 0) return;  // no forecasts yet; the group is hidden in surveillance mode
    dates.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = i === 0 ? `${d} (most recent)` : d;
        select.appendChild(opt);
    });
    select.value = AppState.currentRefDate;

    select.addEventListener("change", () => {
        AppState.currentRefDate = select.value;
        AppState.vintageAsOf = null;   // snapshot follows the chosen forecast again
        AppState.currentHorizon = 0;
        buildDateButtons();
        updateLastUpdatedLabel();
        updateAll();
        drawTrajectories();
    });
}

// Reset to the most recent forecast for the United States and scroll to top
function jumpToMostRecent() {
    if (!dashboardData?.most_recent_reference_date) return;
    AppState.currentRefDate = dashboardData.most_recent_reference_date;
    AppState.vintageAsOf = null;
    AppState.currentHorizon = 0;
    AppState.currentEstimate = "most_likely";
    AppState.currentPage = "now";
    d3.selectAll(".estimate-seg").classed("active", function () { return this.dataset.estimate === "most_likely"; });
    showTab("now");

    const select = document.getElementById("ref-date-select");
    if (select) select.value = AppState.currentRefDate;

    buildDateButtons();
    updateLastUpdatedLabel();
    const moved = AppState.selectedState !== DEFAULT_LOCATION;
    AppState.selectedState = DEFAULT_LOCATION;
    setMapView("activity");
    if (moved) setTrajectoryLocation(DEFAULT_LOCATION);

    window.scrollTo({ top: 0, behavior: "smooth" });
}

init();
