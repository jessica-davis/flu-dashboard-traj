// Evaluations page — Energy Score map + hover time series + trajectory chart

// ====================== STATE ======================
let evalData = null;       // evaluation_scores.json
let evalLocations = null;  // locations.json
let evalTopoData = null;   // us-states.json
let evalTargetData = null; // target_data.json
let evalTrajData = null;   // loaded per-location trajectory JSON
let evalFipsToName = {};
let evalFipsToAbbr = {};

let evalMetric = "es";        // "es" (Energy Score) or "wis" (WIS)
let evalNormalized = true;
let evalRelative = false;     // relative mode: epystrain / baseline ratio
let evalAgg = "last4";        // "last2", "last4"
let evalSingleDate = null;    // when dropdown selects a specific date
let evalColorMode = "obs_fit"; // "obs_fit" or "diversity"
let evalShowBaseline = false; // show baseline quantiles on trajectory chart
let evalAllDates = [];        // sorted reference dates from data
let evalIncompleteDates = {}; // { date: Set(fips that are present) }
let evalBaselineQuantiles = null; // baseline quantile data per location

const EVAL_MAP_W = 560;
const EVAL_MAP_H = 350;
const EVAL_TS_W = 300;
const EVAL_TS_H = 180;
const EVAL_TRAJ_W = 1100;
const EVAL_TRAJ_H = 420;
const EVAL_TRAJ_MARGIN = { top: 20, right: 30, bottom: 40, left: 60 };
const EVAL_FONT = "Helvetica Neue, Arial, sans-serif";

// Track available ref dates from trajectory files (for click-to-jump)
let evalTrajRefDates = [];

// Hover chart legend toggle state
let hoverLegendState = { epystrain: true, baseline: true, surv: true };

// ====================== INIT ======================
async function initEvaluations() {
    try {
        const [scores, locations, topo, target] = await Promise.all([
            d3.json("data/evaluation_scores.json"),
            d3.json("data/locations.json"),
            d3.json("data/us-states.json"),
            d3.json("data/target_data.json")
        ]);
        evalData = scores;
        evalLocations = locations;
        evalTopoData = topo;
        evalTargetData = target;

        evalLocations.forEach(loc => {
            evalFipsToName[loc.fips] = loc.name;
            evalFipsToAbbr[loc.fips] = loc.abbreviation;
        });

        // Extract sorted dates and compute completeness
        evalAllDates = [...new Set(evalData.map(d => d.reference_date))].sort();
        const totalStates = new Set(evalLocations.filter(l => l.fips !== "US").map(l => l.fips)).size;
        evalAllDates.forEach(date => {
            const statesPresent = new Set(
                evalData.filter(d => d.reference_date === date && d.location !== "US")
                    .map(d => d.location)
            );
            if (statesPresent.size < totalStates) {
                evalIncompleteDates[date] = statesPresent;
            }
        });

        // Display last-updated timestamp
        const lastUpdatedEl = document.getElementById("eval-last-updated");
        if (lastUpdatedEl && evalAllDates.length > 0) {
            const refSat = new Date(evalAllDates[evalAllDates.length - 1] + "T00:00:00");
            const wed = new Date(refSat);
            wed.setDate(wed.getDate() - 3);
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const formatted = `${months[wed.getMonth()]} ${wed.getDate()}, ${wed.getFullYear()}`;
            lastUpdatedEl.textContent = `\u00A0\u00A0|\u00A0\u00A0Last Updated: ${formatted}`;
        }

        // Register eval info text for info-btn modals (uses tour.js openInfoModal)
        if (typeof INFO_TEXT !== "undefined") {
            INFO_TEXT["eval-metric"] =
                '<div class="info-section">' +
                '<strong class="info-section-title">Scoring Metrics</strong>' +
                '<p><strong>Energy Score</strong> — A multivariate proper scoring rule that evaluates how well the full ensemble of forecast trajectories matches observed outcomes. ' +
                'It measures both accuracy (are trajectories close to the truth?) and calibration (is the ensemble spread appropriate?).</p>' +
                '<p><strong>WIS</strong> (Weighted Interval Score) — A quantile-based score computed independently for each forecast horizon, then averaged across horizons 0–3. ' +
                'It penalizes wide prediction intervals and observations falling outside them.</p>' +
                '<p>Lower values indicate better forecast performance for both metrics.</p>' +
                '</div>';
            INFO_TEXT["eval-scale"] =
                '<div class="info-section">' +
                '<strong class="info-section-title">Scale Options</strong>' +
                '<p><strong>Normalized</strong> — Score divided by the sum of observed values over the forecast window. ' +
                'This enables fair comparison across locations with different hospitalization magnitudes.</p>' +
                '<p><strong>Raw</strong> — Absolute score in original units (hospital admissions). ' +
                'Larger states will naturally have higher values.</p>' +
                '<p><strong>Relative</strong> — Ratio of the EpyStrain model score to the FluSight-Baseline score. ' +
                'Values below 1 (blue on the map) mean EpyStrain outperforms the baseline; values above 1 (brown) mean the baseline performs better.</p>' +
                '</div>';
            INFO_TEXT["eval-agg"] =
                '<div class="info-section">' +
                '<strong class="info-section-title">Aggregation Window</strong>' +
                '<p><strong>Full Season</strong> — Average score across all available reference dates for the season.</p>' +
                '<p><strong>Last 2 Wk</strong> — Average of the two most recent reference dates only.</p>' +
                '<p><strong>Last 4 Wk</strong> — Average of the four most recent reference dates.</p>' +
                '<p>The reference date dropdown below selects a single date instead of an aggregation.</p>' +
                '</div>';
        }
        if (typeof initInfoButtons === "function") initInfoButtons();

        buildEvalControls();
        drawEvalMap();
        buildTrajControls();
        initTrajChart();
        updateAllEval();
        showDefaultTimeSeries();

    } catch (err) {
        console.error("Failed to load evaluation data:", err);
        document.querySelector("main").innerHTML = `
            <div style="padding:40px;text-align:center;font-family:sans-serif;color:#c00">
                <h2>Error loading evaluations</h2>
                <p>${err.message}</p>
            </div>`;
    }
}

// ====================== HELPERS ======================
function getScoreKey() {
    if (evalMetric === "wis") return evalNormalized ? "WIS_norm" : "WIS";
    return evalNormalized ? "energyscore_norm" : "energyscore";
}

function getBaselineScoreKey() {
    if (evalMetric === "wis") return evalNormalized ? "baseline_WIS_norm" : "baseline_WIS";
    return evalNormalized ? "baseline_energyscore_norm" : "baseline_energyscore";
}

