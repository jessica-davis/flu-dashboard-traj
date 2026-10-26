// Time series for the selected location: observed admissions, the forecast
// bands, optional individual trajectories, and context layers (activity
// levels, previous seasons, data as reported).

// The chart spans the full card width below the map and summary panel.
const TRAJ_WIDTH = 1100;
const TRAJ_HEIGHT = 420;
const TRAJ_MARGIN = { top: 20, right: 30, bottom: 38, left: 60 };
const TRAJ_FONT = "Libre Franklin, Helvetica Neue, Arial, sans-serif";
const TRAJ_FONT_SIZE = "12px";

// The chart's x-axis starts at the active season's start date (seasonMeta.start,
// from data/seasons.json) for every forecast, so the time axis is comparable
// across reference dates. Observed data is clipped to the season window.
function trajSeasonStart() { return new Date(seasonMeta.start + "T00:00:00"); }

// Left edge of the x-axis, the same rule for every season and forecast: the
// manifest's chart_start (mid-October), moved earlier when needed so at least
// TRAJ_MIN_CONTEXT_WEEKS of reported data show before the forecast date, and
// never before the season start. "Show full season" starts at the season start.
const TRAJ_MIN_CONTEXT_WEEKS = 8;
function trajChartStart(observedParsed, refDate) {
    const seasonStart = trajSeasonStart();
    if (showFullSeason || !seasonMeta.chart_start) return seasonStart;
    let start = new Date(seasonMeta.chart_start + "T00:00:00");
    const anchor = refDate
        ? new Date(refDate + "T00:00:00")
        : (observedParsed.length ? observedParsed[observedParsed.length - 1].date : start);
    const context = new Date(anchor); context.setDate(context.getDate() - 7 * TRAJ_MIN_CONTEXT_WEEKS);
    if (context < start) start = context;
    return start < seasonStart ? seasonStart : start;
}
function trajSeasonEnd()   { return new Date(seasonMeta.end + "T00:00:00"); }

// Minimum x-axis span (weeks past season start) when there are no forecasts to
// extend the axis — keeps a season with one or two observed weeks legible.
const TRAJ_MIN_WEEKS = 12;

let trajSvg, trajX, trajY, trajChartG;
let trajData = null;
let historicalSeasons = null;
let baselineData = null;       // baseline_boston.json — median + 90% PI per ref_date
let showBaseline = false;

// "Data as reported": the observed series as it was reported when the selected
// forecast was made (seasons/{season}/vintages/{fips}.json, built from the
// FluSight hub's as_of snapshots). Loaded per location.
let vintageData = {};   // fips -> {pulled: [...], data: {as_of: [{date, value}]}} | null
let showVintage = false;
const VINTAGE_COLOR = "#D65F00";

// Individual trajectories drawn under the bands (0 = none).
const TRAJ_SLIDER_VALUES = [0, 10, 25, 50, 100, 200];
let trajLineCount = 0;
const TRAJ_LINE_COLOR = "#3A7BA0";

// The snapshot as of a date: the latest data pull on or before it.
// Returns {pulled, series} or null.
function vintageAsOfDate(loc, asOf) {
    const v = vintageData[loc];
    if (!v || !asOf) return null;
    const pulls = (v.pulled || []).filter(p => p <= asOf && v.data?.[p]);
    if (!pulls.length) return null;
    const pulled = pulls[pulls.length - 1];
    return { pulled, series: v.data[pulled] };
}

async function loadVintages(loc) {
    if (loc in vintageData) return;
    try {
        vintageData[loc] = await d3.json(seasonDataPath(AppState.currentSeason, `vintages/${loc}.json`));
    } catch {
        vintageData[loc] = null;
    }
}

// Which date the snapshot is taken as of. Follows the selected forecast by
// default, but clicking the chart sets it independently so the surveillance
// snapshot can be moved to any week — including weeks with no forecast, such
// as the off-season or a season that has not started forecasting yet.
function currentVintageAsOf() {
    return AppState.vintageAsOf
        || AppState.currentRefDate
        || seasonMeta?.observed_through
        || null;
}


// Context panel state. contextSeasons is filled from the manifest's previous
// seasons (see rebuildContextSeasons) once historical_seasons.json has loaded.
let contextSeasons = {};
let showSeasons = false;
// "Show full season": stretch both axes so the overlaid previous seasons are
// drawn in full. Off by default, so adding overlays never changes the axes.
let showFullSeason = false;
let showActivityBands = true;   // set per view by applyTabDefaults

// 50% and 90% prediction intervals are shown by default.
let showPI = { "50": true, "90": true, "95": false };

// Names of the seasons before the active one, oldest first (from the manifest).
function previousSeasonNames() {
    return previousSeasons(seasonManifest, seasonMeta).map(s => s.name);
}

// Line style for a previous season: position in the previous-seasons list
// indexes SEASON_PALETTE (colors.js), so the same season keeps its color
// regardless of which season is active.
function seasonStyle(seasonName) {
    const idx = previousSeasonNames().indexOf(seasonName);
    if (idx < 0) return { color: "#ccc", dash: "4,4", width: 2 };
    return SEASON_PALETTE[idx % SEASON_PALETTE.length];
}

// Reset the previous-seasons list for a location: every manifest season before
// the active one that has data in historical_seasons.json, all switched on.
function rebuildContextSeasons(loc) {
    const available = historicalSeasons?.[loc] || {};
    contextSeasons = {};
    previousSeasonNames().forEach(name => {
        if (available[name] && available[name].length) contextSeasons[name] = true;
    });
    buildSeasonsSection();
}

// Neutral slate so the bands stand apart from the green-to-blue activity shading.
const PI_STYLES = {
    "95": { fill: "#B4BCC8", opacity: 0.5, label: "95% PI" },
    "90": { fill: "#7D8798", opacity: 0.5, label: "90% PI" },
    "50": { fill: "#3E4757", opacity: 0.6, label: "50% PI" },
};

let _alignedSeasonData = {};

const trajTooltip = () => d3.select("#traj-tooltip");

