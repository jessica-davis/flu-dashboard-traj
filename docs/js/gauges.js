// Summary gauges: Influenza Activity, Influenza Trend (first tab) and Season
// Start, Peak Week (second tab). Each has a dial, a one-sentence summary, a
// confidence line and, behind "Show all chances", the full distribution.
// Every routine takes the container and the data it needs; nothing here reads
// the selected view.

const DIAL_WIDTH = 290;   // room for side labels, anchored outward
const DIAL_HEIGHT = 134;
const DIAL_RADIUS = 80;
const DIAL_INNER_RADIUS = 48;
const DIAL_CENTER_Y = DIAL_HEIGHT - 26;
const DIAL_LABEL_R = DIAL_RADIUS + 10;

const PEAK_GOLD = "#C9920A";
const peakRamp = d3.interpolateRgb("#F6EBCB", PEAK_GOLD);
const onsetRamp = p => seasonStartColor(p);

const VIEWS = ["activity", "trend", "onset", "peak"];

// The location the gauges describe: the state picked on the map or in the
// chart's dropdown (the dashboard), or the default (the Methods page).
function currentLoc() {
    return (typeof AppState !== "undefined" && AppState.selectedState) || DEFAULT_LOCATION;
}

// Trend limits in weekly admissions for a location and forecast week:
// {ld, d, i, li}. tt holds rate changes per 100k; a change smaller than
// `floor` admissions is always Stable, so every limit is at least that far
// from zero.
function trendLimits(tt, population, floor) {
    const v = r => {
        const x = r * population / 100000;
        return Math.sign(r) * Math.max(Math.abs(x), floor || 0);
    };
    return { ld: v(tt.large_dec), d: v(tt.dec), i: v(tt.inc), li: v(tt.large_inc) };
}

function locationName(fips) {
    if (fips === "US") return "United States";
    return (typeof locationsData !== "undefined" && locationsData || []).find(l => l.fips === fips)?.name || fips;
}

// --- Dials -----------------------------------------------------------------

function initPanels() {
    createDial("#dial-activity", "activity");
    createDial("#dial-trend", "trend");
    createDial("#dial-onset", "probability", onsetRamp);
    createDial("#dial-peak", "probability", peakRamp);
}