function getScoreLabel() {
    const name = evalMetric === "wis" ? "WIS" : "Energy Score";
    const shortName = evalMetric === "wis" ? "WIS" : "ES";
    if (evalRelative) return shortName + " Ratio (EpyStrain / Baseline)";
    return evalNormalized ? name + " (Normalized)" : name;
}

function formatScore(val) {
    if (val == null) return "N/A";
    if (evalRelative) return val.toFixed(2) + "x";
    return evalNormalized ? val.toFixed(3) : d3.format(",.0f")(val);
}

function fmtShortDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${m[d.getMonth()]} ${d.getDate()}`;
}

function getActiveRefDates() {
    if (evalSingleDate) return [evalSingleDate];
    if (evalAgg === "season") return evalAllDates;
    const n = evalAgg === "last2" ? 2 : 4;
    return evalAllDates.slice(-n);
}

function getStateScores() {
    const dates = getActiveRefDates();
    const result = {};
    const modelKey = getScoreKey();
    const baseKey = getBaselineScoreKey();

    // Accumulate per-state sums (only dates where both model and baseline exist)
    const modelSums = {}, baseSums = {}, counts = {};
    evalData.forEach(d => {
        if (d.location === "US") return;
        if (!dates.includes(d.reference_date)) return;
        const mVal = d[modelKey];
        const bVal = d[baseKey];
        if (mVal == null || isNaN(mVal) || bVal == null || isNaN(bVal)) return;
        if (!modelSums[d.location]) { modelSums[d.location] = 0; baseSums[d.location] = 0; counts[d.location] = 0; }
        modelSums[d.location] += mVal;
        baseSums[d.location] += bVal;
        counts[d.location]++;
    });

    if (evalRelative) {
        // Ratio: mean(model) / mean(baseline) over the same dates
        for (const fips in modelSums) {
            const meanBase = baseSums[fips] / counts[fips];
            result[fips] = meanBase > 0 ? (modelSums[fips] / counts[fips]) / meanBase : null;
        }
    } else {
        // Arithmetic mean of model scores
        for (const fips in modelSums) {
            result[fips] = modelSums[fips] / counts[fips];
        }
    }
    return result;
}

// ====================== CONTROLS ======================
function buildEvalControls() {
    // Metric toggle (ES vs WIS)
    d3.selectAll(".eval-metric-btn").on("click", function () {
        evalMetric = d3.select(this).attr("data-metric");
        d3.selectAll(".eval-metric-btn").classed("active", false);
        d3.select(this).classed("active", true);

        // WIS only supports Raw and Relative (no Normalized)
        const normBtn = d3.select('.eval-norm-btn[data-norm="normalized"]');
        if (evalMetric === "wis") {
            normBtn.style("display", "none");
            if (evalNormalized && !evalRelative) {
                // Switch to raw
                evalNormalized = false;
                evalRelative = false;
                d3.selectAll(".eval-norm-btn").classed("active", false);
                d3.select('.eval-norm-btn[data-norm="raw"]').classed("active", true);
            }
        } else {
            normBtn.style("display", null);
        }

        // Update title
        const metricName = evalMetric === "wis" ? "WIS" : "Energy Score";
        d3.select(".eval-title-row .section-title").text("Model Evaluation with the " + metricName);

        updateAllEval();
    });

    // Scale toggle
    d3.selectAll(".eval-norm-btn").on("click", function () {
        const mode = d3.select(this).attr("data-norm");
        if (mode === "relative") {
            evalRelative = true;
        } else {
            evalRelative = false;
            evalNormalized = mode === "normalized";
        }
        d3.selectAll(".eval-norm-btn").classed("active", false);
        d3.select(this).classed("active", true);
        updateAllEval();
    });

    // Aggregation buttons
    d3.selectAll(".eval-agg-btn").on("click", function () {
        evalAgg = d3.select(this).attr("data-agg");
        evalSingleDate = null;
        d3.selectAll(".eval-agg-btn").classed("active", false);
        d3.select(this).classed("active", true);
        d3.select("#eval-refdate-select").property("value", "");
        updateAllEval();
    });

    // Reference date dropdown
    const sel = d3.select("#eval-refdate-select");
    sel.append("option").attr("value", "").text("— Use aggregation —");
    evalAllDates.forEach(date => {
        const incomplete = evalIncompleteDates[date] ? " *" : "";
        sel.append("option").attr("value", date).text(fmtShortDate(date) + incomplete);
    });
    sel.on("change", function () {
        const val = this.value;
        if (val) {
            evalSingleDate = val;
            d3.selectAll(".eval-agg-btn").classed("active", false);
            // Sync with trajectory chart if this date exists
            if (evalTrajRefDates.includes(val)) {
                d3.select("#eval-traj-refdate").property("value", val);
                drawEvalTrajectories();
            }
        } else {
            evalSingleDate = null;
            // Re-activate current agg button
            d3.selectAll(".eval-agg-btn").each(function () {
                d3.select(this).classed("active", d3.select(this).attr("data-agg") === evalAgg);
            });
        }
        updateAllEval();
    });

    // Color mode buttons
    d3.selectAll(".eval-color-btn").on("click", function () {
        evalColorMode = d3.select(this).attr("data-color");
        d3.selectAll(".eval-color-btn").classed("active", false);
        d3.select(this).classed("active", true);
        drawEvalTrajectories();
    });

    // Baseline toggle buttons
    d3.selectAll(".eval-baseline-btn").on("click", function () {
        evalShowBaseline = d3.select(this).attr("data-show") === "on";
        d3.selectAll(".eval-baseline-btn").classed("active", false);
        d3.select(this).classed("active", true);
        drawEvalTrajectories();
    });
}

function updateAllEval() {
    updateEvalMap();
    updateMapSummary();
    // Refresh the time series for the currently displayed state (or US default)
    drawHoverTimeSeries(_hoverFips || "US");
}

function updateMapSummary() {
    const dates = getActiveRefDates();
    const label = evalSingleDate ? fmtShortDate(evalSingleDate)
        : evalAgg === "season" ? "Full Season Average"
        : evalAgg === "last2" ? "Last 2 Weeks Average"
        : "Last 4 Weeks Average";
    const count = dates.length;
    const incompleteCount = dates.filter(d => evalIncompleteDates[d]).length;

    let html = `<strong>${label}</strong><br>${count} reference date${count !== 1 ? "s" : ""}`;
    if (incompleteCount > 0) {
        const missingStates = [];
        dates.forEach(d => {
            if (!evalIncompleteDates[d]) return;
            const present = evalIncompleteDates[d];
            evalLocations.forEach(loc => {
                if (loc.fips === "US") return;
                if (!present.has(loc.fips) && !missingStates.includes(loc.abbreviation)) {
                    missingStates.push(loc.abbreviation);
                }
            });
        });
        html += `<br><span style="color:#c89a33;font-size:11px">⚠ Incomplete: ${missingStates.join(", ")} missing for some dates</span>`;
    }
    d3.select("#eval-map-summary").html(html);
}

// ====================== MAP ======================
let evalMapSvg, evalMapPath, evalStateFeatures;

function drawEvalMap() {
    evalMapSvg = d3.select("#eval-map")
        .attr("viewBox", `0 0 ${EVAL_MAP_W} ${EVAL_MAP_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    evalMapSvg.selectAll("*").remove();

    evalStateFeatures = topojson.feature(evalTopoData, evalTopoData.objects.states).features;
    const projection = d3.geoAlbersUsa()
        .fitSize([EVAL_MAP_W - 20, EVAL_MAP_H - 10], {
            type: "FeatureCollection", features: evalStateFeatures
        });
    evalMapPath = d3.geoPath().projection(projection);

    // No-data pattern
    const defs = evalMapSvg.append("defs");
    const pat = defs.append("pattern").attr("id","eval-nodata")
        .attr("width",6).attr("height",6)
        .attr("patternUnits","userSpaceOnUse").attr("patternTransform","rotate(45)");
    pat.append("rect").attr("width",6).attr("height",6).attr("fill","#f5f5f5");
    pat.append("line").attr("x1",0).attr("y1",0).attr("x2",0).attr("y2",6)
        .attr("stroke","#ddd").attr("stroke-width",1.5);

    evalMapSvg.selectAll(".eval-state")
        .data(evalStateFeatures).join("path")
        .attr("class", "eval-state")
        .attr("d", evalMapPath)
        .attr("stroke", "#fff").attr("stroke-width", 0.8)
        .on("mouseenter", handleEvalHoverIn)
        .on("mousemove", handleEvalHoverMove)
        .on("mouseleave", handleEvalHoverOut)
        .on("click", handleEvalStateClick);

    evalMapSvg.append("path").attr("class","state-border")
        .datum(topojson.mesh(evalTopoData, evalTopoData.objects.states, (a,b) => a!==b))
        .attr("d", evalMapPath).attr("fill","none").attr("stroke","#fff").attr("stroke-width",0.8);

    // DC inset box (too small to see on the map)
    const dcX = EVAL_MAP_W - 72;
    const dcY = EVAL_MAP_H * 0.52;
    const dcSize = 14;
    const dcG = evalMapSvg.append("g")
        .attr("class", "eval-dc-inset")
        .attr("transform", `translate(${dcX}, ${dcY})`);

    dcG.append("rect")
        .attr("class", "eval-dc-box")
        .attr("width", dcSize).attr("height", dcSize)
        .attr("rx", 2)
        .attr("fill", "url(#eval-nodata)")
        .attr("stroke", "#999").attr("stroke-width", 0.5)
        .attr("cursor", "pointer")
        .datum({ id: 11 })
        .on("mouseenter", handleEvalHoverIn)
        .on("mousemove", handleEvalHoverMove)
        .on("mouseleave", function () {
            d3.select(this).attr("stroke", "#999").attr("stroke-width", 0.5);
            handleEvalHoverOut.call(this);
        })
        .on("click", handleEvalStateClick);

    dcG.append("text")
        .attr("x", dcSize + 3).attr("y", dcSize / 2 + 3.5)
        .attr("text-anchor", "start")
        .attr("font-family", EVAL_FONT)
        .attr("font-size", "9px").attr("fill", "#666")
        .text("DC");
}

