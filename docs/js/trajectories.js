// Trajectory Specific Forecasts chart — redesigned with context panel

const TRAJ_WIDTH = 1100;
const TRAJ_HEIGHT = 420;
const TRAJ_MARGIN = { top: 20, right: 30, bottom: 40, left: 60 };
const TRAJ_FONT = "Helvetica Neue, Arial, sans-serif";
const TRAJ_FONT_SIZE = "12px";

let trajSvg, trajX, trajY, trajChartG;
let trajData = null;
let historicalSeasons = null;

// Slider snap values (includes 0 for "PI only" view)
const TRAJ_SLIDER_VALUES = [0, 10, 25, 50, 100, 200];

// Context panel state
let contextSeasons = { "2022-23": true, "2023-24": true, "2024-25": true };
let showSeasons = false;
let showActivityBands = false;
let showTrends = false;
let trajColorHorizon = 0;

// PI state
let showPI = { "50": false, "90": false, "95": false };

// Season styling — more distinct
const SEASON_STYLES = {
    "2022-23": { color: "#E07B54", dash: "8,4", width: 2 },
    "2023-24": { color: "#7B68AE", dash: "4,4", width: 2 },
    "2024-25": { color: "#4A9A6F", dash: "2,3", width: 2 }
};

// PI band styling (blue palette matching admissions tooltip)
const PI_STYLES = {
    "95": { fill: "#b0d4e8", opacity: 0.4, label: "95% PI" },
    "90": { fill: "#6faed0", opacity: 0.4, label: "90% PI" },
    "50": { fill: "#4682B4", opacity: 0.35, label: "50% PI" }
};

// Store aligned season data for tooltip lookup
let _alignedSeasonData = {};

const trajTooltip = () => d3.select("#traj-tooltip");

