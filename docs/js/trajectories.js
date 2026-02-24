// Trajectory Specific Forecasts chart

const TRAJ_WIDTH = 1100;
const TRAJ_HEIGHT = 420;
const TRAJ_MARGIN = { top: 20, right: 30, bottom: 40, left: 60 };

let trajSvg, trajX, trajY, trajChartG;
let trajData = null;        // per-location trajectory data
let targetDataAll = null;    // historical observed data
let historicalSeasons = null; // seasonal curves for context
// Per-season visibility state (all enabled by default)
let contextSeasons = {
    "2022-23": true,
    "2023-24": true,
    "2024-25": true
};
let contextMenuOpen = false;
let showContext = true;  // master toggle for all context lines

// Shared tooltip element for the trajectory section
const trajTooltip = () => d3.select("#traj-tooltip");

function initTrajectoryChart() {
    trajSvg = d3.select("#traj-chart")
        .attr("viewBox", `0 0 ${TRAJ_WIDTH} ${TRAJ_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    trajChartG = trajSvg.append("g")
        .attr("transform", `translate(${TRAJ_MARGIN.left},${TRAJ_MARGIN.top})`);

    // Layers for proper z-ordering
    trajChartG.append("g").attr("class", "layer-seasons");
    trajChartG.append("g").attr("class", "layer-trajectories");
    trajChartG.append("g").attr("class", "layer-axes");
    trajChartG.append("g").attr("class", "layer-donut");
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
    d3.select("#traj-count").on("change", () => drawTrajectories());
    d3.select("#traj-horizon").on("change", () => drawTrajectories());
    // Context dropdown: build checklist
    initContextDropdown();

    // Close context menu when clicking outside
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#context-dropdown")) {
            d3.select("#context-menu").classed("open", false);
            contextMenuOpen = false;
        }
    });

    // Load target data and historical seasons
    Promise.all([
        d3.json("data/target_data.json"),
        d3.json("data/historical_seasons.json")
    ]).then(([td, hs]) => {
        targetDataAll = td;
        historicalSeasons = hs;
        loadAndDrawTrajectories("US");
    });
}

async function loadAndDrawTrajectories(fips) {
    try {
        trajData = await d3.json(`data/trajectories/${fips}.json`);
    } catch (e) {
        console.warn(`No trajectory data for ${fips}`);
        trajData = null;
    }
    drawTrajectories();
}

// Public: called from map click to switch trajectory location
function setTrajectoryLocation(fips) {
    d3.select("#traj-location").property("value", fips);
    loadAndDrawTrajectories(fips);
}

function drawTrajectories() {
    const fips = d3.select("#traj-location").property("value");
    const numTrajectories = +d3.select("#traj-count").property("value");
    const colorHorizon = +d3.select("#traj-horizon").property("value");

    const innerW = TRAJ_WIDTH - TRAJ_MARGIN.left - TRAJ_MARGIN.right;
    const innerH = TRAJ_HEIGHT - TRAJ_MARGIN.top - TRAJ_MARGIN.bottom;

    // Get observed data
    const observed = targetDataAll?.[fips] || [];
    const observedParsed = observed
        .filter(d => d.value != null)
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value, rate: d.rate }));

    // Fixed start date: November 1 of current season
    const showFrom = new Date("2025-11-01T00:00:00");

    const recentObserved = observedParsed.filter(d => d.date >= showFrom);

    // Get trajectory data for current reference date
    const refDate = AppState.currentRefDate;
    const refDateObj = new Date(refDate + "T00:00:00");
    const refTrajData = trajData?.data?.[refDate];
    const refDates = dashboardData.reference_dates;

    // Limit trajectories to horizons 0-3 (4 weeks)
    const maxHorizons = 4; // h0, h1, h2, h3

    // Compute domains
    let allDates = recentObserved.map(d => d.date);
    let allValues = recentObserved.map(d => d.value);

    // Ensure x-axis starts at Oct 1
    allDates.push(showFrom);

    if (refTrajData) {
        const trajDates = refTrajData.dates.slice(0, maxHorizons).map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(trajDates);

        const sample = refTrajData.trajectories.slice(0, numTrajectories);
        sample.forEach(t => {
            allValues = allValues.concat(t.values.slice(0, maxHorizons));
        });
    }

    // Add context season values to domain if any are showing
    if (hasAnyContext() && historicalSeasons?.[fips]) {
        Object.entries(historicalSeasons[fips]).forEach(([sName, season]) => {
            if (!contextSeasons[sName]) return;
            season.forEach(d => {
                if (d.value != null) allValues.push(d.value);
            });
        });
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

    // --- Draw axes ---
    const axesG = trajChartG.select(".layer-axes");
    axesG.selectAll("*").remove();

    axesG.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(trajX).ticks(8).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px");

    axesG.append("g")
        .call(d3.axisLeft(trajY).ticks(6).tickFormat(d3.format(",.0f")))
        .selectAll("text")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px");

    // Y-axis label
    axesG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -48)
        .attr("text-anchor", "middle")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "11px")
        .attr("fill", "#666")
        .text("Weekly Hospitalizations");

    // --- Draw historical seasons (context) ---
    const seasonsG = trajChartG.select(".layer-seasons");
    seasonsG.selectAll("*").remove();

    if (hasAnyContext() && historicalSeasons?.[fips]) {
        const seasonNames = Object.keys(historicalSeasons[fips]);
        const currentSeasonStart = new Date("2025-10-01T00:00:00");

        seasonNames.forEach(sName => {
            if (!contextSeasons[sName]) return;
            const season = historicalSeasons[fips][sName];
            const lineData = season
                .filter(d => d.value != null)
                .map(d => {
                    const alignedDate = new Date(currentSeasonStart);
                    alignedDate.setDate(alignedDate.getDate() + d.week * 7);
                    return { date: alignedDate, value: d.value };
                })
                .filter(d => d.date >= showFrom);

            if (lineData.length > 1) {
                const line = d3.line()
                    .x(d => trajX(d.date))
                    .y(d => trajY(d.value))
                    .defined(d => d.value != null);

                seasonsG.append("path")
                    .datum(lineData)
                    .attr("class", "season-line")
                    .attr("d", line)
                    .attr("stroke", SEASON_COLORS[sName] || "#ccc")
                    .attr("fill", "none")
                    .attr("stroke-width", 1.5)
                    .attr("opacity", 0.35);

                // Season label
                const last = lineData[lineData.length - 1];
                seasonsG.append("text")
                    .attr("x", trajX(last.date) + 4)
                    .attr("y", trajY(last.value))
                    .attr("font-family", "Helvetica Neue, Arial, sans-serif")
                    .attr("font-size", "9px")
                    .attr("fill", SEASON_COLORS[sName] || "#ccc")
                    .attr("dominant-baseline", "middle")
                    .text(sName);
            }
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

        sample.forEach(t => {
            const trendKey = `h${colorHorizon}`;
            const trend = t.trends[trendKey] || "stable";
            const color = TREND_COLORS[trend] || "#ccc";

            trajG.append("path")
                .datum(t.values.slice(0, maxHorizons))
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", 1)
                .attr("opacity", 0.25);
        });
    }

    // --- Draw observed data ---
    const obsG = trajChartG.select(".layer-observed");
    obsG.selectAll("*").remove();

    // Split observed into in-sample (on or before ref date) and out-of-sample (after ref date)
    const inSample = recentObserved.filter(d => d.date <= refDateObj);
    const outOfSample = recentObserved.filter(d => d.date > refDateObj);

    if (recentObserved.length > 1) {
        // Draw full connecting line (continuous through both in- and out-of-sample)
        const line = d3.line()
            .x(d => trajX(d.date))
            .y(d => trajY(d.value));

        obsG.append("path")
            .datum(recentObserved)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 2);

        // Invisible wide line for easier hover
        obsG.append("path")
            .datum(recentObserved)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", "transparent")
            .attr("stroke-width", 14)
            .style("pointer-events", "stroke")
            .style("cursor", "default")
            .on("mouseenter", function (event) {
                showNearestObsTooltip(event, recentObserved, refDateObj);
            })
            .on("mousemove", function (event) {
                showNearestObsTooltip(event, recentObserved, refDateObj);
            })
            .on("mouseleave", hideTrajTooltip);

        // In-sample dots: solid black with invisible hit targets
        const allDots = [...inSample.map(d => ({ ...d, label: "Observed" })),
                         ...outOfSample.map(d => ({ ...d, label: "Observed (out-of-sample)" }))];

        // Invisible hit targets (larger radius)
        obsG.selectAll(".obs-hit")
            .data(allDots)
            .join("circle")
            .attr("class", "obs-hit")
            .attr("cx", d => trajX(d.date))
            .attr("cy", d => trajY(d.value))
            .attr("r", 10)
            .attr("fill", "transparent")
            .style("pointer-events", "all")
            .style("cursor", "default")
            .on("mouseenter", (event, d) => showObsTooltip(event, d, d.label))
            .on("mousemove", (event) => positionTrajTooltip(event))
            .on("mouseleave", hideTrajTooltip);

        // Visible in-sample dots
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

        // Visible out-of-sample dots
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

    // --- Click-to-nearest-reference-date interaction ---
    const interG = trajChartG.select(".layer-interaction");
    interG.selectAll("*").remove();

    // Add invisible overlay for click-to-jump
    interG.append("rect")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .style("cursor", "crosshair")
        .on("click", (event) => {
            const [mx] = d3.pointer(event);
            const clickDate = trajX.invert(mx);
            // Find nearest reference date
            let closest = refDates[0];
            let minDist = Infinity;
            refDates.forEach(rd => {
                const rdDate = new Date(rd + "T00:00:00");
                const dist = Math.abs(clickDate - rdDate);
                if (dist < minDist) {
                    minDist = dist;
                    closest = rd;
                }
            });
            if (closest !== AppState.currentRefDate) {
                AppState.currentRefDate = closest;
                buildDateButtons();
                updateAll();
                drawTrajectories();
            }
        })
        .on("mousemove", (event) => {
            // Show a hover indicator for the nearest ref date
            const [mx] = d3.pointer(event);
            const clickDate = trajX.invert(mx);
            let closest = refDates[0];
            let minDist = Infinity;
            refDates.forEach(rd => {
                const rdDate = new Date(rd + "T00:00:00");
                const dist = Math.abs(clickDate - rdDate);
                if (dist < minDist) {
                    minDist = dist;
                    closest = rd;
                }
            });
            const hoverX = trajX(new Date(closest + "T00:00:00"));
            interG.select(".hover-line").remove();
            interG.append("line")
                .attr("class", "hover-line")
                .attr("x1", hoverX).attr("y1", 0)
                .attr("x2", hoverX).attr("y2", innerH)
                .attr("stroke", "#aaa")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "4,3")
                .attr("pointer-events", "none");
        })
        .on("mouseleave", () => {
            interG.select(".hover-line").remove();
        });

    // Draw a small marker for the active reference date (just a tick on x-axis, no vertical line)
    const activeRefX = trajX(refDateObj);
    interG.append("polygon")
        .attr("points", `${activeRefX - 5},${innerH + 2} ${activeRefX + 5},${innerH + 2} ${activeRefX},${innerH + 8}`)
        .attr("fill", "#1a1a1a")
        .attr("pointer-events", "none");

    interG.append("text")
        .attr("x", activeRefX)
        .attr("y", innerH + 20)
        .attr("text-anchor", "middle")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "9px")
        .attr("fill", "#1a1a1a")
        .attr("font-weight", "700")
        .attr("pointer-events", "none")
        .text("Ref: " + d3.timeFormat("%b %d")(refDateObj));

    // --- Draw inset donut chart ---
    drawDonut(fips, colorHorizon, innerH);

    // --- Update trajectory legend ---
    updateTrajLegend();
}

function drawDonut(fips, horizon, innerH) {
    const donutG = trajChartG.select(".layer-donut");
    donutG.selectAll("*").remove();

    const refDate = AppState.currentRefDate;
    const entry = dashboardData.data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return;

    const probs = entry.trend_probs;
    const donutR = Math.round(innerH * 0.275);
    const donutInner = Math.round(donutR * 0.55);
    // Center between Nov 23 and Nov 30 on the x-axis
    const nov23 = new Date("2025-11-23T00:00:00");
    const nov30 = new Date("2025-11-30T00:00:00");
    const cx = (trajX(nov23) + trajX(nov30)) / 2;
    const cy = innerH / 2;

    const g = donutG.append("g")
        .attr("transform", `translate(${cx},${cy})`);

    // Background circle
    g.append("circle")
        .attr("r", donutR + 2)
        .attr("fill", "white")
        .attr("stroke", "#eee")
        .attr("stroke-width", 0.5);

    const arcGen = d3.arc()
        .innerRadius(donutInner)
        .outerRadius(donutR);

    const pie = d3.pie()
        .value(d => d.prob)
        .sort(null);

    const data = TREND_ORDER.map(cat => ({
        cat,
        prob: probs[cat] || 0,
        color: TREND_COLORS[cat]
    }));

    const arcs = pie(data);

    arcs.forEach(arc => {
        if (arc.data.prob > 0) {
            g.append("path")
                .attr("d", arcGen(arc))
                .attr("fill", arc.data.color)
                .attr("stroke", "#fff")
                .attr("stroke-width", 0.5)
                .style("cursor", "default")
                .on("mouseenter", (event) => {
                    const pct = Math.round(arc.data.prob * 100);
                    const label = TREND_LABELS[arc.data.cat];
                    showTextTooltip(event, `${label}: ${pct}%`);
                })
                .on("mousemove", (event) => positionTrajTooltip(event))
                .on("mouseleave", hideTrajTooltip);
        }
    });

    // Center text: most likely category (full name)
    const mostLikely = entry.trend_most_likely;

    g.append("text")
        .attr("class", "donut-label")
        .attr("y", 1)
        .text(TREND_LABELS[mostLikely] || "");

    // Title above donut
    g.append("text")
        .attr("y", -donutR - 6)
        .attr("text-anchor", "middle")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "9px")
        .attr("fill", "#999")
        .text("Trend Dist.");
}

// --- Context dropdown checklist ---

function initContextDropdown() {
    const menu = d3.select("#context-menu");
    menu.selectAll("*").remove();

    Object.keys(contextSeasons).forEach(season => {
        const label = menu.append("label");
        label.append("input")
            .attr("type", "checkbox")
            .property("checked", contextSeasons[season])
            .on("change", function () {
                contextSeasons[season] = this.checked;
                // If user unchecked all individually, turn master off
                showContext = Object.values(contextSeasons).some(v => v);
                updateContextBtnState();
                drawTrajectories();
            });
        label.append("span")
            .attr("class", "season-swatch")
            .style("background", SEASON_COLORS[season] || "#ccc");
        label.append("span").text(season);
    });

    // Main button: master toggle all context lines on/off
    d3.select("#context-btn").on("click", function (e) {
        e.stopPropagation();
        showContext = !showContext;
        // When toggling on, enable all seasons; when off, keep their state but hide all
        if (showContext) {
            Object.keys(contextSeasons).forEach(s => { contextSeasons[s] = true; });
            // Update checkboxes
            menu.selectAll("input[type='checkbox']").property("checked", true);
        }
        updateContextBtnState();
        drawTrajectories();
    });

    // Arrow button: open/close the dropdown for individual season control
    d3.select("#context-arrow").on("click", function (e) {
        e.stopPropagation();
        contextMenuOpen = !contextMenuOpen;
        d3.select("#context-menu").classed("open", contextMenuOpen);
    });

    updateContextBtnState();
}

function updateContextBtnState() {
    d3.select("#context-btn")
        .classed("active", showContext)
        .text(showContext ? "Hide Context" : "Add Context");
}

function hasAnyContext() {
    return showContext && Object.values(contextSeasons).some(v => v);
}

// --- Trajectory legend ---

function updateTrajLegend() {
    const container = d3.select("#traj-legend");
    container.selectAll("*").remove();

    TREND_ORDER.forEach(cat => {
        const item = container.append("span").attr("class", "traj-legend-item");
        item.append("span")
            .attr("class", "traj-legend-swatch")
            .style("background", TREND_COLORS[cat]);
        item.append("span").text(TREND_LABELS[cat]);
    });
}

// --- Trajectory chart tooltips ---

function showNearestObsTooltip(event, data, refDateObj) {
    const [mx] = d3.pointer(event, trajChartG.node());
    const mouseDate = trajX.invert(mx);
    let nearest = data[0];
    let minDist = Infinity;
    data.forEach(d => {
        const dist = Math.abs(d.date - mouseDate);
        if (dist < minDist) { minDist = dist; nearest = d; }
    });
    const label = nearest.date > refDateObj ? "Observed (out-of-sample)" : "Observed";
    showObsTooltip(event, nearest, label);
}

function showObsTooltip(event, d, label) {
    const fmt = d3.timeFormat("%b %d, %Y");
    const valFmt = d3.format(",.0f");
    const rateFmt = d3.format(",.2f");
    const tt = trajTooltip();
    let html = `<strong>${label}</strong><br>Week ending ${fmt(d.date)}<br>${valFmt(d.value)} hospitalizations`;
    if (d.rate != null) {
        html += `<br>${rateFmt(d.rate)} per 100k`;
    }
    tt.html(html);
    tt.classed("visible", true);
    positionTrajTooltip(event);
}

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