function updateEvalMap() {
    const scores = getStateScores();
    const vals = Object.values(scores);
    if (vals.length === 0) return;

    let colorScale;
    if (evalRelative) {
        // Diverging scale centered at 1.0: green (<1 = better) to red (>1 = worse)
        const minVal = d3.min(vals);
        const maxVal = d3.max(vals);
        // Symmetric extent around 1
        const extent = Math.max(Math.abs(minVal - 1), Math.abs(maxVal - 1));
        // Diverging: steel blue (<1, better) → light gray (1) → warm brown (>1, worse)
        const divInterp = (t) => {
            if (t < 0.5) return d3.interpolateLab("#4A7FB5", "#f0f0f0")(t * 2);
            return d3.interpolateLab("#f0f0f0", "#B8663D")((t - 0.5) * 2);
        };
        colorScale = d3.scaleDiverging()
            .domain([1 - extent, 1, 1 + extent])
            .interpolator(divInterp);
    } else {
        colorScale = d3.scaleSequential()
            .domain([d3.min(vals), d3.max(vals)])
            .interpolator(d3.interpolateLab("#eef2f6", "#3D5A80"));
    }

    evalMapSvg.selectAll(".eval-state")
        .attr("fill", d => {
            const fips = getEvalFips(d);
            const s = scores[fips];
            return s != null ? colorScale(s) : "url(#eval-nodata)";
        });

    // Update DC inset box color
    evalMapSvg.select(".eval-dc-box")
        .attr("fill", () => {
            const s = scores["11"];
            return s != null ? colorScale(s) : "url(#eval-nodata)";
        });

    drawEvalLegend(colorScale, d3.min(vals), d3.max(vals));
}

function getEvalFips(d) {
    const id = d.id || d.properties?.STATEFP;
    return id ? String(id).padStart(2, "0") : null;
}

// ====================== MAP HOVER — TIME SERIES ======================
let _hoverFips = null;

function handleEvalHoverIn(event, d) {
    const fips = getEvalFips(d);
    _hoverFips = fips;
    d3.select(this).attr("stroke", "#1a1a1a").attr("stroke-width", 2);
    drawHoverTimeSeries(fips);
}

function handleEvalHoverMove(event) {
    // tooltip positioned in fixed panel, no movement needed
}

function handleEvalHoverOut() {
    _hoverFips = null;
    d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.8);
    // Return to US default instead of clearing
    drawHoverTimeSeries("US");
}

function handleEvalStateClick(event, d) {
    const fips = getEvalFips(d);
    // Jump trajectory plot to this state
    d3.select("#eval-traj-location").property("value", fips);
    loadAndDrawEvalTraj();
}