function initTrajectoryChart() {
    trajSvg = d3.select("#traj-chart")
        .attr("viewBox", `0 0 ${TRAJ_WIDTH} ${TRAJ_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    trajChartG = trajSvg.append("g")
        .attr("transform", `translate(${TRAJ_MARGIN.left},${TRAJ_MARGIN.top})`);

    // Layers for proper z-ordering
    trajChartG.append("g").attr("class", "layer-activity-bands");
    trajChartG.append("g").attr("class", "layer-pi-bands");
    trajChartG.append("g").attr("class", "layer-seasons");
    trajChartG.append("g").attr("class", "layer-trajectories");
    trajChartG.append("g").attr("class", "layer-axes");
    trajChartG.append("g").attr("class", "layer-interaction");
    trajChartG.append("g").attr("class", "layer-observed");

    // Populate location dropdown
    const locSelect = d3.select("#traj-location");
    locationsData.forEach(loc => {
        locSelect.append("option")
            .attr("value", loc.fips)
            .text(loc.name === "US" ? "United States" : loc.name);
    });
    locSelect.property("value", "US");

    // Event listeners
    d3.select("#traj-location").on("change", function () {
        loadAndDrawTrajectories(this.value);
    });

    // Initialize slider
    initSlider();

    // Initialize PI controls (top bar)
    initPIControls();

    // Initialize context panel
    initContextPanel();

    // Load historical seasons then draw
    d3.json("data/historical_seasons.json").then(hs => {
        historicalSeasons = hs;
        loadAndDrawTrajectories("US");
    });
}

// --- Slider ---

function initSlider() {
    const slider = d3.select("#traj-slider");
    const valueLabel = d3.select("#traj-slider-value");

    slider.property("value", 5);
    valueLabel.text("200");

    slider.on("input", function () {
        const idx = +this.value;
        const val = TRAJ_SLIDER_VALUES[idx];
        valueLabel.text(val === 0 ? "None" : val);
        drawTrajectories();
    });
}

function getSliderValue() {
    const idx = +d3.select("#traj-slider").property("value");
    return idx < TRAJ_SLIDER_VALUES.length ? TRAJ_SLIDER_VALUES[idx] : 200;
}

// --- Context Panel ---

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
}

function initContextPanel() {
    d3.selectAll(".context-section-header").on("click", function () {
        const section = d3.select(this).attr("data-section");
        toggleContextSection(section);
    });

    buildSeasonsSection();
    buildActivitySection();
    buildTrendsSection();
}

function toggleContextSection(section) {
    if (section === "seasons") {
        showSeasons = !showSeasons;
        d3.select("#ctx-seasons .context-section-header").classed("active", showSeasons);
        d3.select("#ctx-seasons-body").classed("open", showSeasons);
        if (showSeasons) {
            Object.keys(contextSeasons).forEach(s => { contextSeasons[s] = true; });
            updateSeasonButtons();
        }
    } else if (section === "activity") {
        showActivityBands = !showActivityBands;
        d3.select("#ctx-activity .context-section-header").classed("active", showActivityBands);
        d3.select("#ctx-activity-body").classed("open", showActivityBands);
    } else if (section === "trends") {
        showTrends = !showTrends;
        d3.select("#ctx-trends .context-section-header").classed("active", showTrends);
        d3.select("#ctx-trends-body").classed("open", showTrends);
    }
    drawTrajectories();
}

function buildSeasonsSection() {
    const body = d3.select("#ctx-seasons-body");
    body.selectAll("*").remove();

    Object.keys(contextSeasons).forEach(season => {
        const style = SEASON_STYLES[season] || {};
        const btn = body.append("button")
            .attr("class", "ctx-season-btn" + (contextSeasons[season] ? " active" : ""))
            .attr("data-season", season)
            .on("click", function () {
                contextSeasons[season] = !contextSeasons[season];
                d3.select(this).classed("active", contextSeasons[season]);
                if (!Object.values(contextSeasons).some(v => v)) {
                    showSeasons = false;
                    d3.select("#ctx-seasons .context-section-header").classed("active", false);
                    d3.select("#ctx-seasons-body").classed("open", false);
                }
                drawTrajectories();
            });

        btn.append("span")
            .attr("class", "ctx-season-swatch")
            .style("background", style.color || "#ccc");
        btn.append("span").text(season);
    });
}

function updateSeasonButtons() {
    d3.selectAll(".ctx-season-btn").each(function () {
        const season = d3.select(this).attr("data-season");
        d3.select(this).classed("active", contextSeasons[season]);
    });
}

function buildActivitySection() {
    const body = d3.select("#ctx-activity-body");
    body.selectAll("*").remove();

    ACTIVITY_ORDER.forEach(cat => {
        const item = body.append("div").attr("class", "ctx-activity-item");
        item.append("span")
            .attr("class", "ctx-activity-swatch")
            .style("background", ACTIVITY_COLORS[cat]);
        item.append("span").text(ACTIVITY_LABELS[cat]);
    });
}

function buildTrendsSection() {
    const body = d3.select("#ctx-trends-body");
    body.selectAll("*").remove();

    // Horizon selector buttons
    const horizonGroup = body.append("div").attr("class", "ctx-horizon-group");
    const horizonLabels = ["Wk 1", "Wk 2", "Wk 3", "Wk 4"];

    horizonLabels.forEach((label, i) => {
        horizonGroup.append("button")
            .attr("class", "ctx-horizon-btn" + (i === trajColorHorizon ? " active" : ""))
            .attr("data-horizon", i)
            .text(label)
            .on("click", function () {
                trajColorHorizon = +d3.select(this).attr("data-horizon");
                horizonGroup.selectAll(".ctx-horizon-btn").classed("active", false);
                d3.select(this).classed("active", true);
                drawTrajectories();
            });
    });
}


// --- Main draw function ---

async function loadAndDrawTrajectories(fips) {
    try {
        trajData = await d3.json(`data/trajectories/${fips}.json`);
    } catch (e) {
        console.warn(`No trajectory data for ${fips}`);
        trajData = null;
    }
    drawTrajectories();
}

function setTrajectoryLocation(fips) {
    d3.select("#traj-location").property("value", fips);
    loadAndDrawTrajectories(fips);
}

function drawTrajectories() {
    const fips = d3.select("#traj-location").property("value");
    const numTrajectories = getSliderValue();

    const innerW = TRAJ_WIDTH - TRAJ_MARGIN.left - TRAJ_MARGIN.right;
    const innerH = TRAJ_HEIGHT - TRAJ_MARGIN.top - TRAJ_MARGIN.bottom;

    // Get observed data
    const observed = targetDataAll?.[fips] || [];
    const observedParsed = observed
        .filter(d => d.value != null)
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value, rate: d.rate }));

    const showFrom = new Date("2025-11-01T00:00:00");
    const recentObserved = observedParsed.filter(d => d.date >= showFrom);

    const refDate = AppState.currentRefDate;
    const refDateObj = new Date(refDate + "T00:00:00");
    const refTrajData = trajData?.data?.[refDate];
    const refDates = dashboardData.reference_dates;

    const maxHorizons = 4;

    // Compute domains
    let allDates = recentObserved.map(d => d.date);
    let allValues = recentObserved.map(d => d.value);
    allDates.push(showFrom);

    if (refTrajData) {
        const trajDates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(trajDates);

        // For domain, use the drawn trajectories plus all trajectories if PI is active
        const anyPI = Object.values(showPI).some(v => v);
        const domainTrajs = anyPI ? refTrajData.trajectories : refTrajData.trajectories.slice(0, numTrajectories);
        domainTrajs.forEach(t => {
            allValues = allValues.concat(t.values.slice(0, maxHorizons));
        });
    }

    // Compute and store aligned season data for tooltip
    _alignedSeasonData = {};
    if (showSeasons && historicalSeasons?.[fips]) {
        const currentSeasonStart = new Date("2025-10-01T00:00:00");
        Object.keys(historicalSeasons[fips]).forEach(sName => {
            if (!contextSeasons[sName]) return;
            const season = historicalSeasons[fips][sName];
            _alignedSeasonData[sName] = season
                .filter(d => d.value != null)
                .map(d => {
                    const alignedDate = new Date(currentSeasonStart);
                    alignedDate.setDate(alignedDate.getDate() + d.week * 7);
                    return { date: alignedDate, value: d.value };
                })
                .filter(d => d.date >= showFrom);
        });

        // Add season values to domain
        Object.values(_alignedSeasonData).forEach(lineData => {
            lineData.forEach(d => allValues.push(d.value));
        });
    }

    // Add activity threshold values to domain if bands shown
    if (showActivityBands && activityThresholds?.[fips]) {
        const th = activityThresholds[fips];
        allValues.push(th.very_high);
    }

    if (allDates.length === 0) return;

    // Scales
    trajX = d3.scaleTime()
        .domain(d3.extent(allDates))
        .range([0, innerW]);

    const yMax = d3.max(allValues) || 1;
    trajY = d3.scaleLinear()
        .domain([0, yMax * 1.05])
        .range([innerH, 0]);

    // --- Draw activity bands ---
    drawActivityBands(fips, innerW, innerH);

    // --- Draw PI bands ---
    drawPIBands(refTrajData, maxHorizons, innerW, innerH);

    // --- Draw axes ---
    const axesG = trajChartG.select(".layer-axes");
    axesG.selectAll("*").remove();

    axesG.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(trajX).ticks(8).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE);

    axesG.append("g")
        .call(d3.axisLeft(trajY).ticks(6).tickFormat(d3.format(",.0f")))
        .selectAll("text")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE);

    axesG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -48)
        .attr("text-anchor", "middle")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE)
        .attr("fill", "#666")
        .text("Weekly Hospitalizations");

    // --- Draw historical seasons ---
    const seasonsG = trajChartG.select(".layer-seasons");
    seasonsG.selectAll("*").remove();

    if (showSeasons) {
        Object.entries(_alignedSeasonData).forEach(([sName, lineData]) => {
            if (lineData.length < 2) return;
            const style = SEASON_STYLES[sName] || { color: "#ccc", dash: "4,4", width: 2 };

            const line = d3.line()
                .x(d => trajX(d.date))
                .y(d => trajY(d.value))
                .defined(d => d.value != null);

            seasonsG.append("path")
                .datum(lineData)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", style.color)
                .attr("stroke-width", style.width)
                .attr("stroke-dasharray", style.dash)
                .attr("opacity", 0.7);

            // Season label at end
            const last = lineData[lineData.length - 1];
            seasonsG.append("text")
                .attr("x", trajX(last.date) + 4)
                .attr("y", trajY(last.value))
                .attr("font-family", TRAJ_FONT)
                .attr("font-size", TRAJ_FONT_SIZE)
                .attr("fill", style.color)
                .attr("dominant-baseline", "middle")
                .attr("font-weight", "600")
                .text(sName);
        });
    }

    // --- Draw trajectories ---
    const trajG = trajChartG.select(".layer-trajectories");
    trajG.selectAll("*").remove();

    if (refTrajData) {
        const dates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
        const sample = refTrajData.trajectories.slice(0, numTrajectories);

        const line = d3.line()
            .x((v, i) => trajX(dates[i]))
            .y(v => trajY(v))
            .defined(v => v != null);

        // When activity bands are shown, use black. Otherwise use trend colors.
        const useNeutralColor = showActivityBands;

        sample.forEach(t => {
            let color, opacity;
            if (useNeutralColor) {
                color = "#1a1a1a";
                opacity = 0.12;
            } else {
                const trendKey = `h${trajColorHorizon}`;
                const trend = t.trends[trendKey] || "stable";
                color = TREND_COLORS[trend] || "#ccc";
                opacity = 0.2;
            }

            trajG.append("path")
                .datum(t.values.slice(0, maxHorizons))
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", 1.5)
                .attr("opacity", opacity);
        });
    }

    // --- Draw observed data ---
    const obsG = trajChartG.select(".layer-observed");
    obsG.selectAll("*").remove();

    const inSample = recentObserved.filter(d => d.date < refDateObj);
    const outOfSample = recentObserved.filter(d => d.date >= refDateObj);

    if (recentObserved.length > 1) {
        const line = d3.line()
            .x(d => trajX(d.date))
            .y(d => trajY(d.value));

        obsG.append("path")
            .datum(recentObserved)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 2);

        obsG.selectAll(".obs-in")
            .data(inSample)
            .join("circle")
            .attr("class", "obs-in")
            .attr("cx", d => trajX(d.date))
            .attr("cy", d => trajY(d.value))
            .attr("r", 3.5)
            .attr("fill", "#1a1a1a")
            .attr("stroke", "none")
            .style("pointer-events", "none");

        obsG.selectAll(".obs-out")
            .data(outOfSample)
            .join("circle")
            .attr("class", "obs-out")
            .attr("cx", d => trajX(d.date))
            .attr("cy", d => trajY(d.value))
            .attr("r", 3.5)
            .attr("fill", "#fff")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 1.5)
            .style("pointer-events", "none");
    }

    // --- Interaction overlay (hover line + tooltip + click-to-jump) ---
    const interG = trajChartG.select(".layer-interaction");
    interG.selectAll("*").remove();

    interG.append("rect")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .style("cursor", "crosshair")
        .on("click", (event) => {
            const [mx] = d3.pointer(event);
            const clickDate = trajX.invert(mx);
            let closest = refDates[0];
            let minDist = Infinity;
            refDates.forEach(rd => {
                const rdDate = new Date(rd + "T00:00:00");
                const dist = Math.abs(clickDate - rdDate);
                if (dist < minDist) { minDist = dist; closest = rd; }
            });
            if (closest !== AppState.currentRefDate) {
                AppState.currentRefDate = closest;
                buildDateButtons();
                updateAll();
                drawTrajectories();
            }
        })
        .on("mousemove", (event) => {
            const [mx] = d3.pointer(event);
            const hoverDate = trajX.invert(mx);

            // Find nearest weekly date from observed + season data
            const allWeeklyDates = recentObserved.map(d => d.date);
            Object.values(_alignedSeasonData).forEach(sd => {
                sd.forEach(d => allWeeklyDates.push(d.date));
            });

            let nearestDate = null;
            let minDist = Infinity;
            allWeeklyDates.forEach(d => {
                const dist = Math.abs(d - hoverDate);
                if (dist < minDist) { minDist = dist; nearestDate = d; }
            });

            if (!nearestDate) return;

            // Snap threshold: only show if within ~5 days
            if (minDist > 5 * 24 * 60 * 60 * 1000) {
                interG.select(".hover-line").remove();
                hideTrajTooltip();
                return;
            }

            const hoverX = trajX(nearestDate);
            interG.select(".hover-line").remove();
            interG.append("line")
                .attr("class", "hover-line")
                .attr("x1", hoverX).attr("y1", 0)
                .attr("x2", hoverX).attr("y2", innerH)
                .attr("stroke", "#aaa")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "4,3")
                .attr("pointer-events", "none");

            // Build tooltip with values at this date
            showHoverTooltip(event, nearestDate, recentObserved, refDateObj);
        })
        .on("mouseleave", () => {
            interG.select(".hover-line").remove();
            hideTrajTooltip();
        });

    // --- Update legend ---
    updateTrajLegend();
}

// --- PI Bands ---

function drawPIBands(refTrajData, maxHorizons, innerW, innerH) {
    const piG = trajChartG.select(".layer-pi-bands");
    piG.selectAll("*").remove();

    const anyPI = Object.values(showPI).some(v => v);
    if (!anyPI || !refTrajData) return;

    const dates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
    const allTrajs = refTrajData.trajectories;
    if (allTrajs.length === 0) return;

    // Compute percentiles at each forecast date
    const piData = dates.map((date, i) => {
        const vals = allTrajs.map(t => t.values[i]).filter(v => v != null).sort((a, b) => a - b);
        const n = vals.length;
        const pct = p => vals[Math.min(Math.floor(p * n), n - 1)];
        return {
            date,
            p025: pct(0.025), p05: pct(0.05), p25: pct(0.25),
            p75: pct(0.75), p95: pct(0.95), p975: pct(0.975),
            median: pct(0.5)
        };
    });

    // Draw bands from widest to narrowest
    const bandDefs = [
        { key: "95", lower: "p025", upper: "p975" },
        { key: "90", lower: "p05", upper: "p95" },
        { key: "50", lower: "p25", upper: "p75" }
    ];

    bandDefs.forEach(({ key, lower, upper }) => {
        if (!showPI[key]) return;
        const style = PI_STYLES[key];

        const area = d3.area()
            .x(d => trajX(d.date))
            .y0(d => trajY(d[lower]))
            .y1(d => trajY(d[upper]));

        piG.append("path")
            .datum(piData)
            .attr("d", area)
            .attr("fill", style.fill)
            .attr("opacity", style.opacity)
            .attr("stroke", "none");
    });
}

// --- Activity Bands ---

function drawActivityBands(fips, innerW, innerH) {
    const bandsG = trajChartG.select(".layer-activity-bands");
    bandsG.selectAll("*").remove();

    if (!showActivityBands || !activityThresholds?.[fips]) return;

    const th = activityThresholds[fips];

    // Boundaries: moderate, high, very_high
    // Low: 0 to moderate, Moderate: moderate to high, High: high to very_high, Very High: above very_high
    const bands = [
        { y0: 0, y1: th.moderate, cat: "low" },
        { y0: th.moderate, y1: th.high, cat: "moderate" },
        { y0: th.high, y1: th.very_high, cat: "high" },
        { y0: th.very_high, y1: trajY.domain()[1], cat: "very_high" }
    ];

    bands.forEach(band => {
        const yTop = trajY(Math.min(band.y1, trajY.domain()[1]));
        const yBot = trajY(Math.max(band.y0, 0));
        const h = yBot - yTop;
        if (h <= 0) return;

        bandsG.append("rect")
            .attr("x", 0)
            .attr("y", yTop)
            .attr("width", innerW)
            .attr("height", h)
            .attr("fill", ACTIVITY_BAND_COLORS[band.cat])
            .attr("stroke", "none");

        // Label on the LEFT edge
        const labelY = yTop + h / 2;
        if (h > 14) {
            bandsG.append("text")
                .attr("x", 6)
                .attr("y", labelY)
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "middle")
                .attr("font-family", TRAJ_FONT)
                .attr("font-size", "14px")
                .attr("fill", ACTIVITY_TEXT_COLORS[band.cat])
                .attr("font-weight", "700")
                .text(ACTIVITY_LABELS[band.cat]);
        }
    });
}

// --- Legend ---

function updateTrajLegend() {
    const container = d3.select("#traj-legend");
    container.selectAll("*").remove();

    const numTrajectories = getSliderValue();

    if (showActivityBands) {
        ACTIVITY_ORDER.forEach(cat => {
            const item = container.append("span").attr("class", "traj-legend-item");
            item.append("span")
                .attr("class", "traj-legend-swatch")
                .style("background", ACTIVITY_COLORS[cat])
                .style("opacity", "0.5");
            item.append("span").text(ACTIVITY_LABELS[cat]);
        });
    } else if (numTrajectories > 0) {
        TREND_ORDER.forEach(cat => {
            const item = container.append("span").attr("class", "traj-legend-item");
            item.append("span")
                .attr("class", "traj-legend-swatch")
                .style("background", TREND_COLORS[cat]);
            item.append("span").text(TREND_LABELS[cat]);
        });
    }

    // Add PI legend items when active
    const anyPI = Object.values(showPI).some(v => v);
    if (anyPI) {
        ["50", "90", "95"].forEach(level => {
            if (!showPI[level]) return;
            const style = PI_STYLES[level];
            const item = container.append("span").attr("class", "traj-legend-item");
            item.append("span")
                .attr("class", "traj-legend-swatch")
                .style("background", style.fill)
                .style("opacity", style.opacity + 0.2);
            item.append("span").text(style.label);
        });
    }
}

// --- Hover Tooltip ---

function showHoverTooltip(event, nearestDate, recentObserved, refDateObj) {
    const fmt = d3.timeFormat("%b %d, %Y");
    const valFmt = d3.format(",.0f");

    let html = `<div class="traj-tip-header">Week ending ${fmt(nearestDate)}</div>`;

    // Current season observed
    const obsPoint = recentObserved.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
    if (obsPoint) {
        const label = obsPoint.date >= refDateObj ? "Observed (out-of-sample)" : "Observed";
        html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:#1a1a1a"></span>${label}: <strong>${valFmt(obsPoint.value)}</strong></div>`;
    }

    // Previous season values
    Object.entries(_alignedSeasonData).forEach(([sName, data]) => {
        const style = SEASON_STYLES[sName] || {};
        const point = data.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
        if (point) {
            html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:${style.color}"></span>${sName}: <strong>${valFmt(point.value)}</strong></div>`;
        }
    });

    if (html.indexOf("traj-tip-row") === -1) return; // nothing to show

    const tt = trajTooltip();
    tt.html(html);
    tt.classed("visible", true);
    positionTrajTooltip(event);
}

// --- Tooltips ---

function showTextTooltip(event, text) {
    const tt = trajTooltip();
    tt.html(text);
    tt.classed("visible", true);
    positionTrajTooltip(event);
}

function hideTrajTooltip() {
    trajTooltip().classed("visible", false);
}

function positionTrajTooltip(event) {
    const tt = trajTooltip().node();
    const ttWidth = tt.offsetWidth;
    const ttHeight = tt.offsetHeight;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let left = event.clientX + 12;
    let top = event.clientY - 10;

    if (left + ttWidth > viewW - 10) left = event.clientX - ttWidth - 12;
    if (top + ttHeight > viewH - 10) top = viewH - ttHeight - 10;
    if (top < 10) top = 10;

    trajTooltip()
        .style("left", left + "px")
        .style("top", top + "px");
}