function initTrajectoryChart() {
    trajSvg = d3.select("#traj-chart")
        .attr("viewBox", `0 0 ${TRAJ_WIDTH} ${TRAJ_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    trajChartG = trajSvg.append("g")
        .attr("transform", `translate(${TRAJ_MARGIN.left},${TRAJ_MARGIN.top})`);

    // Clip overlays to the plot area: previous-season curves may climb past the
    // y-axis top (the axis is sized to the comparable window, not their peaks).
    const innerW = TRAJ_WIDTH - TRAJ_MARGIN.left - TRAJ_MARGIN.right;
    const innerH = TRAJ_HEIGHT - TRAJ_MARGIN.top - TRAJ_MARGIN.bottom;
    trajChartG.append("clipPath").attr("id", "traj-plot-clip").attr("class", "traj-plot-clip")
        .append("rect").attr("x", 0).attr("y", -TRAJ_MARGIN.top).attr("width", innerW).attr("height", innerH + TRAJ_MARGIN.top);

    trajChartG.append("g").attr("class", "layer-activity-bands");
    trajChartG.append("g").attr("class", "layer-traj-lines").attr("clip-path", "url(#traj-plot-clip)");
    trajChartG.append("g").attr("class", "layer-pi-bands").attr("clip-path", "url(#traj-plot-clip)");
    trajChartG.append("g").attr("class", "layer-seasons").attr("clip-path", "url(#traj-plot-clip)");
    trajChartG.append("g").attr("class", "layer-baseline").attr("clip-path", "url(#traj-plot-clip)");
    // Tab-specific annotations (epidemic threshold, onset marker, peak window).
    trajChartG.append("g").attr("class", "layer-annotations").attr("clip-path", "url(#traj-plot-clip)");
    trajChartG.append("g").attr("class", "layer-axes");
    trajChartG.append("g").attr("class", "layer-interaction");
    trajChartG.append("g").attr("class", "layer-observed");

    // United States first, then states alphabetically.
    const locSelect = d3.select("#traj-location");
    [...locationsData]
        .sort((a, b) => (a.fips === "US" ? -1 : b.fips === "US" ? 1 : a.name.localeCompare(b.name)))
        .forEach(loc => locSelect.append("option").attr("value", loc.fips).text(locationName(loc.fips)));
    locSelect.property("value", AppState.selectedState);
    locSelect.on("change", function () { selectLocation(this.value); });

    initPIControls();
    initTrajSlider();
    initContextPanel();
    applyTabDefaults(AppState.currentTab);

    d3.json(dataUrl("data/historical_seasons.json")).then(hs => {
        historicalSeasons = hs;
        rebuildContextSeasons(AppState.selectedState);
        loadAndDrawTrajectories(AppState.selectedState);
    });
}

function initTrajSlider() {
    const slider = d3.select("#traj-slider");
    if (slider.empty()) return;
    slider.attr("max", TRAJ_SLIDER_VALUES.length - 1).property("value", 0);
    const sync = () => {
        trajLineCount = TRAJ_SLIDER_VALUES[+slider.property("value")];
        d3.select("#traj-slider-value").text(trajLineCount || "None");
    };
    slider.on("input", () => { sync(); drawTrajectories(); });
    sync();
}

// The baseline overlay control was removed from the dashboard; the drawing
// code below stays (showBaseline is never turned on) and the Evaluations page
// keeps its own baseline toggle.

// --- Slider ---------------------------------------------------------------

function syncPIButtons() {
    d3.selectAll("#traj-pi-buttons .traj-pi-btn").each(function () {
        const level = d3.select(this).attr("data-pi");
        d3.select(this).classed("active", !!showPI[level]);
    });
    d3.select("#traj-pi-all").property("checked", Object.values(showPI).some(v => v));
}

// Controls that need a forecast. A season without one keeps them in place so
// the page reads the same, but greys them out.
function setForecastControlsEnabled(enabled) {
    ["#traj-pi-all"].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.disabled = !enabled;
        const group = el.closest(".traj-label");
        if (group) group.classList.toggle("is-disabled", !enabled);
    });
}

function syncActivityControl() {
    d3.select("#ctx-activity-btn").classed("active", showActivityBands);
}

// The selected gauge drives what the chart emphasises:
//   Activity:     activity shading + 50/90% bands.
//   Trend:        bands + median line in the trend color + last-reported level.
//   Season Start / Peak Week: weekly probability shading only (bands off).
function applyTabDefaults(tab) {
    showActivityBands = (tab === "activity");
    showSeasons = false;
    showPI = (tab === "activity" || tab === "trend")
        ? { "50": true, "90": true, "95": false }
        : { "50": false, "90": false, "95": false };
    syncPIButtons();
    syncActivityControl();
    syncSeasonsControl();
}

// --- PI Controls ----------------------------------------------------------

function initPIControls() {
    const container = d3.select("#traj-pi-buttons");
    container.selectAll("*").remove();

    ["50", "90", "95"].forEach(level => {
        const btn = container.append("button")
            .attr("class", "traj-pi-btn" + (showPI[level] ? " active" : ""))
            .attr("data-pi", level)
            .on("click", function () {
                showPI[level] = !showPI[level];
                d3.select(this).classed("active", showPI[level]);
                drawTrajectories();
            });
        btn.append("span")
            .attr("class", "traj-pi-swatch")
            .style("background", PI_STYLES[level].fill)
            .style("opacity", PI_STYLES[level].opacity + 0.3);
        btn.append("span").text(PI_STYLES[level].label);
    });

    // One checkbox turns every interval on or off.
    d3.select("#traj-pi-all").on("change", function () {
        const on = this.checked;
        showPI = { "50": on, "90": on, "95": on };
        syncPIButtons();
        drawTrajectories();
    });
}

// --- Context Panel --------------------------------------------------------

function initContextPanel() {
    // "Activity levels": shade the chart background by activity level.
    d3.select("#ctx-activity-btn").on("click", function () {
        showActivityBands = !showActivityBands;
        syncActivityControl();
        drawTrajectories();
    });

    // "Data at forecast time": overlay the snapshot the forecast was made from.
    d3.select("#ctx-vintage-btn").on("click", function () {
        showVintage = !showVintage;
        d3.select(this).classed("active", showVintage);
        drawTrajectories();
    });

    // "Previous seasons": overlay past seasons; the season pills appear under
    // the chart while it is on.
    d3.select("#ctx-seasons-btn").on("click", function () {
        showSeasons = !showSeasons;
        if (showSeasons) Object.keys(contextSeasons).forEach(s => { contextSeasons[s] = true; });
        syncSeasonsControl();
        drawTrajectories();
    });

    // "Show full season": expand the axes to the whole season.
    d3.select("#ctx-full-season").on("click", function () {
        showFullSeason = !showFullSeason;
        d3.select(this).classed("active", showFullSeason);
        drawTrajectories();
    });

    buildSeasonsSection();
    syncSeasonsControl();
    syncActivityControl();
}

function syncSeasonsControl() {
    d3.select("#ctx-seasons-btn").classed("active", showSeasons);
    d3.select("#ctx-seasons-body").classed("open", showSeasons);
    updateSeasonButtons();
}

function buildSeasonsSection() {
    const body = d3.select("#ctx-seasons-body");
    body.selectAll("*").remove();

    Object.keys(contextSeasons).forEach(season => {
        const style = seasonStyle(season);
        const btn = body.append("button")
            .attr("class", "ctx-season-btn" + (contextSeasons[season] ? " active" : ""))
            .attr("data-season", season)
            .on("click", function () {
                contextSeasons[season] = !contextSeasons[season];
                d3.select(this).classed("active", contextSeasons[season]);
                if (!Object.values(contextSeasons).some(v => v)) {
                    showSeasons = false;
                    syncSeasonsControl();
                }
                drawTrajectories();
            });

        btn.append("span").attr("class", "ctx-season-swatch").style("background", style.color || "#ccc");
        btn.append("span").text(season);
    });

}

function updateSeasonButtons() {
    d3.selectAll(".ctx-season-btn").each(function () {
        const season = d3.select(this).attr("data-season");
        d3.select(this).classed("active", contextSeasons[season]);
    });
}

// --- Main draw ------------------------------------------------------------

let _trajLoc = null;   // location trajData belongs to

async function loadAndDrawTrajectories(loc) {
    const [traj] = await Promise.all([
        d3.json(seasonDataPath(AppState.currentSeason, `trajectories/${loc}.json`)).catch(() => null),
        loadVintages(loc),
    ]);
    if (loc !== AppState.selectedState) return;   // another location was picked meanwhile
    trajData = traj;
    _trajLoc = loc;
    drawTrajectories();
}

function setTrajectoryLocation(loc) {
    d3.select("#traj-location").property("value", loc);
    if (historicalSeasons) rebuildContextSeasons(loc);
    loadAndDrawTrajectories(loc);
}

function drawTrajectories() {
    if (!trajChartG) return;
    const loc = AppState.selectedState;
    if (_trajLoc !== loc) trajData = null;   // still loading this location

    const innerW = TRAJ_WIDTH - TRAJ_MARGIN.left - TRAJ_MARGIN.right;
    const innerH = TRAJ_HEIGHT - TRAJ_MARGIN.top - TRAJ_MARGIN.bottom;

    const observed = targetDataAll?.[loc] || [];
    const observedParsed = observed
        .filter(d => d.value != null)
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value }));

    const refDate = AppState.currentRefDate;               // null when the season has no forecasts
    const refDateObj = refDate ? new Date(refDate + "T00:00:00") : null;

    // Window: the active season's start through the last forecast date, so
    // every forecast's x-axis begins on the same date. Observed data outside
    // the season window is not shown.
    const seasonEnd = trajSeasonEnd();
    const refTrajData = refDate ? trajData?.data?.[refDate] : null;
    const showFrom = trajChartStart(observedParsed, refTrajData ? refDate : null);
    const refDates = dashboardData.reference_dates || [];

    const maxHorizons = 4;

    // Observed data is shown from the season start through the last week of
    // the selected forecast (so the chart ends where the forecast ends).
    // With no forecast, or with "Show full season" on, the whole season's
    // observations are shown.
    let showThrough = seasonEnd;
    if (refTrajData && !showFullSeason) {
        const lastForecastDate = refTrajData.dates[Math.min(maxHorizons, refTrajData.dates.length) - 1];
        showThrough = new Date(lastForecastDate + "T00:00:00");
    }
    const recentObserved = observedParsed.filter(d => d.date >= showFrom && d.date <= showThrough);

    // --- x-axis: season start through the selected forecast's last week ---
    let allDates = recentObserved.map(d => d.date);
    allDates.push(showFrom);

    if (!refTrajData) {
        // No forecast to extend the axis: pad past the last observed week, with
        // a minimum span so a season with one or two points is still legible.
        const lastObs = recentObserved.length ? recentObserved[recentObserved.length - 1].date : showFrom;
        const padded = new Date(lastObs); padded.setDate(padded.getDate() + 7);
        const minimum = new Date(showFrom); minimum.setDate(minimum.getDate() + 7 * TRAJ_MIN_WEEKS);
        allDates.push(padded > minimum ? padded : minimum);
    } else {
        const trajDates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(trajDates);
    }

    // --- y-axis: fits what is drawn — the observed weeks on screen, the
    // selected forecast's visible prediction intervals, the baseline if on,
    // and any overlays. ---
    let allValues = recentObserved.map(d => d.value);

    if (refTrajData) {
        const piUpperKeys = [];
        if (showPI["95"]) piUpperKeys.push("p975");
        if (showPI["90"]) piUpperKeys.push("p95");
        if (showPI["50"]) piUpperKeys.push("p75");
        piUpperKeys.forEach(k => (refTrajData.quantiles?.[k] || []).slice(0, maxHorizons).forEach(v => {
            if (v != null) allValues.push(v);
        }));
    }

    if (showBaseline && baselineData?.data?.[refDate]) {
        baselineData.data[refDate].p95.slice(0, maxHorizons).forEach(v => { if (v != null) allValues.push(v); });
    }

    // Snapshot of the data as reported when the forecast was made.
    const vintage = showVintage ? vintageAsOfDate(loc, currentVintageAsOf()) : null;
    const vintageSeries = vintage
        ? vintage.series.filter(d => d.value != null)
            .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value, partial: !!d.partial }))
            .filter(d => d.date >= showFrom && d.date <= showThrough)
        : [];
    vintageSeries.forEach(d => allValues.push(d.value));

    // Right edge of the visible x-window: overlay values beyond it are clipped
    // and don't count toward the y-axis.
    const seasonXEnd = d3.max(allDates);

    _alignedSeasonData = {};
    if (showSeasons && historicalSeasons?.[loc]) {
        // Align each previous season onto the active season's calendar by week
        // index (weeks since that season's start; see write_historical_seasons).
        const currentSeasonStart = trajSeasonStart();
        Object.keys(historicalSeasons[loc]).forEach(sName => {
            if (!contextSeasons[sName]) return;
            const season = historicalSeasons[loc][sName];
            _alignedSeasonData[sName] = season
                .filter(d => d.value != null)
                .map(d => {
                    const aligned = new Date(currentSeasonStart);
                    aligned.setDate(aligned.getDate() + d.week * 7);
                    return { date: aligned, value: d.value };
                })
                .filter(d => d.date >= showFrom && d.date <= seasonEnd);
        });

        if (showFullSeason) {
            // "Show full season": both axes expand to fit the whole overlaid curves.
            Object.values(_alignedSeasonData).forEach(line => line.forEach(d => {
                allDates.push(d.date);
                allValues.push(d.value);
            }));
        } else {
            // Adding overlays does not move the x-axis (curves are clipped at
            // the right edge), and only overlay values up to the season's fixed
            // right edge count toward the y-axis, so previous seasons' later
            // peaks don't flatten the current data against the bottom.
            Object.values(_alignedSeasonData).forEach(line => line.forEach(d => {
                if (d.date <= seasonXEnd) allValues.push(d.value);
            }));
        }
    }

    // Activity bands only stretch the y-axis (to show every level) when
    // "Show full season" is on; otherwise the bands fill whatever range the
    // data sets and higher levels are simply off the top.
    if (showActivityBands && showFullSeason && activityThresholds?.[loc]) {
        allValues.push(activityThresholds[loc].very_high);
    }

    // Tab annotations that must fit on the y-axis.
    const tab = AppState.currentTab;
    if (tab === "onset" && activityThresholds?.[loc]?.epidemic != null) {
        allValues.push(activityThresholds[loc].epidemic * 1.15);   // room for the label
    }
    if (tab === "peak") {
        const op = peakWeekData?._observed_peak?.[loc];
        if (op) {
            const opDate = new Date(op.date + "T00:00:00");
            if (opDate >= showFrom && opDate <= showThrough) allValues.push(op.value * 1.12);
        }
    }

    if (allDates.length === 0) return;

    trajX = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
    const yMax = d3.max(allValues) || 1;
    trajY = d3.scaleLinear().domain([0, yMax * 1.05]).range([innerH, 0]);

    drawActivityBands(loc, innerW, innerH);
    const lastReported = refDateObj ? observedParsed.filter(d => d.date < refDateObj).slice(-1)[0] : null;
    drawTabAnnotations(tab, loc, refDate, refTrajData, showThrough, maxHorizons, innerW, innerH, lastReported);
    drawTrajLines(refTrajData, maxHorizons);
    drawPIBands(refTrajData, maxHorizons, innerW, innerH);
    drawBaselineOverlay(refDate, maxHorizons);

    // --- Axes ---
    const axesG = trajChartG.select(".layer-axes");
    axesG.selectAll("*").remove();
    axesG.append("g").attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(trajX).ticks(8).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text").attr("font-family", TRAJ_FONT).attr("font-size", TRAJ_FONT_SIZE);
    axesG.append("g")
        .call(d3.axisLeft(trajY).ticks(6).tickFormat(d3.format(",.0f")))
        .selectAll("text").attr("font-family", TRAJ_FONT).attr("font-size", TRAJ_FONT_SIZE);
    axesG.append("text")
        .attr("transform", "rotate(-90)").attr("x", -innerH / 2).attr("y", -48)
        .attr("text-anchor", "middle").attr("font-family", TRAJ_FONT).attr("font-size", TRAJ_FONT_SIZE)
        .attr("fill", "#666").text("Weekly Hospital Admissions");

    // --- Historical seasons ---
    const seasonsG = trajChartG.select(".layer-seasons");
    seasonsG.selectAll("*").remove();

    if (showSeasons) {
        Object.entries(_alignedSeasonData).forEach(([sName, lineData]) => {
            if (lineData.length < 2) return;
            const style = seasonStyle(sName);
            const line = d3.line()
                .x(d => trajX(d.date)).y(d => trajY(d.value)).defined(d => d.value != null);
            seasonsG.append("path")
                .datum(lineData).attr("d", line)
                .attr("fill", "none").attr("stroke", style.color)
                .attr("stroke-width", style.width).attr("stroke-dasharray", style.dash)
                .attr("opacity", 0.7);

            // Label at the last point still inside the plot area (the curve may
            // have climbed off the top of the y-axis).
            const [xMin, xMax] = trajX.domain();
            const yTop = trajY.domain()[1];
            const visible = lineData.filter(d => d.value <= yTop && d.date >= xMin && d.date <= xMax);
            const last = visible.length ? visible[visible.length - 1] : lineData[lineData.length - 1];
            seasonsG.append("text")
                .attr("x", trajX(last.date) + 4).attr("y", trajY(last.value))
                .attr("font-family", TRAJ_FONT).attr("font-size", TRAJ_FONT_SIZE)
                .attr("fill", style.color).attr("dominant-baseline", "middle")
                .attr("font-weight", "600").text(sName);
        });
    }

    // --- Observed line ---
    const obsG = trajChartG.select(".layer-observed");
    obsG.selectAll("*").remove();

    // Without a reference date (no forecasts yet) every observed week is "in sample".
    const inSample = refDateObj ? recentObserved.filter(d => d.date < refDateObj) : recentObserved;
    const outOfSample = refDateObj ? recentObserved.filter(d => d.date >= refDateObj) : [];

    if (recentObserved.length > 0) {
        const line = d3.line().x(d => trajX(d.date)).y(d => trajY(d.value));
        // Solid line through the weeks known when the forecast was issued;
        // dashed line through the weeks observed afterwards (out of sample).
        // The dashed segment starts at the last in-sample point so there is no gap.
        const outSegment = inSample.length
            ? [inSample[inSample.length - 1]].concat(outOfSample)
            : outOfSample;
        if (inSample.length > 1) {
            obsG.append("path")
                .datum(inSample).attr("d", line)
                .attr("fill", "none").attr("stroke", "#1a1a1a").attr("stroke-width", 2);
        }
        if (outSegment.length > 1) {
            obsG.append("path")
                .datum(outSegment).attr("d", line)
                .attr("fill", "none").attr("stroke", "#1a1a1a").attr("stroke-width", 2)
                .attr("stroke-dasharray", "5,4");
        }

        obsG.selectAll(".obs-in").data(inSample).join("circle")
            .attr("class", "obs-in")
            .attr("cx", d => trajX(d.date)).attr("cy", d => trajY(d.value))
            .attr("r", 3.5).attr("fill", "#1a1a1a")
            .style("pointer-events", "none");

        obsG.selectAll(".obs-out").data(outOfSample).join("circle")
            .attr("class", "obs-out")
            .attr("cx", d => trajX(d.date)).attr("cy", d => trajY(d.value))
            .attr("r", 3.5).attr("fill", "#fff")
            .attr("stroke", "#1a1a1a").attr("stroke-width", 1.5)
            .style("pointer-events", "none");
    }

    // Data as reported at forecast time, drawn ON TOP of the final series so
    // the whole as-reported line is visible. Where the two agree (most weeks)
    // the orange covers the black; where a week was later revised the black
    // line separates from it.
    if (vintageSeries.length > 0) {
        const vLine = d3.line().x(d => trajX(d.date)).y(d => trajY(d.value));
        const vDone = vintageSeries.filter(d => !d.partial);
        const vPart = vintageSeries.filter(d => d.partial);

        if (vDone.length > 1) {
            obsG.append("path").datum(vDone).attr("d", vLine)
                .attr("fill", "none").attr("stroke", VINTAGE_COLOR).attr("stroke-width", 2);
        }
        obsG.selectAll(".obs-vintage").data(vDone).join("circle")
            .attr("class", "obs-vintage")
            .attr("cx", d => trajX(d.date)).attr("cy", d => trajY(d.value))
            .attr("r", 3.5).attr("fill", VINTAGE_COLOR)
            .style("pointer-events", "none");

        // The week that had not finished when the data were pulled: dashed,
        // hollow and labelled, so its part-counted value never reads as a drop.
        if (vPart.length) {
            const seg = (vDone.length ? [vDone[vDone.length - 1]] : []).concat(vPart);
            if (seg.length > 1) {
                obsG.append("path").datum(seg).attr("d", vLine)
                    .attr("fill", "none").attr("stroke", VINTAGE_COLOR)
                    .attr("stroke-width", 2).attr("stroke-dasharray", "4,3").attr("opacity", 0.75);
            }
            obsG.selectAll(".obs-vintage-part").data(vPart).join("circle")
                .attr("class", "obs-vintage-part")
                .attr("cx", d => trajX(d.date)).attr("cy", d => trajY(d.value))
                .attr("r", 3.5).attr("fill", "#fff")
                .attr("stroke", VINTAGE_COLOR).attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "2,1.5")
                .style("pointer-events", "none");
        }
    }

    // --- Interaction overlay ---
    const interG = trajChartG.select(".layer-interaction");
    interG.selectAll("*").remove();
    interG.append("rect")
        .attr("width", innerW).attr("height", innerH)
        .attr("fill", "none").attr("pointer-events", "all")
        .style("cursor", refDates.length ? "crosshair" : "default")
        .on("click", (event) => {
            const [mx] = d3.pointer(event);
            const clickDate = trajX.invert(mx);

            // Move the surveillance snapshot to the clicked week. This works
            // anywhere on the chart, including weeks with no forecast.
            AppState.vintageAsOf = d3.timeFormat("%Y-%m-%d")(clickDate);
            if (!refDates.length) { drawTrajectories(); return; }

            let closest = refDates[0], minDist = Infinity;
            refDates.forEach(rd => {
                const dist = Math.abs(clickDate - new Date(rd + "T00:00:00"));
                if (dist < minDist) { minDist = dist; closest = rd; }
            });
            if (closest !== AppState.currentRefDate) {
                AppState.currentRefDate = closest;
                if (typeof syncRefDateSelects === "function") syncRefDateSelects();
                buildDateButtons();
                if (typeof updateLastUpdatedLabel === "function") updateLastUpdatedLabel();
                updateAll();
            }
            drawTrajectories();
        })
        .on("mousemove", (event) => {
            const [mx] = d3.pointer(event);
            const hoverDate = trajX.invert(mx);
            const allWeeklyDates = recentObserved.map(d => d.date);
            Object.values(_alignedSeasonData).forEach(sd => sd.forEach(d => allWeeklyDates.push(d.date)));

            let nearestDate = null, minDist = Infinity;
            allWeeklyDates.forEach(d => {
                const dist = Math.abs(d - hoverDate);
                if (dist < minDist) { minDist = dist; nearestDate = d; }
            });
            if (!nearestDate) return;
            if (minDist > 5 * 24 * 60 * 60 * 1000) {
                interG.select(".hover-line").remove();
                hideTrajTooltip();
                return;
            }
            const hoverX = trajX(nearestDate);
            interG.select(".hover-line").remove();
            interG.append("line").attr("class", "hover-line")
                .attr("x1", hoverX).attr("y1", 0).attr("x2", hoverX).attr("y2", innerH)
                .attr("stroke", "#aaa").attr("stroke-width", 1)
                .attr("stroke-dasharray", "4,3").attr("pointer-events", "none");
            showHoverTooltip(event, nearestDate, recentObserved, refDateObj, vintageSeries, vintage);
        })
        .on("mouseleave", () => {
            interG.select(".hover-line").remove();
            hideTrajTooltip();
        });

    updateTrajLegend();
}

// --- PI Bands -------------------------------------------------------------

// --- Individual trajectories ----------------------------------------------
// A sample of the model runs over the forecast weeks (not joined to the
// reported data).

function drawTrajLines(refTrajData, maxHorizons) {
    const g = trajChartG.select(".layer-traj-lines");
    g.selectAll("*").remove();
    if (!trajLineCount || !refTrajData?.trajectories?.length) return;

    const dates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
    const runs = refTrajData.trajectories;
    const step = runs.length / Math.min(trajLineCount, runs.length);
    const line = d3.line().defined(d => d.value != null).x(d => trajX(d.date)).y(d => trajY(d.value));
    for (let k = 0; k < Math.min(trajLineCount, runs.length); k++) {
        const t = runs[Math.floor(k * step)];
        const pts = dates.map((date, i) => ({ date, value: t.values[i] }));
        g.append("path").datum(pts).attr("d", line)
            .attr("fill", "none").attr("stroke", TRAJ_LINE_COLOR)
            .attr("stroke-width", 1).attr("stroke-opacity", trajLineCount > 50 ? 0.18 : 0.35);
    }
}

function drawPIBands(refTrajData, maxHorizons, innerW, innerH) {
    const piG = trajChartG.select(".layer-pi-bands");
    piG.selectAll("*").remove();

    const anyPI = Object.values(showPI).some(v => v);
    if (!anyPI || !refTrajData) return;

    const dates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
    const q = refTrajData.quantiles || {};
    const piData = dates.map((date, i) => ({
        date,
        p025: q.p025?.[i], p05: q.p05?.[i], p25: q.p25?.[i],
        p75: q.p75?.[i], p95: q.p95?.[i], p975: q.p975?.[i],
    })).filter(d => d.p25 != null && d.p75 != null);
    if (!piData.length) return;

    const bandDefs = [
        { key: "95", lower: "p025", upper: "p975" },
        { key: "90", lower: "p05",  upper: "p95"  },
        { key: "50", lower: "p25",  upper: "p75"  },
    ];

    bandDefs.forEach(({ key, lower, upper }) => {
        if (!showPI[key]) return;
        const style = PI_STYLES[key];
        const area = d3.area()
            .defined(d => d[lower] != null && d[upper] != null)
            .x(d => trajX(d.date)).y0(d => trajY(d[lower])).y1(d => trajY(d[upper]));
        piG.append("path").datum(piData)
            .attr("d", area).attr("fill", style.fill)
            .attr("fill-opacity", style.opacity)
            .attr("stroke", style.fill).attr("stroke-width", 1).attr("stroke-opacity", 0.9);
    });
}

// --- Baseline overlay -----------------------------------------------------
// Draws the FluSight-baseline forecast for the active reference date as a
// faded 90% PI ribbon (#C45B5B) and a dashed median line on top of the chart.

function drawBaselineOverlay(refDate, maxHorizons) {
    const layer = trajChartG.select(".layer-baseline");
    layer.selectAll("*").remove();
    if (!showBaseline) return;
    if (!baselineData) {
        console.warn("[trajectories] baseline toggle on but data not loaded");
        return;
    }

    const bands = baselineData.data?.[refDate];
    if (!bands) {
        console.warn(`[trajectories] no baseline data for refDate=${refDate}`);
        return;
    }

    const dates = bands.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
    const points = dates.map((d, i) => ({
        date: d, p05: bands.p05[i], p50: bands.p50[i], p95: bands.p95[i],
    })).filter(p => p.p50 != null);
    if (points.length === 0) return;

    // 90% PI ribbon
    layer.append("path")
        .datum(points)
        .attr("d", d3.area()
            .x(d => trajX(d.date))
            .y0(d => trajY(d.p05))
            .y1(d => trajY(d.p95)))
        .attr("fill", "#C45B5B").attr("opacity", 0.25).attr("stroke", "none");

    // Median (dashed)
    layer.append("path")
        .datum(points)
        .attr("d", d3.line().x(d => trajX(d.date)).y(d => trajY(d.p50)))
        .attr("fill", "none")
        .attr("stroke", "#C45B5B")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "5,4");

    // Median dots
    layer.selectAll(".baseline-dot").data(points).join("circle")
        .attr("class", "baseline-dot")
        .attr("cx", d => trajX(d.date))
        .attr("cy", d => trajY(d.p50))
        .attr("r", 3)
        .attr("fill", "#C45B5B");

    // Right-edge label
    const last = points[points.length - 1];
    layer.append("text")
        .attr("x", trajX(last.date) + 4)
        .attr("y", trajY(last.p50))
        .attr("font-family", TRAJ_FONT).attr("font-size", "11px")
        .attr("fill", "#C45B5B").attr("dominant-baseline", "middle")
        .attr("font-weight", "600").text("Baseline");

    console.log(`[trajectories] drew baseline overlay: ${points.length} points, ref=${refDate}`);
}

// --- Tab annotations ------------------------------------------------------
// All tabs: a light outline marks the forecast week selected in the summary
// panel. Season Start and Peak Week: each of the four forecast weeks is shaded
// by a cumulative probability (chance the season has started by that week /
// chance the peak has happened by that week), with the number on top and in
// the hover tooltip. Season Start also draws the epidemic threshold and, once
// crossed, the week the season started; Peak Week marks the observed peak.

const ONSET_COLOR = "#6B4FBB";   // purple: distinct from the blue intervals
const PEAK_COLOR = "#C9920A";    // gold
const WEEK_MS = 7 * 24 * 3600 * 1000;

// { "YYYY-MM-DD": {p, label} } for the weekly probabilities on screen; read by
// the hover tooltip.
let _tabWeekProbs = {};

function drawTabAnnotations(tab, loc, refDate, refTrajData, showThrough, maxHorizons, innerW, innerH, lastReported) {
    const g = trajChartG.select(".layer-annotations");
    g.selectAll("*").remove();
    _tabWeekProbs = {};

    const fmtWeek = d3.timeFormat("%b %-d");
    const [x0, x1] = trajX.domain();
    const inX = d => d >= x0 && d <= x1;
    const half = WEEK_MS / 2;
    const colX = d => [
        Math.max(0, trajX(new Date(d.getTime() - half))),
        Math.min(innerW, trajX(new Date(d.getTime() + half))),
    ];
    const label = (x, y, text, color, anchor = "start", weight = "600", size = "11px") => g.append("text")
        .attr("x", x).attr("y", y).attr("text-anchor", anchor)
        .attr("font-family", TRAJ_FONT).attr("font-size", size).attr("font-weight", weight)
        .attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 3).attr("paint-order", "stroke")
        .text(text);

    const forecastDates = refTrajData ? refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00")) : [];

    // Selected forecast week (from the summary panel).
    if (forecastDates.length) {
        const h = Math.min(AppState.currentHorizon || 0, forecastDates.length - 1);
        const [xa, xb] = colX(forecastDates[h]);
        g.append("rect").attr("x", xa).attr("y", 0).attr("width", Math.max(1, xb - xa)).attr("height", innerH)
            .attr("fill", "#1a1a1a").attr("opacity", 0.05);
        g.append("rect").attr("x", xa).attr("y", 0).attr("width", Math.max(1, xb - xa)).attr("height", innerH)
            .attr("fill", "none").attr("stroke", "#1a1a1a").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("opacity", 0.6);
        label((xa + xb) / 2, innerH - 6, `Wk ${h + 1}`, "#1a1a1a", "middle", "600", "10px");
    }

    if (tab === "trend" && refTrajData) {
        drawTrendEmphasis(g, refTrajData, forecastDates, lastReported, innerW, label);
        return;
    }
    if (tab !== "onset" && tab !== "peak") return;
    const color = tab === "onset" ? ONSET_COLOR : PEAK_COLOR;
    const probLabel = tab === "onset" ? "Chance the season has started by this week"
                                      : "Chance the peak has happened by this week";

    // Weekly cumulative probabilities for the four forecast weeks.
    let probs = [];
    if (tab === "onset") {
        const entry = dashboardData?.data?.[refDate]?.[loc] || {};
        probs = forecastDates.map((d, h) => ({ d, p: entry[String(h)]?.onset_prob }));
    } else {
        const pk = peakWeekData?.[loc]?.[refDate];
        if (pk && pk.weeks && pk.proportions) {
            let cum = 0; const cumByWeek = {};
            pk.weeks.forEach((w, i) => { cum += pk.proportions[i] || 0; cumByWeek[w] = cum; });
            probs = forecastDates.map(d => ({ d, p: cumByWeek[d3.timeFormat("%Y-%m-%d")(d)] }));
        }
    }
    const started = tab === "onset" && !!(dashboardData?.data?.[refDate]?.[loc]?.["0"]?.season_started_observed);

    if (!started) {
        // Narrow columns only get a printed percentage on the selected week;
        // the rest are in the hover tooltip.
        const hSel = Math.min(AppState.currentHorizon || 0, Math.max(0, probs.length - 1));
        probs.forEach(({ d, p }, h) => {
            if (p == null) return;
            const [xa, xb] = colX(d);
            g.append("rect").attr("x", xa).attr("y", 0).attr("width", Math.max(1, xb - xa)).attr("height", innerH)
                .attr("fill", color).attr("opacity", 0.08 + 0.5 * p);
            const narrow = (xb - xa) < 36;
            if (!narrow || h === hSel) {
                label((xa + xb) / 2, 16, `${Math.round(p * 100)}%`, color, "middle", "700", narrow ? "11px" : "12px");
            }
            _tabWeekProbs[d3.timeFormat("%Y-%m-%d")(d)] = { p, label: probLabel, color };
        });
    }

    if (tab === "onset") {
        const E = activityThresholds?.[loc]?.epidemic;
        if (E != null) {
            const yE = trajY(E);
            g.append("line").attr("x1", 0).attr("x2", innerW).attr("y1", yE).attr("y2", yE)
                .attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-dasharray", "6,4");
            label(6, yE - 5, `Epidemic threshold (${Math.round(E)} admissions/week)`, color, "start");
        }
        const h0 = dashboardData?.data?.[refDate]?.[loc]?.["0"];
        if (started && h0?.observed_onset_date) {
            const d = new Date(h0.observed_onset_date + "T00:00:00");
            if (inX(d)) {
                const x = trajX(d);
                g.append("line").attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", innerH)
                    .attr("stroke", color).attr("stroke-width", 1.5);
                const anchor = x > innerW * 0.7 ? "end" : "start";
                label(x + (anchor === "end" ? -6 : 6), 16, "Season started", color, anchor);
                label(x + (anchor === "end" ? -6 : 6), 30, `week of ${fmtWeek(d)}`, color, anchor, "400");
            }
        }
    }

    if (tab === "peak") {
        const op = peakWeekData?._observed_peak?.[loc];
        if (op) {
            const d = new Date(op.date + "T00:00:00");
            if (inX(d) && d <= showThrough) {
                const x = trajX(d), y = trajY(op.value);
                g.append("text").attr("x", x).attr("y", y - 10)
                    .attr("text-anchor", "middle").attr("font-size", "18px").attr("fill", color)
                    .text("★");
                // Label beside the star (the top of the plot holds the weekly percentages).
                const left = x > innerW * 0.5;
                label(x + (left ? -14 : 14), y - 12, `Observed peak: ${d3.format(",")(op.value)}`, color, left ? "end" : "start");
            }
        }
    }
}

// Trend view: the median forecast drawn in the trend color, plus the level the
// trend is measured against (the last reported week) as a dashed reference.
function drawTrendEmphasis(g, refTrajData, forecastDates, lastReported, innerW, label) {
    const entry = dashboardData?.data?.[AppState.currentRefDate]?.[AppState.selectedState]?.[String(AppState.currentHorizon)];
    const cat = entry?.trend_most_likely || "stable";
    const color = TREND_TEXT_COLORS?.[cat] || TREND_COLORS[cat] || "#1a1a1a";

    if (lastReported) {
        const y = trajY(lastReported.value);
        g.append("line").attr("x1", 0).attr("x2", innerW).attr("y1", y).attr("y2", y)
            .attr("stroke", "#1a1a1a").attr("stroke-width", 1).attr("stroke-dasharray", "4,4").attr("opacity", 0.55);
        label(6, y - 5, `Last reported week: ${d3.format(",")(Math.round(lastReported.value))}`, "#555", "start", "500");
    }

    // The median starts at forecast week 1; it is not joined to the reported data.
    const med = (refTrajData.quantiles?.p50 || []).slice(0, forecastDates.length);
    const pts = forecastDates.map((d, i) => ({ date: d, value: med[i] })).filter(d => d.value != null);
    if (pts.length) {
        g.append("path").datum(pts)
            .attr("d", d3.line().x(d => trajX(d.date)).y(d => trajY(d.value)))
            .attr("fill", "none").attr("stroke", color).attr("stroke-width", 3).attr("stroke-linecap", "round");
        g.selectAll(".trend-median-dot").data(pts).join("circle")
            .attr("class", "trend-median-dot")
            .attr("cx", d => trajX(d.date)).attr("cy", d => trajY(d.value))
            .attr("r", 3.5).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 1.2);
    }
}

// --- Activity Bands -------------------------------------------------------

function drawActivityBands(loc, innerW, innerH) {
    const bandsG = trajChartG.select(".layer-activity-bands");
    bandsG.selectAll("*").remove();

    if (!showActivityBands || !activityThresholds?.[loc]) return;
    const th = activityThresholds[loc];

    const bands = [
        { y0: 0,            y1: th.moderate,  cat: "low" },
        { y0: th.moderate,  y1: th.high,      cat: "moderate" },
        { y0: th.high,      y1: th.very_high, cat: "high" },
        { y0: th.very_high, y1: trajY.domain()[1], cat: "very_high" },
    ];

    bands.forEach(band => {
        const yTop = trajY(Math.min(band.y1, trajY.domain()[1]));
        const yBot = trajY(Math.max(band.y0, 0));
        const h = yBot - yTop;
        if (h <= 0) return;
        bandsG.append("rect")
            .attr("x", 0).attr("y", yTop).attr("width", innerW).attr("height", h)
            .attr("fill", ACTIVITY_BAND_COLORS[band.cat]).attr("stroke", "none");
        if (h > 14) {
            bandsG.append("text")
                .attr("x", 6).attr("y", yTop + h / 2)
                .attr("text-anchor", "start").attr("dominant-baseline", "middle")
                .attr("font-family", TRAJ_FONT).attr("font-size", "14px")
                .attr("fill", ACTIVITY_TEXT_COLORS[band.cat]).attr("font-weight", "700")
                .text(ACTIVITY_LABELS[band.cat]);
        }
    });
}

// --- Legend --------------------------------------------------------------

function updateTrajLegend() {
    const container = d3.select("#traj-legend");
    container.selectAll("*").remove();

    const hasForecast = !!(AppState.currentRefDate && trajData?.data?.[AppState.currentRefDate]);

    const tab = AppState.currentTab;
    const addItem = (color, text, opacity) => {
        const item = container.append("span").attr("class", "traj-legend-item");
        item.append("span").attr("class", "traj-legend-swatch")
            .style("background", color).style("opacity", opacity == null ? null : String(opacity));
        item.append("span").text(text);
    };

    // Activity bands are labelled on the chart itself, so no legend items for them.
    if (tab === "trend" && hasForecast) {
        const entry = dashboardData?.data?.[AppState.currentRefDate]?.[AppState.selectedState]?.[String(AppState.currentHorizon)];
        const cat = entry?.trend_most_likely || "stable";
        addItem(TREND_TEXT_COLORS?.[cat] || TREND_COLORS[cat], `Median forecast (${TREND_LABELS[cat].toLowerCase()})`);
        addItem("#1a1a1a", "Last reported level", 0.55);
    }

    if (tab === "onset" && hasForecast) {
        const h0 = dashboardData?.data?.[AppState.currentRefDate]?.[AppState.selectedState]?.["0"];
        addItem(ONSET_COLOR, "Epidemic threshold");
        addItem(ONSET_COLOR, h0?.season_started_observed ? "Week the season started" : "Chance the season has started by each week (darker = higher)", 0.45);
    }
    if (tab === "peak" && hasForecast) {
        addItem(PEAK_COLOR, "Chance the peak has happened by each week (darker = higher)", 0.45);
        addItem(PEAK_COLOR, "\u2605 Observed peak");
    }

    if (showVintage) {
        const asOf = currentVintageAsOf();
        const v = vintageAsOfDate(AppState.selectedState, asOf);
        if (v) {
            const when = d3.timeFormat("%b %-d, %Y")(new Date(v.pulled + "T00:00:00"));
            addItem(VINTAGE_COLOR, `Data as reported on ${when}; black shows weeks revised since`);
            if (v.series.some(d => d.partial)) {
                addItem(VINTAGE_COLOR, "Dashed / hollow: week not finished at that date", 0.6);
            }
        } else {
            addItem("#ccc", "No data snapshot from before this week — click a later week");
        }
    }

    if (trajLineCount && hasForecast) addItem(TRAJ_LINE_COLOR, `${trajLineCount} model trajectories`, 0.6);

    const anyPI = Object.values(showPI).some(v => v) && hasForecast;
    if (anyPI) {
        ["50", "90", "95"].forEach(level => {
            if (!showPI[level]) return;
            const style = PI_STYLES[level];
            const item = container.append("span").attr("class", "traj-legend-item");
            item.append("span").attr("class", "traj-legend-swatch")
                .style("background", style.fill).style("opacity", style.opacity + 0.2);
            item.append("span").text(style.label);
        });
    }

}

// --- Hover Tooltip -------------------------------------------------------

function showHoverTooltip(event, nearestDate, recentObserved, refDateObj, vintageSeries = [], vintage = null) {
    const fmt = d3.timeFormat("%b %d, %Y");
    const valFmt = d3.format(",.0f");

    let html = `<div class="traj-tip-header">Week ending ${fmt(nearestDate)}</div>`;

    const obsPoint = recentObserved.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
    if (obsPoint) {
        const label = (refDateObj && obsPoint.date >= refDateObj) ? "Observed (out-of-sample)" : "Observed";
        html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:#1a1a1a"></span>${label}: <strong>${valFmt(obsPoint.value)}</strong></div>`;
    }
    const vPoint = vintageSeries.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
    if (vPoint) {
        const when = vintage ? d3.timeFormat("%b %-d, %Y")(new Date(vintage.pulled + "T00:00:00")) : "the pull date";
        html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:${VINTAGE_COLOR}"></span>` +
            `As reported on ${when}: <strong>${valFmt(vPoint.value)}</strong></div>`;
        if (vPoint.partial) {
            html += `<div class="traj-tip-note">This week had not finished on ${when}, so it counts only the days reported by then. ` +
                (obsPoint ? `It finished at ${valFmt(obsPoint.value)}.` : "") + `</div>`;
        } else if (obsPoint && Math.abs(obsPoint.value - vPoint.value) > 0.01) {
            html += `<div class="traj-tip-note">Revised by ${valFmt(obsPoint.value - vPoint.value)} since.</div>`;
        }
    }

    const wp = _tabWeekProbs[d3.timeFormat("%Y-%m-%d")(nearestDate)];
    if (wp) {
        html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:${wp.color};opacity:0.6"></span>${wp.label}: <strong>${Math.round(wp.p * 100)}%</strong></div>`;
    }

    Object.entries(_alignedSeasonData).forEach(([sName, data]) => {
        const style = seasonStyle(sName);
        const point = data.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
        if (point) {
            html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:${style.color}"></span>${sName}: <strong>${valFmt(point.value)}</strong></div>`;
        }
    });

    if (html.indexOf("traj-tip-row") === -1) return;

    const tt = trajTooltip();
    tt.html(html);
    tt.classed("visible", true);
    positionTrajTooltip(event);
}

function hideTrajTooltip() {
    trajTooltip().classed("visible", false);
}

function positionTrajTooltip(event) {
    const tt = trajTooltip().node();
    const ttW = tt.offsetWidth;
    const ttH = tt.offsetHeight;
    let left = event.clientX + 12;
    let top = event.clientY - 10;
    if (left + ttW > window.innerWidth - 10) left = event.clientX - ttW - 12;
    if (top + ttH > window.innerHeight - 10) top = window.innerHeight - ttH - 10;
    if (top < 10) top = 10;
    trajTooltip().style("left", left + "px").style("top", top + "px");
}