function drawHoverTimeSeries(fips) {
    const svg = d3.select("#eval-ts-chart");
    svg.selectAll("*").remove();

    const name = fips === "US" ? "United States" : (evalFipsToName[fips] || fips);
    const stateRows = evalData.filter(d => d.location === fips);

    const margin = { top: 44, right: 12, bottom: 28, left: 48 };
    const innerW = EVAL_TS_W - margin.left - margin.right;
    const innerH = EVAL_TS_H - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${EVAL_TS_W} ${EVAL_TS_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Incomplete dates for this state
    const incompleteForState = new Set();
    evalAllDates.forEach(dateStr => {
        if (!evalIncompleteDates[dateStr]) return;
        const hasState = stateRows.some(d => d.reference_date === dateStr);
        if (!hasState) incompleteForState.add(dateStr);
    });

    if (evalRelative) {
        // ── RELATIVE MODE: single ratio line + y=1 reference ──
        const esKey = getScoreKey();
        const blKey = getBaselineScoreKey();
        const ratioPoints = evalAllDates.map(date => {
            const row = stateRows.find(d => d.reference_date === date);
            let value = null;
            if (row && row[esKey] != null && row[blKey] != null && row[blKey] !== 0) {
                value = row[esKey] / row[blKey];
            }
            return { date: new Date(date + "T00:00:00"), dateStr: date, value };
        });

        const validRatio = ratioPoints.filter(d => d.value != null);
        if (validRatio.length === 0) return;

        const x = d3.scaleTime().domain(d3.extent(ratioPoints, d => d.date)).range([0, innerW]);
        const rVals = validRatio.map(d => d.value);
        const yMin = Math.min(d3.min(rVals), 1) * 0.9;
        const yMax = Math.max(d3.max(rVals), 1) * 1.1;
        const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

        // Axes
        g.append("g").attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")))
            .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#888");
        g.append("g")
            .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".2f")))
            .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#888");
        g.selectAll(".domain").attr("stroke", "#ccc");
        g.selectAll(".tick line").attr("stroke", "#ddd");

        // Surveillance line (faint gray, renormalized to fit)
        const survData = (evalTargetData?.[fips] || [])
            .filter(d => d.value != null)
            .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value }));
        const xDomainRel = x.domain();
        const survInRangeRel = survData.filter(d => d.date >= xDomainRel[0] && d.date <= xDomainRel[1]);
        if (survInRangeRel.length > 1) {
            const survMax = d3.max(survInRangeRel, d => d.value) || 1;
            const survY = d3.scaleLinear().domain([0, survMax]).range([innerH, y(yMax * 0.95)]);
            const survLine = d3.line().x(d => x(d.date)).y(d => survY(d.value));
            g.append("path").datum(survInRangeRel)
                .attr("d", survLine).attr("fill", "none")
                .attr("stroke", "#ddd").attr("stroke-width", 1.5);
        }

        // Dashed y=1 reference line
        g.append("line")
            .attr("x1", 0).attr("x2", innerW)
            .attr("y1", y(1)).attr("y2", y(1))
            .attr("stroke", "#999").attr("stroke-width", 1).attr("stroke-dasharray", "4,3");

        // Ratio line
        const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => d.value != null);
        g.append("path").datum(validRatio)
            .attr("d", line).attr("fill", "none")
            .attr("stroke", "#555").attr("stroke-width", 2);
        g.selectAll(".ratio-dot").data(validRatio).join("circle")
            .attr("cx", d => x(d.date)).attr("cy", d => y(d.value))
            .attr("r", 3.5)
            .attr("fill", d => incompleteForState.has(d.dateStr) ? "#fff" : "#555")
            .attr("stroke", "#555").attr("stroke-width", 1.5);

        // Legend (above the title)
        const hasRelSurv = survInRangeRel.length > 1;
        const relLegendW = hasRelSurv ? 150 : 90;
        const legendG = svg.append("g").attr("transform", `translate(${EVAL_TS_W - margin.right - relLegendW}, 2)`);
        let lx = 0;
        legendG.append("line").attr("x1", lx).attr("x2", lx + 14).attr("y1", 4).attr("y2", 4)
            .attr("stroke", "#555").attr("stroke-width", 2);
        legendG.append("text").attr("x", lx + 18).attr("y", 7)
            .attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#555").text("Ratio");
        lx += 48;
        legendG.append("line").attr("x1", lx).attr("x2", lx + 14).attr("y1", 4).attr("y2", 4)
            .attr("stroke", "#999").attr("stroke-width", 1).attr("stroke-dasharray", "4,3");
        legendG.append("text").attr("x", lx + 18).attr("y", 7)
            .attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#999").text("y=1");
        if (hasRelSurv) {
            lx += 38;
            legendG.append("line").attr("x1", lx).attr("x2", lx + 14).attr("y1", 4).attr("y2", 4)
                .attr("stroke", "#ddd").attr("stroke-width", 1.5);
            legendG.append("text").attr("x", lx + 18).attr("y", 7)
                .attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#ccc").text("Hosp.");
        }

    } else {
        // ── NORMAL MODE: epystrain + baseline + surveillance ──
        const key = getScoreKey();
        const blKey = getBaselineScoreKey();

        const dataPoints = evalAllDates.map(date => {
            const row = stateRows.find(d => d.reference_date === date);
            return { date: new Date(date + "T00:00:00"), dateStr: date, value: row ? row[key] : null };
        });
        const baselinePoints = evalAllDates.map(date => {
            const row = stateRows.find(d => d.reference_date === date);
            return { date: new Date(date + "T00:00:00"), dateStr: date, value: row ? row[blKey] : null };
        });

        const x = d3.scaleTime().domain(d3.extent(dataPoints, d => d.date)).range([0, innerW]);
        const validVals = dataPoints.filter(d => d.value != null).map(d => d.value);
        const blValidVals = baselinePoints.filter(d => d.value != null).map(d => d.value);
        const yMax = d3.max([...validVals, ...blValidVals]) || 1;
        const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([innerH, 0]);

        // Axes
        g.append("g").attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")))
            .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#888");
        g.append("g")
            .call(d3.axisLeft(y).ticks(4).tickFormat(evalNormalized ? d3.format(".2f") : d3.format(",.0f")))
            .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#888");
        g.selectAll(".domain").attr("stroke", "#ccc");
        g.selectAll(".tick line").attr("stroke", "#ddd");

        // Track drawn layers for legend toggling
        const layers = {};

        // Surveillance line (faint gray, renormalized)
        const survData = (evalTargetData?.[fips] || [])
            .filter(d => d.value != null)
            .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value }));
        const xDomain = x.domain();
        const survInRange = survData.filter(d => d.date >= xDomain[0] && d.date <= xDomain[1]);
        if (survInRange.length > 1 && validVals.length > 0) {
            const survMax = d3.max(survInRange, d => d.value) || 1;
            const yDomain = y.domain();
            const survY = d3.scaleLinear().domain([0, survMax]).range([innerH, y(yDomain[1] * 0.95)]);
            const survLine = d3.line().x(d => x(d.date)).y(d => survY(d.value));
            layers.surv = g.append("path").datum(survInRange)
                .attr("d", survLine).attr("fill", "none")
                .attr("stroke", "#ddd").attr("stroke-width", 1.5)
                .attr("opacity", hoverLegendState.surv ? 1 : 0);
        }

        // EpyStrain line + dots
        const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => d.value != null);
        const validPoints = dataPoints.filter(d => d.value != null);
        const epyLine = g.append("path").datum(validPoints)
            .attr("d", line).attr("fill", "none")
            .attr("stroke", "#5B7065").attr("stroke-width", 2)
            .attr("opacity", hoverLegendState.epystrain ? 1 : 0);
        const epyDots = g.selectAll(".ts-dot").data(validPoints).join("circle")
            .attr("cx", d => x(d.date)).attr("cy", d => y(d.value))
            .attr("r", 4)
            .attr("fill", d => incompleteForState.has(d.dateStr) ? "#fff" : "#5B7065")
            .attr("stroke", "#5B7065").attr("stroke-width", 1.5)
            .attr("opacity", hoverLegendState.epystrain ? 1 : 0);
        layers.epystrain = { line: epyLine, dots: epyDots };

        // Baseline line (no markers)
        const blValid = baselinePoints.filter(d => d.value != null);
        if (blValid.length > 0) {
            const blLine = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => d.value != null);
            layers.baseline = g.append("path").datum(blValid)
                .attr("d", blLine).attr("fill", "none")
                .attr("stroke", "#C45B5B").attr("stroke-width", 1.5)
                .attr("opacity", hoverLegendState.baseline ? 1 : 0);
        }

        // Interactive legend
        const legendItems = [];
        legendItems.push({ key: "epystrain", color: "#5B7065", label: "EpyStrain", dash: null });
        if (blValid.length > 0) {
            legendItems.push({ key: "baseline", color: "#C45B5B", label: "Baseline", dash: null });
        }
        if (survInRange.length > 1) {
            legendItems.push({ key: "surv", color: "#ccc", label: "Hosp.", dash: null });
        }

        const legendG = svg.append("g").attr("transform",
            `translate(${EVAL_TS_W - margin.right - legendItems.length * 62}, 2)`);
        legendItems.forEach((item, i) => {
            const ig = legendG.append("g")
                .attr("transform", `translate(${i * 62}, 0)`)
                .style("cursor", "pointer")
                .on("click", () => {
                    hoverLegendState[item.key] = !hoverLegendState[item.key];
                    drawHoverTimeSeries(fips);
                });
            const active = hoverLegendState[item.key];
            ig.append("line").attr("x1", 0).attr("x2", 12).attr("y1", 5).attr("y2", 5)
                .attr("stroke", item.color).attr("stroke-width", 2)
                .attr("opacity", active ? 1 : 0.3);
            ig.append("text").attr("x", 15).attr("y", 8)
                .attr("font-family", EVAL_FONT).attr("font-size", "9px")
                .attr("fill", item.color).attr("font-weight", "500")
                .attr("opacity", active ? 1 : 0.3)
                .text(item.label);
        });

        // Incomplete warning
        if (incompleteForState.size > 0) {
            svg.append("text")
                .attr("x", EVAL_TS_W - margin.right).attr("y", EVAL_TS_H - 2)
                .attr("text-anchor", "end")
                .attr("font-family", EVAL_FONT).attr("font-size", "8px")
                .attr("fill", "#c89a33")
                .text("○ = incomplete data");
        }
    }

    // Title
    svg.append("text")
        .attr("x", margin.left).attr("y", 24)
        .attr("font-family", EVAL_FONT).attr("font-size", "13px")
        .attr("font-weight", "600").attr("fill", "#1a1a1a")
        .text(name);

    // Y label
    svg.append("text")
        .attr("x", margin.left + 2).attr("y", 36)
        .attr("font-family", EVAL_FONT).attr("font-size", "9px")
        .attr("fill", "#999")
        .text(getScoreLabel());
}