// type: "activity" | "trend" (one segment per category) or "probability"
// (ten segments along a color ramp, needle at 0–100%).
function createDial(selector, type, ramp) {
    const svg = d3.select(selector)
        .attr("viewBox", `0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();

    const g = svg.append("g")
        .attr("class", "gauge-group")
        .attr("transform", `translate(${DIAL_WIDTH / 2}, ${DIAL_CENTER_Y})`);
    const arcGen = d3.arc().innerRadius(DIAL_INNER_RADIUS).outerRadius(DIAL_RADIUS);

    let segments;   // [{color}]
    let labels;     // [{angle, text}]
    if (type === "probability") {
        const n = 10;
        segments = d3.range(n).map(i => ({ color: ramp(i / (n - 1)) }));
        labels = [[-Math.PI / 2, "0%"], [0, "50%"], [Math.PI / 2, "100%"]]
            .map(([angle, text]) => ({ angle, text }));
    } else {
        const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
        const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
        const shortLabels = type === "trend"
            ? ["Lg↓", "Dec", "Stbl", "Inc", "Lg↑"]
            : ["Low", "Med", "High", "V.High"];
        const segAngle = Math.PI / categories.length;
        segments = categories.map(cat => ({ color: colors[cat], cat }));
        labels = categories.map((cat, i) => ({ angle: -Math.PI / 2 + (i + 0.5) * segAngle, text: shortLabels[i] }));
    }

    const segAngle = Math.PI / segments.length;
    segments.forEach((s, i) => {
        const startAngle = -Math.PI / 2 + i * segAngle;
        g.append("path")
            .attr("class", "gauge-segment" + (s.cat ? ` gauge-segment-${s.cat}` : ""))
            .attr("d", arcGen({ startAngle, endAngle: startAngle + segAngle }))
            .attr("fill", s.color)
            .attr("stroke", "#fff")
            .attr("stroke-width", type === "probability" ? 0.5 : 0.8);
    });

    // Labels sit just outside the arc; side labels are anchored away from it
    // so long ones ("V.High", "100%") never touch the gauge.
    labels.forEach(l => {
        const anchor = l.angle < -0.35 ? "end" : l.angle > 0.35 ? "start" : "middle";
        const r = anchor === "middle" ? DIAL_LABEL_R + 4 : DIAL_LABEL_R;
        g.append("text")
            .attr("x", Math.sin(l.angle) * r)
            .attr("y", -Math.cos(l.angle) * r)
            .attr("text-anchor", anchor)
            .attr("dominant-baseline", "middle")
            .attr("font-size", "17px")
            .attr("font-weight", "500")
            .attr("fill", "#777")
            .text(l.text);
    });

    g.append("line")
        .attr("class", "gauge-needle")
        .attr("x1", 0).attr("y1", 4)
        .attr("x2", 0).attr("y2", -(DIAL_RADIUS - 6))
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 2.5)
        .attr("stroke-linecap", "round");
    g.append("circle").attr("class", "gauge-hub").attr("cx", 0).attr("cy", 0).attr("r", 5).attr("fill", "#1a1a1a");

    // Big number for the probability dials (filled by setDialNeedle).
    if (type === "probability") {
        g.append("text")
            .attr("class", "dial-value")
            .attr("x", 0).attr("y", 9)
            .attr("text-anchor", "middle").attr("dominant-baseline", "hanging")
            .attr("font-size", "15px").attr("font-weight", "700").attr("fill", "#1a1a1a");
    }
}

// value: probability object (category dials) or a number 0–1 (probability dials).
function setDialNeedle(selector, type, value) {
    let angle;
    if (type === "probability") {
        const p = Math.max(0, Math.min(1, value == null ? 0 : value));
        angle = -Math.PI / 2 + p * Math.PI;
        d3.select(selector).select(".dial-value").text(value == null ? "" : `${Math.round(p * 100)}%`);
    } else {
        const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
        const segAngle = Math.PI / categories.length;
        let weighted = 0, total = 0;
        categories.forEach((cat, i) => {
            const w = (value && value[cat]) || 0;
            weighted += (-Math.PI / 2 + (i + 0.5) * segAngle) * w;
            total += w;
        });
        angle = total > 0 ? weighted / total : 0;
    }
    const len = DIAL_RADIUS - 6;
    d3.select(selector).selectAll(".gauge-needle, .gauge-hub").style("opacity", value == null ? 0 : null);
    d3.select(selector).select(".gauge-needle")
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr("x2", Math.sin(angle) * len).attr("y2", -Math.cos(angle) * len)
        .attr("x1", -Math.sin(angle) * 4).attr("y1", Math.cos(angle) * 4);
}

// --- Shared helpers --------------------------------------------------------

// The Sun–Sat week `h` weeks after the reference date.
function targetWeekRange(refDate, h) {
    const sat = new Date(refDate + "T00:00:00");
    sat.setDate(sat.getDate() + h * 7);
    const sun = new Date(sat);
    sun.setDate(sun.getDate() - 6);
    return { sun, sat, str: `${formatShortDate(sun)}–${formatShortDate(sat)}` };
}

function fmtOnsetWeek(dateStr) {
    const sat = new Date(dateStr + "T00:00:00");
    const sun = new Date(sat);
    sun.setDate(sun.getDate() - 6);
    return `${formatShortDate(sun)}–${formatShortDate(sat)}`;
}

const pctText = p => p < 0.01 ? (p > 0 ? "<1%" : "0%") : `${Math.round(p * 100)}%`;

function barsSvg(container, height) {
    return container.append("svg")
        .attr("viewBox", `0 0 320 ${height}`)
        .attr("preserveAspectRatio", "xMinYMin meet")
        .style("width", "100%").style("height", "auto").style("overflow", "visible");
}

// --- Distributions ---------------------------------------------------------

// Activity levels or trend categories: one bar per category.
function drawCategoryBars(container, view, entry) {
    container.selectAll("*").remove();
    if (!entry) return;
    const isTrend = view === "trend";
    const probs = isTrend ? entry.trend_probs : entry.activity_probs;
    if (!probs) {
        container.append("div").attr("class", "panel-note").text("Not available until last week's admissions are reported.");
        return;
    }
    const order = isTrend ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = isTrend ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = isTrend ? TREND_LABELS : ACTIVITY_LABELS;
    const selected = isTrend
        ? entry.trend_most_likely
        : (classifyActivity(entry.median_value, currentLoc()) || entry.activity_most_likely);

    const rowH = 18, labelW = isTrend ? 122 : 96, barMaxW = isTrend ? 150 : 170;
    const svg = barsSvg(container, order.length * rowH + 18);
    svg.append("text").attr("x", 0).attr("y", 10)
        .attr("font-size", "10px").attr("font-weight", "600").attr("letter-spacing", "0.5px").attr("fill", "#999")
        .text(isTrend ? "CHANCE OF EACH TREND" : "CHANCE OF EACH LEVEL");

    order.forEach((cat, i) => {
        const y = i * rowH + 18;
        const prob = probs[cat] || 0;
        const barW = Math.max(0, prob * barMaxW);
        const isSel = cat === selected;
        svg.append("text").attr("x", labelW - 6).attr("y", y + rowH / 2)
            .attr("text-anchor", "end").attr("dominant-baseline", "central")
            .attr("font-size", "11px").attr("fill", isSel ? "#1a1a1a" : "#666").attr("font-weight", isSel ? "700" : "400")
            .text(labels[cat]);
        if (barW > 0) {
            svg.append("rect").attr("x", labelW).attr("y", y + 2).attr("width", barW).attr("height", rowH - 4)
                .attr("fill", colors[cat]).attr("rx", 2)
                .attr("stroke", isSel ? "#1a1a1a" : ((cat === "low" || cat === "stable") ? "#ccc" : "none"))
                .attr("stroke-width", isSel ? 1.5 : 0.5);
        }
        svg.append("text").attr("x", labelW + barW + 6).attr("y", y + rowH / 2)
            .attr("dominant-baseline", "central").attr("font-size", "11px").attr("fill", "#333").attr("font-weight", "600")
            .text(pctText(prob));
    });
}

// Season start: chance the season has started by each forecast week, or a
// confirmation once reported admissions have crossed the threshold.
function drawOnsetBars(container, locData, refDate, horizon) {
    container.selectAll("*").remove();
    if (!locData) return;
    const first = locData["0"] || locData[Object.keys(locData)[0]];
    if (first && first.season_started_observed) {
        const note = container.append("div").attr("class", "panel-note");
        note.append("div").attr("class", "panel-note-title").style("color", SEASON_STARTED_COLOR).text("Season under way");
        note.append("div").text("Reported admissions have been at or above the epidemic threshold since then, so there is no start to forecast.");
        return;
    }
    const rows = [];
    for (let h = 0; h <= 3; h++) {
        const e = locData[String(h)];
        if (!e || e.onset_prob == null) continue;
        rows.push({ h, prob: e.onset_prob, week: weekRangeText(d3.timeFormat("%Y-%m-%d")(targetWeekRange(refDate, h).sat)) });
    }
    if (!rows.length) return;

    const rowH = 18, labelW = 96, barMaxW = 170;
    const svg = barsSvg(container, rows.length * rowH + 18);
    svg.append("text").attr("x", 0).attr("y", 10)
        .attr("font-size", "10px").attr("font-weight", "600").attr("letter-spacing", "0.5px").attr("fill", "#999")
        .text("STARTED BY WEEK");
    rows.forEach((r, i) => {
        const y = i * rowH + 18;
        const isSel = r.h === horizon;
        svg.append("text").attr("x", labelW - 6).attr("y", y + rowH / 2)
            .attr("text-anchor", "end").attr("dominant-baseline", "central")
            .attr("font-size", "11px").attr("fill", isSel ? "#1a1a1a" : "#666").attr("font-weight", isSel ? "700" : "400")
            .text(r.week);
        svg.append("rect").attr("x", labelW).attr("y", y + 2).attr("width", barMaxW).attr("height", rowH - 4).attr("rx", 3).attr("fill", "#eee");
        svg.append("rect").attr("x", labelW).attr("y", y + 2).attr("width", Math.max(0, barMaxW * r.prob)).attr("height", rowH - 4).attr("rx", 3)
            .attr("fill", seasonStartColor(r.prob)).attr("stroke", isSel ? "#1a1a1a" : "none").attr("stroke-width", 1.2);
        svg.append("text").attr("x", labelW + barMaxW + 6).attr("y", y + rowH / 2)
            .attr("dominant-baseline", "central").attr("font-size", "11px").attr("fill", "#333").attr("font-weight", "600")
            .text(pctText(r.prob));
    });
}

// Peak week: the most likely weeks (capped so the panel stays short) plus the
// observed peak once it has happened.
function drawPeakBars(container, pw, obsPeak) {
    container.selectAll("*").remove();
    if (!pw) return;
    // The highest reported week is only the season's peak once the forecast
    // says the peak has passed; earlier in the season it is just "so far".
    const actualWk = obsPeak && (pw.past_peak_share || 0) > 0.5 ? obsPeak.date : null;
    const all = pw.weeks.map((wk, i) => ({ wk, prob: pw.proportions[i] || 0 }));
    const top = all.filter(d => d.prob > 0).sort((a, b) => b.prob - a.prob).slice(0, 5).map(d => d.wk);
    const keep = new Set(top);
    if (actualWk && pw.weeks.includes(actualWk)) keep.add(actualWk);
    const rows = all.filter(d => keep.has(d.wk));
    if (!rows.length) return;

    const rowH = 18, labelW = 96, barMaxW = 170;
    const svg = barsSvg(container, rows.length * rowH + 18 + (actualWk ? 14 : 0));
    svg.append("text").attr("x", 0).attr("y", 10)
        .attr("font-size", "10px").attr("font-weight", "600").attr("letter-spacing", "0.5px").attr("fill", "#999")
        .text("MOST LIKELY PEAK WEEKS");
    rows.forEach((d, i) => {
        const y = i * rowH + 18;
        const barW = Math.max(0, d.prob * barMaxW);
        const isSel = d.wk === pw.most_likely.date;
        const isActual = d.wk === actualWk;
        svg.append("text").attr("x", labelW - 6).attr("y", y + rowH / 2)
            .attr("text-anchor", "end").attr("dominant-baseline", "central")
            .attr("font-size", "11px")
            .attr("fill", isActual ? PEAK_GOLD : (isSel ? "#1a1a1a" : "#666"))
            .attr("font-weight", (isActual || isSel) ? "700" : "400")
            .text(`${isActual ? "★ " : ""}${weekRangeText(d.wk)}`);
        if (barW > 0) {
            svg.append("rect").attr("x", labelW).attr("y", y + 2).attr("width", barW).attr("height", rowH - 4).attr("rx", 2)
                .attr("fill", weekColor(currentLoc(), d.wk))
                .attr("stroke", isActual ? PEAK_GOLD : (isSel ? "#1a1a1a" : "none"))
                .attr("stroke-width", (isActual || isSel) ? 1.5 : 0);
        }
        svg.append("text").attr("x", labelW + barW + 6).attr("y", y + rowH / 2)
            .attr("dominant-baseline", "central").attr("font-size", "11px").attr("fill", "#333").attr("font-weight", "600")
            .text(pctText(d.prob));
    });
    if (actualWk) {
        svg.append("text").attr("x", 0).attr("y", rows.length * rowH + 28)
            .attr("font-size", "10px").attr("fill", PEAK_GOLD).attr("font-weight", "600")
            .text("★ Actual season peak");
    }
}

// --- Sentences (HTML) --------------------------------------------------------
// A few words each. Dates and visit counts are in the headline and the week
// buttons, so they are not repeated here.

function sentenceActivity(entry) {
    if (!entry) return "No forecast for this week.";
    const cat = classifyActivity(entry.median_value, currentLoc()) || entry.activity_most_likely;
    const color = ACTIVITY_TEXT_COLORS[cat] || ACTIVITY_COLORS[cat];
    return `Most likely <strong style="color:${color}">${ACTIVITY_LABELS[cat]}</strong>.`;
}

function sentenceTrend(entry) {
    if (!entry) return "No forecast for this week.";
    const t = trendSummary(entry);
    if (!t) return `<span class="panel-empty-line">Appears once last week's admissions are reported.</span>`;
    return `Most likely <strong style="color:${t.color}">${t.label}</strong> compared with last week.`;
}

function sentenceOnset(entry) {
    if (!entry || entry.onset_prob == null) return "No season-start forecast for this week.";
    if (entry.season_started_observed) {
        return `<strong style="color:${SEASON_STARTED_COLOR}">Started</strong>.`;
    }
    return `<strong style="color:${seasonStartColor(Math.max(entry.onset_prob, 0.45))}">${pctText(entry.onset_prob)}</strong> chance it has started.`;
}

function sentencePeak(pw) {
    if (!pw) return "No peak-week forecast for this submission.";
    if ((pw.past_peak_share || 0) > 0.5) return `Most likely <strong>already peaked</strong>.`;
    const modalIdx = pw.weeks.indexOf(pw.most_likely.date);
    if (modalIdx === pw.weeks.length - 1 && (pw.peak_at_last_share || 0) >= 0.25) {
        return `Peak <strong>still ahead</strong>, possibly beyond the forecast window.`;
    }
    return `Peak most likely <strong>still ahead</strong>.`;
}

// --- Confidence -------------------------------------------------------------
// One plain-language measure of how sure the model is. For the category
// gauges it is the share of the 1,000 runs that agree with the most likely
// answer; for Season Start it is the share agreeing on started / not started;
// for Peak Week it is how many weeks it takes to cover 80% of the runs' peaks.

const CONFIDENCE_LEVELS = [
    { min: 0.75, key: "high", label: "High confidence" },
    { min: 0.50, key: "moderate", label: "Moderate confidence" },
    { min: 0, key: "low", label: "Low confidence" },
];

function confidenceFromShare(p) {
    return CONFIDENCE_LEVELS.find(l => p >= l.min) || CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];
}