function showDefaultTimeSeries() {
    drawHoverTimeSeries("US");
}

// ====================== LEGEND ======================
function drawEvalLegend(colorScale, minVal, maxVal) {
    const container = d3.select("#eval-legend");
    container.selectAll("*").remove();
    const barW = 12, barH = 140, labelOffset = 20;
    const svgW = barW + 80, svgH = barH + 24;
    const svg = container.append("svg").attr("width", svgW).attr("height", svgH);
    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id","eval-lg")
        .attr("x1","0%").attr("x2","0%").attr("y1","0%").attr("y2","100%");

    if (evalRelative) {
        // Diverging: symmetric around 1
        const extent = Math.max(Math.abs(minVal - 1), Math.abs(maxVal - 1));
        const lo = 1 - extent, hi = 1 + extent;
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const val = lo + t * (hi - lo);
            const divLegendInterp = (s) => {
                if (s < 0.5) return d3.interpolateLab("#4A7FB5", "#f0f0f0")(s * 2);
                return d3.interpolateLab("#f0f0f0", "#B8663D")((s - 0.5) * 2);
            };
            grad.append("stop").attr("offset", `${t*100}%`)
                .attr("stop-color", divLegendInterp(t));
        }
        svg.append("rect").attr("x", 0).attr("y", 12).attr("width", barW).attr("height", barH)
            .attr("rx", 2).attr("fill","url(#eval-lg)");
        // Labels: top = better (<1), middle = 1.0, bottom = worse (>1)
        svg.append("text").attr("x", labelOffset).attr("y", 20)
            .attr("font-family",EVAL_FONT).attr("font-size","9px").attr("fill","#666")
            .text(`< 1 Better`);
        const midY = 12 + barH / 2;
        svg.append("line").attr("x1", 0).attr("x2", barW).attr("y1", midY).attr("y2", midY)
            .attr("stroke", "#333").attr("stroke-width", 1);
        svg.append("text").attr("x", labelOffset).attr("y", midY + 3)
            .attr("font-family",EVAL_FONT).attr("font-size","9px").attr("fill","#333").attr("font-weight","600")
            .text("1.0");
        svg.append("text").attr("x", labelOffset).attr("y", barH + 12)
            .attr("font-family",EVAL_FONT).attr("font-size","9px").attr("fill","#666")
            .text(`> 1 Worse`);
    } else {
        for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            grad.append("stop").attr("offset",`${t*100}%`)
                .attr("stop-color", colorScale(minVal + t * (maxVal - minVal)));
        }
        svg.append("rect").attr("x", 0).attr("y", 12).attr("width", barW).attr("height", barH)
            .attr("rx", 2).attr("fill","url(#eval-lg)");
        svg.append("text").attr("x", labelOffset).attr("y", 20)
            .attr("font-family",EVAL_FONT).attr("font-size","9px").attr("fill","#666")
            .text(formatScore(minVal) + " (best)");
        svg.append("text").attr("x", labelOffset).attr("y", barH + 12)
            .attr("font-family",EVAL_FONT).attr("font-size","9px").attr("fill","#666")
            .text(formatScore(maxVal) + " (worst)");
    }
}