// "Chance: Low 75%, Medium 25%": the two most likely answers.
function topTwoText(items) {
    const [a, b] = [...items].sort((x, y) => y.p - x.p);
    let t = `Chance: ${a.label} ${pctText(a.p)}`;
    if (b && b.p >= 0.01) t += `, ${b.label} ${pctText(b.p)}`;
    return t;
}

// Share of runs behind the most likely category, with the runner-up.
function confidenceCategory(probs, order, labels, selected) {
    if (!probs) return null;
    const p = probs[selected] || 0;
    const text = topTwoText(order.map(c => ({ label: labels[c], p: probs[c] || 0 })));
    return { ...confidenceFromShare(p), text };
}

function confidenceActivity(entry) {
    if (!entry) return null;
    const cat = classifyActivity(entry.median_value, currentLoc()) || entry.activity_most_likely;
    return confidenceCategory(entry.activity_probs, ACTIVITY_ORDER, ACTIVITY_LABELS, cat);
}

// Trend confidence is about direction. Runs split between Increasing and
// Sharply Increasing agree that visits go up and differ only on how much, so
// they count together. Returns the label to show (the gauge's own category
// names), the confidence level and a short explanation.
const TREND_DIRECTIONS = {
    down: ["large_decrease", "decrease"],
    stable: ["stable"],
    up: ["increase", "large_increase"],
};