// ====================== TRAJECTORY CONTROLS ======================
function buildTrajControls() {
    const locSel = d3.select("#eval-traj-location");
    evalLocations.forEach(loc => {
        locSel.append("option").attr("value", loc.fips)
            .text(loc.fips === "US" ? "US National" : loc.name);
    });
    locSel.property("value", "US");
    locSel.on("change", loadAndDrawEvalTraj);

    // Ref date dropdown will be populated by loadAndDrawEvalTraj (from trajectory data)
    d3.select("#eval-traj-refdate").on("change", function () {
        const val = this.value;
        // Sync with map if this date exists in score data
        if (evalAllDates.includes(val)) {
            evalSingleDate = val;
            d3.selectAll(".eval-agg-btn").classed("active", false);
            d3.select("#eval-refdate-select").property("value", val);
            updateAllEval();
        }
        drawEvalTrajectories();
    });
}

// ====================== TRAJECTORY CHART ======================
let evalTrajSvg, evalTrajG;

function initTrajChart() {
    evalTrajSvg = d3.select("#eval-traj-chart")
        .attr("viewBox", `0 0 ${EVAL_TRAJ_W} ${EVAL_TRAJ_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    evalTrajG = evalTrajSvg.append("g")
        .attr("transform", `translate(${EVAL_TRAJ_MARGIN.left},${EVAL_TRAJ_MARGIN.top})`);

    // Layers (interaction on top for click handling)
    evalTrajG.append("g").attr("class", "layer-traj-bg");
    evalTrajG.append("g").attr("class", "layer-traj-lines");
    evalTrajG.append("g").attr("class", "layer-traj-baseline");
    evalTrajG.append("g").attr("class", "layer-traj-axes");
    evalTrajG.append("g").attr("class", "layer-traj-observed");
    evalTrajG.append("g").attr("class", "layer-traj-interaction");

    loadAndDrawEvalTraj();
}

async function loadAndDrawEvalTraj() {
    const fips = d3.select("#eval-traj-location").property("value");
    try {
        evalTrajData = await d3.json(`data/trajectories/${fips}.json`);
    } catch {
        evalTrajData = null;
    }
    try {
        evalBaselineQuantiles = await d3.json(`data/baseline_quantiles/${fips}.json`);
    } catch {
        evalBaselineQuantiles = null;
    }

    // Extract available ref dates from trajectory data and update dropdown
    if (evalTrajData?.data) {
        evalTrajRefDates = Object.keys(evalTrajData.data).sort();
        const dateSel = d3.select("#eval-traj-refdate");
        const currentVal = dateSel.property("value");
        dateSel.selectAll("option").remove();
        evalTrajRefDates.forEach(date => {
            dateSel.append("option").attr("value", date).text(fmtShortDate(date));
        });
        // Keep current selection if still available, otherwise use latest
        if (evalTrajRefDates.includes(currentVal)) {
            dateSel.property("value", currentVal);
        } else {
            dateSel.property("value", evalTrajRefDates[evalTrajRefDates.length - 1]);
        }
    }
    drawEvalTrajectories();
}

function drawEvalTrajectories() {
    const fips = d3.select("#eval-traj-location").property("value");
    const refDate = d3.select("#eval-traj-refdate").property("value");
    const M = EVAL_TRAJ_MARGIN;
    const innerW = EVAL_TRAJ_W - M.left - M.right;
    const innerH = EVAL_TRAJ_H - M.top - M.bottom;

    // Clear layers
    evalTrajG.select(".layer-traj-bg").selectAll("*").remove();
    evalTrajG.select(".layer-traj-lines").selectAll("*").remove();
    evalTrajG.select(".layer-traj-baseline").selectAll("*").remove();
    evalTrajG.select(".layer-traj-axes").selectAll("*").remove();
    evalTrajG.select(".layer-traj-observed").selectAll("*").remove();
    evalTrajG.select(".layer-traj-interaction").selectAll("*").remove();

    // Observed data
    const observed = (evalTargetData?.[fips] || [])
        .filter(d => d.value != null)
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value }));
    const showFrom = new Date("2025-11-01T00:00:00");
    const recentObs = observed.filter(d => d.date >= showFrom);

    // Trajectory data for selected ref date
    const refTrajData = evalTrajData?.data?.[refDate];
    const maxH = 4; // 4 horizons

    // Build date domain
    let allDates = recentObs.map(d => d.date);
    allDates.push(showFrom);
    let allVals = recentObs.map(d => d.value);

    let trajDates = [];
    if (refTrajData) {
        trajDates = refTrajData.dates.slice(0, maxH).map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(trajDates);
        refTrajData.trajectories.forEach(t => {
            t.values.slice(0, maxH).forEach(v => { if (v != null) allVals.push(v); });
        });
    }
    // Include baseline quantile values in domain
    const blQuantileData = evalBaselineQuantiles?.data?.[refDate];
    if (evalShowBaseline && blQuantileData) {
        const blDates = blQuantileData.dates.map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(blDates);
        blQuantileData.q95.forEach(v => { if (v != null) allVals.push(v); });
    }
    if (allDates.length === 0) return;

    const xScale = d3.scaleTime().domain(d3.extent(allDates)).range([0, innerW]);
    const yMax = d3.max(allVals) || 1;
    const yScale = d3.scaleLinear().domain([0, yMax * 1.05]).range([innerH, 0]);

    // --- Compute ES components per trajectory ---
    let trajScores = null;
    if (refTrajData && refTrajData.trajectories.length > 0) {
        // Get observation values aligned to trajectory dates
        const obsVals = trajDates.map(td => {
            const match = recentObs.find(o => Math.abs(o.date - td) < 2 * 86400000);
            return match ? match.value : null;
        });
        const hasObs = obsVals.every(v => v != null);

        const trajs = refTrajData.trajectories;
        const N = trajs.length;

        trajScores = trajs.map((t, i) => {
            const vals = t.values.slice(0, maxH);

            // Component 1: Distance to observation
            let obsDist = null;
            if (hasObs) {
                let sumSq = 0;
                for (let h = 0; h < maxH; h++) {
                    if (vals[h] != null && obsVals[h] != null) {
                        sumSq += (vals[h] - obsVals[h]) ** 2;
                    }
                }
                obsDist = Math.sqrt(sumSq);
            }

            // Component 2: Average pairwise distance to others
            let pairwiseDist = 0;
            let pairCount = 0;
            // Sample to keep it fast: compare to ~50 random others
            const sampleSize = Math.min(N, 50);
            const step = Math.max(1, Math.floor(N / sampleSize));
            for (let j = 0; j < N; j += step) {
                if (j === i) continue;
                let sq = 0;
                const otherVals = trajs[j].values.slice(0, maxH);
                for (let h = 0; h < maxH; h++) {
                    if (vals[h] != null && otherVals[h] != null) {
                        sq += (vals[h] - otherVals[h]) ** 2;
                    }
                }
                pairwiseDist += Math.sqrt(sq);
                pairCount++;
            }
            pairwiseDist = pairCount > 0 ? pairwiseDist / pairCount : 0;

            return { idx: i, obsDist, pairwiseDist };
        });
    }

    // --- Draw background: reference date line ---
    const bgG = evalTrajG.select(".layer-traj-bg");
    const refDateObj = new Date(refDate + "T00:00:00");
    if (refDateObj >= xScale.domain()[0] && refDateObj <= xScale.domain()[1]) {
        bgG.append("line")
            .attr("x1", xScale(refDateObj)).attr("x2", xScale(refDateObj))
            .attr("y1", 0).attr("y2", innerH)
            .attr("stroke", "#ddd").attr("stroke-width", 1).attr("stroke-dasharray", "4,3");
        bgG.append("text")
            .attr("x", xScale(refDateObj) + 4).attr("y", 12)
            .attr("font-family", EVAL_FONT).attr("font-size", "10px")
            .attr("fill", "#aaa").text("Ref date");
    }

    // --- Draw trajectories ---
    const trajG = evalTrajG.select(".layer-traj-lines");

    if (refTrajData && trajDates.length > 0) {
        const line = d3.line()
            .x((v, i) => xScale(trajDates[i]))
            .y(v => yScale(v))
            .defined(v => v != null);

        // Build color scales based on scores
        let obsColorScale = null, pairColorScale = null;
        if (trajScores) {
            const obsVals = trajScores.filter(s => s.obsDist != null).map(s => s.obsDist);
            if (obsVals.length > 0) {
                // Blue (close/good) → Orange (far/bad), Lab space for perceptual uniformity
                const obsFitInterp = d3.interpolateLab("#4B9AC1", "#E8A56D");
                obsColorScale = d3.scaleSequential()
                    .domain([d3.min(obsVals), d3.max(obsVals)])
                    .interpolator(obsFitInterp);
            }
            const pairVals = trajScores.map(s => s.pairwiseDist);
            pairColorScale = d3.scaleSequential()
                .domain([d3.min(pairVals), d3.max(pairVals)])
                .interpolator(d3.interpolateViridis); // purple=low(clustered), yellow=high(diverse)
        }

        refTrajData.trajectories.forEach((t, i) => {
            const vals = t.values.slice(0, maxH);
            let color = "#999";
            let opacity = 0.25;

            if (trajScores && trajScores[i]) {
                const score = trajScores[i];
                if (evalColorMode === "obs_fit" && obsColorScale && score.obsDist != null) {
                    color = obsColorScale(score.obsDist);
                    opacity = 0.45;
                } else if (evalColorMode === "diversity" && pairColorScale) {
                    color = pairColorScale(score.pairwiseDist);
                    opacity = 0.45;
                }
            }

            trajG.append("path")
                .datum(vals)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", color)
                .attr("stroke-width", 1.5)
                .attr("opacity", opacity);
        });
    }

    // --- Draw baseline quantile ribbons ---
    const blG = evalTrajG.select(".layer-traj-baseline");
    if (evalShowBaseline && blQuantileData && blQuantileData.dates.length > 0) {
        const blDates = blQuantileData.dates.map(d => new Date(d + "T00:00:00"));

        // 90% CI ribbon (q05-q95)
        const area90 = d3.area()
            .x((d, i) => xScale(blDates[i]))
            .y0((d, i) => yScale(blQuantileData.q05[i]))
            .y1((d, i) => yScale(blQuantileData.q95[i]));
        blG.append("path").datum(blQuantileData.median)
            .attr("d", area90).attr("fill", "#C45B5B").attr("opacity", 0.1);

        // 50% CI ribbon (q25-q75)
        const area50 = d3.area()
            .x((d, i) => xScale(blDates[i]))
            .y0((d, i) => yScale(blQuantileData.q25[i]))
            .y1((d, i) => yScale(blQuantileData.q75[i]));
        blG.append("path").datum(blQuantileData.median)
            .attr("d", area50).attr("fill", "#C45B5B").attr("opacity", 0.18);

        // Median line
        const medLine = d3.line()
            .x((d, i) => xScale(blDates[i]))
            .y(d => yScale(d));
        blG.append("path").datum(blQuantileData.median)
            .attr("d", medLine).attr("fill", "none")
            .attr("stroke", "#C45B5B").attr("stroke-width", 2);
    }

    // --- Draw axes ---
    const axesG = evalTrajG.select(".layer-traj-axes");
    axesG.append("g").attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "12px").attr("fill", "#888");

    axesG.append("g")
        .call(d3.axisLeft(yScale).ticks(6).tickFormat(d3.format(",.0f")))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "12px").attr("fill", "#888");

    // Style axis lines
    axesG.selectAll(".domain").attr("stroke", "#ccc");
    axesG.selectAll(".tick line").attr("stroke", "#ddd");

    axesG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2).attr("y", -48)
        .attr("text-anchor", "middle").attr("font-family", EVAL_FONT)
        .attr("font-size", "12px").attr("fill", "#666")
        .text("Weekly Hospitalizations");

    // --- Draw observed ---
    const obsG = evalTrajG.select(".layer-traj-observed");
    if (recentObs.length > 1) {
        const obsLine = d3.line().x(d => xScale(d.date)).y(d => yScale(d.value));

        // Split in-sample vs out-of-sample
        const inSample = recentObs.filter(d => d.date < refDateObj);
        const outSample = recentObs.filter(d => d.date >= refDateObj);

        obsG.append("path").datum(recentObs)
            .attr("d", obsLine).attr("fill", "none")
            .attr("stroke", "#1a1a1a").attr("stroke-width", 2);

        obsG.selectAll(".obs-in").data(inSample).join("circle")
            .attr("cx", d => xScale(d.date)).attr("cy", d => yScale(d.value))
            .attr("r", 3.5).attr("fill", "#1a1a1a");

        obsG.selectAll(".obs-out").data(outSample).join("circle")
            .attr("cx", d => xScale(d.date)).attr("cy", d => yScale(d.value))
            .attr("r", 3.5).attr("fill", "#fff").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5);
    }

    // --- Draw reference date tick marks (other available dates) ---
    if (evalTrajRefDates.length > 0) {
        evalTrajRefDates.forEach(rd => {
            const rdObj = new Date(rd + "T00:00:00");
            if (rdObj < xScale.domain()[0] || rdObj > xScale.domain()[1]) return;
            if (rd === refDate) return; // skip current (already drawn above)
            bgG.append("line")
                .attr("x1", xScale(rdObj)).attr("x2", xScale(rdObj))
                .attr("y1", innerH - 8).attr("y2", innerH)
                .attr("stroke", "#ccc").attr("stroke-width", 1);
        });
    }

    // --- Interaction overlay for click-to-change-ref-date ---
    const interG = evalTrajG.select(".layer-traj-interaction");
    interG.append("rect")
        .attr("width", innerW).attr("height", innerH)
        .attr("fill", "none").attr("pointer-events", "all")
        .style("cursor", "crosshair")
        .on("click", (event) => {
            if (evalTrajRefDates.length === 0) return;
            const [mx] = d3.pointer(event);
            const clickDate = xScale.invert(mx);
            let closest = evalTrajRefDates[0];
            let minDist = Infinity;
            evalTrajRefDates.forEach(rd => {
                const rdDate = new Date(rd + "T00:00:00");
                const dist = Math.abs(clickDate - rdDate);
                if (dist < minDist) { minDist = dist; closest = rd; }
            });
            const currentRefDate = d3.select("#eval-traj-refdate").property("value");
            if (closest !== currentRefDate) {
                d3.select("#eval-traj-refdate").property("value", closest);
                // Sync with map if this date exists in score data
                if (evalAllDates.includes(closest)) {
                    evalSingleDate = closest;
                    d3.selectAll(".eval-agg-btn").classed("active", false);
                    d3.select("#eval-refdate-select").property("value", closest);
                    updateAllEval();
                }
                drawEvalTrajectories();
            }
        });

    // --- Legend ---
    updateEvalTrajLegend(trajScores);
}

function updateEvalTrajLegend(trajScores) {
    const container = d3.select("#eval-traj-legend");
    container.selectAll("*").remove();

    if (!trajScores) return;

    const w = 200, h = 16;

    if (evalColorMode === "obs_fit") {
        const obsVals = trajScores.filter(s => s.obsDist != null).map(s => s.obsDist);
        if (obsVals.length === 0) {
            container.append("span").attr("class", "traj-legend-item")
                .style("color", "#999").text("No observed data available for comparison");
            return;
        }
        // Blue (close) → Orange (far) gradient, sampled in Lab space
        const svg = container.append("svg").attr("width", w + 120).attr("height", 30);
        svg.append("text").attr("x", 0).attr("y", 10)
            .attr("font-family", EVAL_FONT).attr("font-size", "11px")
            .attr("fill", "#555").attr("font-weight", "600")
            .text("Fit to Data:");
        const defs = svg.append("defs");
        const grad = defs.append("linearGradient").attr("id", "eval-tl-obs").attr("x1", "0%").attr("x2", "100%");
        const obsLegendInterp = d3.interpolateLab("#4B9AC1", "#E8A56D");
        for (let i = 0; i <= 10; i++) {
            grad.append("stop").attr("offset", `${i * 10}%`).attr("stop-color", obsLegendInterp(i / 10));
        }
        svg.append("rect").attr("x", 80).attr("y", 2).attr("width", w).attr("height", h).attr("rx", 2).attr("fill", "url(#eval-tl-obs)");
        svg.append("text").attr("x", 80).attr("y", 28).attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#666").text("Close");
        svg.append("text").attr("x", 80 + w).attr("y", 28).attr("text-anchor", "end").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#666").text("Far");
    } else {
        const svg = container.append("svg").attr("width", w + 140).attr("height", 30);
        svg.append("text").attr("x", 0).attr("y", 10)
            .attr("font-family", EVAL_FONT).attr("font-size", "11px")
            .attr("fill", "#555").attr("font-weight", "600")
            .text("Ensemble Diversity:");
        const defs = svg.append("defs");
        const grad = defs.append("linearGradient").attr("id", "eval-tl-div").attr("x1", "0%").attr("x2", "100%");
        for (let i = 0; i <= 10; i++) {
            grad.append("stop").attr("offset", `${i * 10}%`).attr("stop-color", d3.interpolateViridis(i / 10));
        }
        svg.append("rect").attr("x", 120).attr("y", 2).attr("width", w).attr("height", h).attr("rx", 2).attr("fill", "url(#eval-tl-div)");
        svg.append("text").attr("x", 120).attr("y", 28).attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#666").text("Clustered");
        svg.append("text").attr("x", 120 + w).attr("y", 28).attr("text-anchor", "end").attr("font-family", EVAL_FONT).attr("font-size", "9px").attr("fill", "#666").text("Diverse");
    }

    // Observed data legend
    const obsItem = container.append("span").attr("class", "traj-legend-item").style("margin-left", "16px");
    obsItem.append("span").attr("class", "traj-legend-swatch").style("background", "#1a1a1a");
    obsItem.append("span").text("Observed");

    // Baseline legend (when shown)
    if (evalShowBaseline) {
        const blItem = container.append("span").attr("class", "traj-legend-item").style("margin-left", "16px");
        blItem.append("span").attr("class", "traj-legend-swatch").style("background", "#C45B5B");
        blItem.append("span").text("Baseline (median)");

        const blBand = container.append("span").attr("class", "traj-legend-item").style("margin-left", "8px");
        blBand.append("span").attr("class", "traj-legend-swatch").style("background", "rgba(196,91,91,0.25)");
        blBand.append("span").text("50%/90% CI");
    }
}

// ====================== START ======================
initEvaluations();