function trendSummary(entry) {
    if (!entry?.trend_probs) return null;
    const probs = entry.trend_probs;
    const share = cats => cats.reduce((t, c) => t + (probs[c] || 0), 0);
    const dirs = Object.entries(TREND_DIRECTIONS).map(([k, cats]) => ({ k, cats, p: share(cats) }))
        .sort((x, y) => y.p - x.p);
    const top = dirs[0];
    const level = confidenceFromShare(top.p);

    let label, split = false;
    if (top.k === "stable") {
        label = TREND_LABELS.stable;
    } else {
        // Within the direction: one category if it holds 3/4 of that direction's runs.
        const [c1, c2] = [...top.cats].sort((x, y) => (probs[y] || 0) - (probs[x] || 0));
        if ((probs[c1] || 0) >= 0.75 * top.p) {
            label = TREND_LABELS[c1];
        } else {
            split = true;
            label = top.k === "up" ? "Increasing" : "Decreasing";
        }
    }
    const DIR_LABEL = { down: "Decreasing", stable: "Stable", up: "Increasing" };
    const text = topTwoText(dirs.map(d => ({ label: DIR_LABEL[d.k], p: d.p })));
    return { label, dir: top.k, share: top.p, level, text, color: TREND_TEXT_COLORS[entry.trend_most_likely] || "#555" };
}

function confidenceTrend(entry) {
    const t = trendSummary(entry);
    return t ? { ...t.level, text: t.text } : null;
}

function confidenceOnset(entry) {
    if (!entry || entry.onset_prob == null) return null;
    if (entry.season_started_observed) {
        return { key: "high", label: "Confirmed", text: "Seen in reported admissions" };
    }
    const p = entry.onset_prob;
    const agree = Math.max(p, 1 - p);
    return { ...confidenceFromShare(agree), text: topTwoText([{ label: "Started", p: Math.round(p * 100) / 100 }, { label: "Not yet", p: 1 - Math.round(p * 100) / 100 }]) };
}

// Central 80% window of the runs' peak weeks (weeks are in date order).
function peakWindow(pw) {
    if (!pw || !pw.weeks?.length) return null;
    let cum = 0, lo = null, hi = null;
    pw.weeks.forEach((wk, i) => {
        const before = cum;
        cum += pw.proportions[i] || 0;
        if (lo == null && cum >= 0.10) lo = i;
        if (hi == null && before < 0.90 && cum >= 0.90) hi = i;
    });
    if (lo == null) return null;
    if (hi == null) hi = pw.weeks.length - 1;
    const start = new Date(pw.weeks[lo] + "T00:00:00"); start.setDate(start.getDate() - 6);
    const end = new Date(pw.weeks[hi] + "T00:00:00");
    return { n: hi - lo + 1, start, end, span: `${formatShortDate(start)}–${formatShortDate(end)}` };
}

function confidencePeak(pw) {
    const w = peakWindow(pw);
    if (!w) return null;
    const level = w.n <= 2 ? CONFIDENCE_LEVELS[0] : w.n <= 4 ? CONFIDENCE_LEVELS[1] : CONFIDENCE_LEVELS[2];
    return { ...level, text: topTwoText(pw.weeks.map((wk, i) => ({ label: weekStartShort(wk), p: pw.proportions[i] || 0 }))) };
}

function renderConfidence(selector, c) {
    const el = d3.select(selector);
    el.selectAll("*").remove();
    if (!c) return;
    el.append("span").attr("class", `conf-pill conf-${c.key}`).text(c.label);
    el.append("span").attr("class", "conf-text").text(c.text);
}

// --- Headline ----------------------------------------------------------------
// A few words for the open tab, in larger text at the top of the card.

// Round a visit count for a plain-language range ("between 90 and 260").
const roundVisits = v => v >= 100 ? Math.round(v / 10) * 10 : Math.round(v / 5) * 5;

function headlineNow(entry) {
    if (!entry) return { main: "No forecast for this week", sub: "" };
    const cat = classifyActivity(entry.median_value, currentLoc()) || entry.activity_most_likely;
    const aColor = ACTIVITY_TEXT_COLORS[cat] || ACTIVITY_COLORS[cat];
    const aConf = confidenceActivity(entry);
    const t = trendSummary(entry);

    // Activity: "Low", "Likely Low", or "Low to Medium" when the runs split.
    let level = ACTIVITY_LABELS[cat];
    if (aConf.key === "moderate") level = `Likely ${level}`;
    if (aConf.key === "low") {
        const probs = entry.activity_probs;
        const runner = ACTIVITY_ORDER.filter(c => c !== cat).sort((a, b) => (probs[b] || 0) - (probs[a] || 0))[0];
        const pair = [cat, runner].sort((a, b) => ACTIVITY_ORDER.indexOf(a) - ACTIVITY_ORDER.indexOf(b));
        level = `${ACTIVITY_LABELS[pair[0]]} to ${ACTIVITY_LABELS[pair[1]]}`;
    }
    // Trend: the gauge's category names; "Likely ..." or "Trend unclear".
    // Left out when last week's report is missing (no trend to compare).
    let trendHtml = "";
    if (t) {
        let trend = t.label;
        if (t.level.key === "moderate") trend = `Likely ${trend}`;
        trendHtml = t.level.key === "low" ? `Trend unclear` : `<span style="color:${t.color}">${trend}</span>`;
    }

    const n = d3.format(",")(Math.round(entry.median_value));
    let sub = `About ${n} hospital admissions`;
    if (entry.p10_value != null && entry.p90_value != null) {
        sub += `, likely between ${d3.format(",")(roundVisits(entry.p10_value))} and ${d3.format(",")(roundVisits(entry.p90_value))}`;
    }
    sub += ". ";
    const sure = { high: 2, moderate: 1, low: 0 };
    const a = sure[aConf.key], b = t ? sure[t.level.key] : null;
    if (b == null) sub += a === 2 ? "Confident in the activity level." : "Less certain about the activity level.";
    else if (a === 2 && b === 2) sub += "Confident in both activity and trend.";
    else if (a < b) sub += "Less certain about the activity level.";
    else if (b < a) sub += "Less certain about the trend.";
    else sub += "Uncertain about both activity and trend.";

    return {
        main: `<span style="color:${aColor}">${level}</span> activity` + (currentLoc() === "US" ? " nationally" : "") +
            (trendHtml ? ` · ${trendHtml}` : ""),
        sub,
    };
}

// Sunday that starts the Sun–Sat week ending on `dateStr`.
function weekStartShort(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 6);
    return formatShortDate(d);
}

// --- Overall summary (top of the card, same on both tabs) ---------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 8–14" or "Oct 26–Nov 1" for the Sun–Sat week ending on `dateStr`.
function weekRangeText(dateStr) {
    const sat = new Date(dateStr + "T00:00:00");
    const sun = new Date(sat); sun.setDate(sun.getDate() - 6);
    return sun.getMonth() === sat.getMonth()
        ? `${MONTHS_SHORT[sun.getMonth()]} ${sun.getDate()}–${sat.getDate()}`
        : `${formatShortDate(sun)}–${formatShortDate(sat)}`;
}

// Sunday of the week ending on `dateStr`, as "Oct 18".
const weekStartText = dateStr => weekStartShort(dateStr);
// Saturday `dateStr` itself, as "Dec 26".
const weekEndText = dateStr => formatShortDate(new Date(dateStr + "T00:00:00"));

function summaryVisits(entry) {
    if (!entry) return "";
    if (entry.p10_value == null || entry.p90_value == null) {
        return `About <strong>${d3.format(",")(Math.round(entry.median_value))}</strong> flu hospital admissions.`;
    }
    return `Likely <strong class="nowrap">${d3.format(",")(roundVisits(entry.p10_value))} to ${d3.format(",")(roundVisits(entry.p90_value))}</strong> flu hospital admissions.`;
}

// Tiles show the likely range only. Things that already happened show the week.
function summaryOnsetRow(entry, onset) {
    if (entry?.season_started_observed && entry.observed_onset_date) {
        return { label: "Season started", info: "season_start_def", value: `<strong>${weekRangeText(entry.observed_onset_date)}</strong>` };
    }
    if (onset?.lower && onset?.upper) {
        const value = onset.lower === onset.upper
            ? `<strong>${weekRangeText(onset.lower)}</strong>`
            : `<strong>${weekStartText(onset.lower)} to ${weekEndText(onset.upper)}</strong>`;
        return { label: "Projected season start", info: "season_start_def", value };
    }
    if (entry?.onset_prob != null) {
        return { label: "Projected season start", info: "season_start_def", value: `${pctText(entry.onset_prob)} chance it has started` };
    }
    return null;
}

function summaryPeakRow(pw) {
    if (!pw) return null;
    const passed = (pw.past_peak_share || 0) > 0.5;
    const w = peakWindow(pw);
    const value = w && w.n > 1
        ? `<strong>${formatShortDate(w.start)} to ${formatShortDate(w.end)}</strong>`
        : `<strong>${weekRangeText(pw.most_likely.date)}</strong>`;
    return { label: passed ? "Peaked" : "Projected peak", info: "peak_def", value };
}

function updateHeadline(entry, pw, week, onset) {
    const loc = currentLoc();
    d3.select("#headline-location").text(loc === "US" ? "United States (national)" : locationName(loc));
    d3.select("#headline-date").text(`Week of ${weekRangeText(d3.timeFormat("%Y-%m-%d")(week.sat))}`);
    d3.select("#headline-main").html(headlineNow(entry).main);
    d3.select("#headline-visits").html(summaryVisits(entry));
    const ul = d3.select("#headline-rows");
    ul.selectAll("*").remove();
    [summaryOnsetRow(entry, onset), summaryPeakRow(pw)].filter(Boolean).forEach(r => {
        const li = ul.append("li");
        const head = li.append("span").attr("class", "headline-label");
        head.append("span").text(r.label);
        if (r.info) {
            head.append("button").attr("class", "help-btn tile-help").attr("type", "button")
                .attr("data-info", r.info).attr("aria-label", `What ${r.label.toLowerCase()} means`).text("?");
        }
        li.append("span").attr("class", "headline-value").html(r.value);
        if (r.note) li.append("span").attr("class", "headline-note").text(r.note);
    });
}

// --- "?" help: what the categories mean for the selected week -------------------

const fmtInt = d3.format(",");

function selectedEntry() {
    const r = AppState.currentRefDate, h = AppState.currentHorizon;
    return r ? dashboardData?.data?.[r]?.[currentLoc()]?.[String(h)] || null : null;
}

function infoDetailHtml(kind) {
    const th = activityThresholds?.[currentLoc()];
    if (kind === "epidemic") return th ? fmtInt(Math.round(th.epidemic)) : "the epidemic threshold";
    if (!th) return "";
    const entry = selectedEntry();
    const refDate = AppState.currentRefDate;
    const h = AppState.currentHorizon;
    const weekText = refDate ? weekRangeText(d3.timeFormat("%Y-%m-%d")(targetWeekRange(refDate, h).sat)) : "";

    if (kind === "activity_table") {
        const cuts = [th.moderate, th.high, th.very_high].map(v => Math.ceil(v));
        const ranges = {
            low: `under ${fmtInt(cuts[0])}`,
            moderate: `${fmtInt(cuts[0])} to ${fmtInt(cuts[1] - 1)}`,
            high: `${fmtInt(cuts[1])} to ${fmtInt(cuts[2] - 1)}`,
            very_high: `${fmtInt(cuts[2])} or more`,
        };
        const cat = entry ? (classifyActivity(entry.median_value, currentLoc()) || entry.activity_most_likely) : null;
        let html = `<table class="info-table"><thead><tr><th>Level</th><th>Flu hospital admissions in a week</th></tr></thead><tbody>` +
            ACTIVITY_ORDER.map(c => `<tr${c === cat ? ' class="is-example"' : ""}><td>${ACTIVITY_LABELS[c]}</td><td>${ranges[c]}</td></tr>`).join("") +
            `</tbody></table>`;
        if (entry) {
            html += `<p class="info-example"><strong>Example (highlighted):</strong> for ${weekText}, the middle forecast is ${fmtInt(Math.round(entry.median_value))} admissions, which is ${ACTIVITY_LABELS[cat]}. ` +
                `Of the 1,000 forecasts: ${ACTIVITY_ORDER.filter(c => (entry.activity_probs[c] || 0) >= 0.005).map(c => `${ACTIVITY_LABELS[c]} ${pctText(entry.activity_probs[c])}`).join(", ")}.</p>`;
        }
        return html;
    }

    const tt = dashboardData?.trend_thresholds;
    if (kind === "trend_table" && tt && th.population) {
        const floor = dashboardData?.count_stable_threshold || 0;
        const sign = v => (v > 0 ? "+" : v < 0 ? "\u2212" : "") + fmtInt(Math.abs(v));
        const weeks = ["0", "1", "2", "3"].filter(k => tt[k]);
        const limits = k => {
            const L = trendLimits(tt[k], th.population, floor);
            const [ld, d, i, li] = [L.ld, L.d, L.i, L.li].map(Math.round);
            return {
                large_decrease: `${sign(ld)} or less`, decrease: `${sign(ld)} to ${sign(d)}`,
                stable: `${sign(d)} to ${sign(i)}`, increase: `${sign(i)} to ${sign(li)}`,
                large_increase: `${sign(li)} or more`,
            };
        };
        // Example: the middle forecast's change for the selected week.
        let exCat = null, exHtml = "";
        if (entry && refDate && targetDataAll?.[currentLoc()] && tt[String(h)]) {
            const last = new Date(refDate + "T00:00:00"); last.setDate(last.getDate() - 7);
            const lastKey = d3.timeFormat("%Y-%m-%d")(last);
            const row = targetDataAll[currentLoc()].find(d => d.date === lastKey);
            if (row) {
                const change = Math.round(entry.median_value - row.value);
                const L = trendLimits(tt[String(h)], th.population, floor);
                exCat = change <= L.ld ? "large_decrease" : change <= L.d ? "decrease"
                      : change < L.i ? "stable" : change < L.li ? "increase" : "large_increase";
                exHtml = `<p class="info-example"><strong>Example (highlighted):</strong> the last reported week, ${weekRangeText(lastKey)}, had ${fmtInt(Math.round(row.value))} admissions. ` +
                    `For ${weekText} the middle forecast is ${fmtInt(Math.round(entry.median_value))}, a change of ${sign(change)}, which is ${TREND_LABELS[exCat]} for ${+h + 1} week${h ? "s" : ""} ahead.` +
                    (entry.trend_probs ? ` Of the 1,000 forecasts: ${TREND_ORDER.filter(c => (entry.trend_probs[c] || 0) >= 0.005).map(c => `${TREND_LABELS[c]} ${pctText(entry.trend_probs[c])}`).join(", ")}.` : "") +
                    `</p>`;
            }
        }
        const head = weeks.map(k => `<th${k === String(h) ? ' class="is-example-col"' : ""}>${+k + 1} wk ahead</th>`).join("");
        const lim = Object.fromEntries(weeks.map(k => [k, limits(k)]));
        const body = TREND_ORDER.map(c => `<tr><td>${TREND_LABELS[c]}</td>` +
            weeks.map(k => `<td${k === String(h) && c === exCat ? ' class="is-example"' : ""}>${lim[k][c]}</td>`).join("") + `</tr>`).join("");
        return `<p class="info-table-caption">Change in weekly flu hospital admissions compared with the last reported week</p>` +
            `<table class="info-table"><thead><tr><th>Trend</th>${head}</tr></thead><tbody>${body}</tbody></table>` + exHtml;
    }
    return "";
}

// --- Render all four gauges --------------------------------------------------

function updatePanels() {
    if (!dashboardData || !AppState.currentRefDate) return;
    const refDate = AppState.currentRefDate;
    const h = AppState.currentHorizon;
    const locData = dashboardData.data[refDate]?.[currentLoc()] || null;
    const entry = locData ? locData[String(h)] : null;
    const pw = peakWeekData?.[currentLoc()]?.[refDate] || null;
    const obsPeak = peakWeekData?._observed_peak?.[currentLoc()] || null;
    const week = targetWeekRange(refDate, h);

    // Activity
    setDialNeedle("#dial-activity", "activity", entry ? entry.activity_probs : null);
    d3.select("#sentence-activity").html(sentenceActivity(entry));
    renderConfidence("#confidence-activity", confidenceActivity(entry));
    drawCategoryBars(d3.select("#bars-activity"), "activity", entry);

    // Trend
    setDialNeedle("#dial-trend", "trend", entry?.trend_probs || null);
    d3.select("#sentence-trend").html(sentenceTrend(entry));
    renderConfidence("#confidence-trend", confidenceTrend(entry));
    drawCategoryBars(d3.select("#bars-trend"), "trend", entry);

    // Season start: chance started by the selected week (1 once it has).
    const onsetP = entry ? (entry.season_started_observed ? 1 : entry.onset_prob) : null;
    setDialNeedle("#dial-onset", "probability", onsetP);
    d3.select("#sentence-onset").html(sentenceOnset(entry));
    renderConfidence("#confidence-onset", confidenceOnset(entry));
    drawOnsetBars(d3.select("#bars-onset"), locData, refDate, h);

    // Peak: chance the peak has happened by the selected week (cumulative).
    const peakP = peakChanceBy(pw, d3.timeFormat("%Y-%m-%d")(week.sat));
    setDialNeedle("#dial-peak", "probability", peakP);
    d3.select("#sentence-peak").html(sentencePeak(pw));
    renderConfidence("#confidence-peak", confidencePeak(pw));
    drawPeakBars(d3.select("#bars-peak"), pw, obsPeak);

    updateHeadline(entry, pw, week, dashboardData.onset?.[refDate]?.[currentLoc()] || null);
    markMappedGauge();
}

// Chance the peak has happened by the week ending `through` (YYYY-MM-DD).
function peakChanceBy(pw, through) {
    if (!pw) return null;
    let p = 0;
    pw.weeks.forEach((wk, i) => { if (wk <= through) p += pw.proportions[i] || 0; });
    return Math.min(1, p);
}

// Outline the gauge the map is colored by.
function markMappedGauge() {
    d3.selectAll(".gauge-row").classed("is-mapped", function () { return this.dataset.view === AppState.mapView; });
}
