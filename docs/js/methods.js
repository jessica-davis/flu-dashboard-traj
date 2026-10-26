// Methods page: tabs and the figures. Figures use real national data where
// possible and stand-in trajectories; every rule that turns trajectories
// into levels, trends, chances and confidence is the dashboard's own
// (gauges.js and colors.js).

const DEFAULT_LOCATION = "US";
let activityThresholds = null;          // read by classifyActivity() in colors.js
// Stand-in examples were drawn for a location whose epidemic threshold is 146
// a week; SCALE resizes them to the location shown here.
let SCALE = 1;

const fmt = d3.format(",");
// Axis labels: "40k" from 10,000 up so national counts fit the margin.
const fmtAxis = v => (Math.abs(v) >= 10000 ? `${d3.format(",")(v / 1000)}k` : fmt(v));
const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));
const fmtDay = d3.timeFormat("%b %-d");
const INK = "#1d2733", MUTED = "#4a5866", NAVY = "#24405f", TRAJ = "#3A7BA0", TEAL = "#2f8f86";
const FS = 13;   // chart text size

// --- Tabs ---------------------------------------------------------------------------
function showPane(name) {
    document.querySelectorAll(".art-tab").forEach(t => t.classList.toggle("active", t.dataset.pane === name));
    document.querySelectorAll(".art-pane").forEach(p => p.classList.toggle("active", p.id === "pane-" + name));
}
document.querySelectorAll(".art-tab").forEach(t => t.addEventListener("click", () => {
    showPane(t.dataset.pane);
    history.replaceState(null, "", t.dataset.pane === "definitions" ? "#definitions" : location.pathname + location.search);
}));
if (location.hash === "#definitions") showPane("definitions");

// --- Helpers ------------------------------------------------------------------------------
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function normals(n, seed) {
    const r = mulberry32(seed), out = [];
    while (out.length < n) {
        const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u));
        out.push(m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v));
    }
    return out.slice(0, n);
}
const N = 1000;
const Z1 = normals(N, 11), Z2 = [1, 2, 3, 4].map(k => normals(N, 100 + k));
const quant = (arr, q) => d3.quantile([...arr].sort((a, b) => a - b), q);
const addWeeks = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + 7 * k); return x; };
const pick = sel => document.querySelector(sel);

function segButtons(sel, onPick) {
    const btns = document.querySelectorAll(`${sel} button`);
    btns.forEach(b => b.addEventListener("click", () => { btns.forEach(x => x.classList.toggle("active", x === b)); onPick(b); }));
}
function chartFrame(sel, w, h, m = { top: 16, right: 16, bottom: 30, left: 50 }) {
    const svg = d3.select(sel).html("").append("svg").attr("viewBox", `0 0 ${w} ${h}`)
        .style("width", "100%").style("height", "auto").style("display", "block");
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
    return { svg, g, iw: w - m.left - m.right, ih: h - m.top - m.bottom };
}
function axes(g, x, y, iw, ih, xTicks, xFormat, yTicks = 5) {
    g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(xTicks).tickFormat(xFormat).tickSizeOuter(0));
    g.append("g").call(d3.axisLeft(y).ticks(yTicks).tickFormat(fmtAxis).tickSize(-iw).tickSizeOuter(0))
        .call(a => a.selectAll(".tick line").attr("stroke", "#e6ebf0"))
        .call(a => a.select(".domain").remove());
    g.selectAll(".tick text").attr("font-size", FS - 0.5).attr("fill", MUTED);
    g.selectAll(".domain").attr("stroke", "#9aa6b2");
}
const text = (g, x, y, s, o = {}) => g.append("text").attr("x", x).attr("y", y)
    .attr("font-size", o.size || FS).attr("font-weight", o.weight || 600).attr("fill", o.fill || INK)
    .attr("text-anchor", o.anchor || "start").attr("dy", o.dy || null)
    .attr("stroke", "#fff").attr("stroke-width", 4).attr("paint-order", "stroke").text(s);
const dotsOf = (g, rows, x, y, r = 3.6) =>
    g.selectAll(null).data(rows).join("circle").attr("cx", d => x(d.date)).attr("cy", d => y(d.value)).attr("r", r).attr("fill", INK);
const lineOf = (g, rows, x, y) => g.append("path").datum(rows).attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)))
    .attr("fill", "none").attr("stroke", INK).attr("stroke-width", 2.2);

// An animation that steps through frames on its own. Pausing it (or clicking
// the chart) lets the reader pick a frame themselves.
function stepper(btnSel, nFrames, ms, draw) {
    const btn = pick(btnSel);
    let i = 0, playing = true;
    const setBtn = () => { btn.textContent = playing ? "Pause" : "Play"; };
    setInterval(() => { if (playing) { i = (i + 1) % nFrames; draw(i); } }, ms);
    btn.addEventListener("click", () => { playing = !playing; setBtn(); });
    draw(i);
    return {
        set(k) { playing = false; setBtn(); i = k; draw(i); },
        redraw() { draw(i); },
    };
}
function barsHtml(order, labels, colors, probs) {
    const top = order.reduce((a, c) => (probs[c] > probs[a] ? c : a), order[0]);
    return order.map(c => `<div class="bar${c === top ? " is-top" : ""}"><span>${labels[c]}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${(probs[c] * 100).toFixed(1)}%;background:${colors[c]}"></span></span>` +
        `<span>${pctText(probs[c])}</span></div>`).join("");
}
const confHtml = c => `<span class="conf-pill conf-${c.key}">${c.label}</span><span>${c.text}</span>`;

// --- Page ----------------------------------------------------------------------------------
async function initMethods() {
    await bootSeasonHeader();
    const [th, dd, hist] = await Promise.all([
        d3.json(dataUrl("data/activity_thresholds.json")),
        d3.json(seasonDataPath(seasonMeta.name, "dashboard_data.json")).catch(() => null),
        d3.json(dataUrl("data/historical_seasons.json")).catch(() => null),
    ]);
    activityThresholds = th;
    const T = th[DEFAULT_LOCATION];
    SCALE = T.epidemic / 146;
    FC_OBS = exampleWeeks([6, 9, 14, 19, 27, 36, 50, 66, 88, 115].map(v => Math.round(v * SCALE)), "2026-10-10");
    // Trend limits: rate change per 100k (FluSight trend categories), as admissions.
    const rates = dd?.trend_thresholds || {
        "0": { large_dec: -1.7, dec: -0.3, inc: 0.3, large_inc: 1.7 },
        "1": { large_dec: -3.0, dec: -0.5, inc: 0.5, large_inc: 3.0 },
        "2": { large_dec: -4.0, dec: -0.7, inc: 0.7, large_inc: 4.0 },
        "3": { large_dec: -5.0, dec: -1.0, inc: 1.0, large_inc: 5.0 },
    };
    const limits = h => trendLimits(rates[h], T.population, dd?.count_stable_threshold ?? 10);
    const trendOf = (change, h) => {
        const L = limits(h);
        return change <= L.ld ? "large_decrease" : change <= L.d ? "decrease" : change < L.i ? "stable" : change < L.li ? "increase" : "large_increase";
    };
    document.querySelectorAll(".js-epi").forEach(el => el.textContent = fmt(Math.round(T.epidemic)));

    const seasons = hist?.[DEFAULT_LOCATION] || {};
    const s2526 = (seasons["2025-26"] || []).filter(d => d.value != null).map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value }));

    dataFigure(seasons);
    quantileFigure();
    forecastFigure();
    weeklyFigure(T, s2526, limits, trendOf);
    startFigure(s2526, T.epidemic);
    peakFigure();
    tryFigure(T, limits);
}

// The data --------------------------------------------------------------------------------
function dataFigure(seasons) {
    const names = Object.keys(seasons).sort();
    if (!names.length) return;
    const current = seasonMeta.name in seasons ? seasonMeta.name : names[names.length - 1];
    const palette = ["#9CD8D3", "#4B9AC1", "#E7CA7D", "#9CD3B4", "#E8A56D", "#4D6891"];
    const color = n => n === current ? INK : palette[names.indexOf(n) % palette.length];
    const shown = new Set(names);
    const start = new Date(seasonMeta.start + "T00:00:00");
    const legend = d3.select("#data-legend").selectAll("button").data([...names].reverse()).join("button")
        .attr("class", "legend-item")
        .html(n => `<span class="ln" style="border-color:${color(n)}"></span>${n}${n === current ? " (this season)" : ""}`)
        .on("click", (e, n) => { shown.has(n) ? shown.delete(n) : shown.add(n); draw(); });

    function draw() {
        legend.classed("off", n => !shown.has(n));
        const { g, iw, ih } = chartFrame("#data-chart", 760, 290);
        const vis = names.filter(n => shown.has(n));
        const maxV = d3.max(vis.flatMap(n => seasons[n].map(d => d.value))) || 10;
        const x = d3.scaleLinear().domain([0, 52]).range([0, iw]);
        const y = d3.scaleLinear().domain([0, maxV * 1.05]).nice().range([ih, 0]);
        axes(g, x, y, iw, ih, 8, w => fmtDay(addWeeks(start, w)));
        const line = d3.line().x(d => x(d.week)).y(d => y(d.value)).defined(d => d.value != null);
        vis.filter(n => n !== current).concat(vis.includes(current) ? [current] : []).forEach(n =>
            g.append("path").datum(seasons[n]).attr("d", line).attr("fill", "none").attr("stroke", color(n)).attr("stroke-width", n === current ? 3 : 2.4));
        const focus = g.append("g").style("display", "none");
        focus.append("circle").attr("r", 4.5).attr("fill", "#fff").attr("stroke-width", 2.4);
        const tip = focus.append("text").attr("font-size", FS).attr("font-weight", 600).attr("stroke", "#fff").attr("stroke-width", 5).attr("paint-order", "stroke");
        g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
            .on("mousemove", e => {
                const [mx, my] = d3.pointer(e);
                let best = null;
                vis.forEach(n => seasons[n].forEach(d => {
                    const dist = Math.hypot(x(d.week) - mx, y(d.value) - my);
                    if (!best || dist < best.dist) best = { n, d, dist };
                }));
                if (!best) return;
                const px = x(best.d.week), py = y(best.d.value), right = px > iw * 0.6;
                focus.style("display", null);
                focus.select("circle").attr("cx", px).attr("cy", py).attr("stroke", color(best.n));
                tip.attr("x", px + (right ? -10 : 10)).attr("y", py - 10).attr("text-anchor", right ? "end" : "start")
                    .text(`${best.n}, week ending ${fmtDay(new Date(best.d.date + "T00:00:00"))}: ${fmt(Math.round(best.d.value))}`);
            })
            .on("mouseleave", () => focus.style("display", "none"));
    }
    draw();
}

// Stand-in trajectories for weeks 1..n after the last reported week.
function trajectories(last, growth, sg, se, n = 4) {
    return d3.range(N).map(i => {
        let lv = Math.log(Math.max(last, 1));
        const g = Math.log(growth) + sg * Z1[i];
        return d3.range(n).map(k => (lv += g + se * Z2[k % 4][i], Math.exp(lv)));
    });
}
function exampleWeeks(values, endDate) {
    const end = new Date(endDate + "T00:00:00");
    return values.map((v, i) => ({ date: addWeeks(end, i - values.length + 1), value: v }));
}
let FC_OBS = null;   // set in initMethods once SCALE is known

// Quantiles: one week's 1,000 trajectory values with the percentiles marked ---------------------
function quantileFigure() {
    const last = FC_OBS[FC_OBS.length - 1];
    const vals = trajectories(last.value, 1.3, 0.10, 0.10).map(t => t[3]);
    const { g, iw, ih } = chartFrame("#q-chart", 560, 230, { top: 34, right: 18, bottom: 34, left: 18 });
    const x = d3.scaleLinear().domain([0, quant(vals, 0.995)]).nice().range([0, iw]);
    const bins = d3.bin().domain(x.domain()).thresholds(40)(vals);
    const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length)]).range([ih, 0]);
    const Q = p => quant(vals, p);
    // Interval bands behind the histogram
    g.append("rect").attr("x", x(Q(0.05))).attr("width", x(Q(0.95)) - x(Q(0.05))).attr("y", 0).attr("height", ih).attr("fill", "#7D8798").attr("fill-opacity", 0.22);
    g.append("rect").attr("x", x(Q(0.25))).attr("width", x(Q(0.75)) - x(Q(0.25))).attr("y", 0).attr("height", ih).attr("fill", "#3E4757").attr("fill-opacity", 0.22);
    g.selectAll(null).data(bins).join("rect").attr("x", b => x(b.x0) + 0.5).attr("width", b => Math.max(0, x(b.x1) - x(b.x0) - 1))
        .attr("y", b => y(b.length)).attr("height", b => ih - y(b.length)).attr("fill", TRAJ).attr("fill-opacity", 0.85);
    g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickFormat(fmt).tickSizeOuter(0))
        .call(a => a.selectAll("text").attr("font-size", FS - 0.5).attr("fill", MUTED)).call(a => a.select(".domain").attr("stroke", "#9aa6b2"));
    text(g, iw / 2, ih + 30, "Weekly flu hospital admissions, four weeks ahead (1,000 trajectories)", { anchor: "middle", size: FS - 1, weight: 500, fill: MUTED });
    [[0.05, "5th"], [0.25, "25th"], [0.5, "Median"], [0.75, "75th"], [0.95, "95th"]].forEach(([p, lab]) => {
        g.append("line").attr("x1", x(Q(p))).attr("x2", x(Q(p))).attr("y1", -4).attr("y2", ih).attr("stroke", INK).attr("stroke-width", p === 0.5 ? 2 : 1.2).attr("stroke-dasharray", p === 0.5 ? null : "3,3");
        text(g, x(Q(p)), -10, lab, { anchor: "middle", size: FS - 1, weight: p === 0.5 ? 700 : 600 });
    });
    text(g, (x(Q(0.25)) + x(Q(0.75))) / 2, ih - 8, "50% interval", { anchor: "middle", size: FS - 1, weight: 700 });
    text(g, x(Q(0.95)) - 4, 14, "90% interval", { anchor: "end", size: FS - 1, weight: 700, fill: MUTED });
}

// The forecast: three small multiples --------------------------------------------------------
function forecastFigure() {
    const obs = FC_OBS, last = obs[obs.length - 1];
    const dates = [1, 2, 3, 4].map(k => addWeeks(last.date, k));
    const SPREADS = [["Narrow spread", 0.04, 0.05], ["Medium spread", 0.10, 0.10], ["Wide spread", 0.20, 0.17]];
    const yMax = quant(trajectories(last.value, 1.3, 0.20, 0.17).map(t => t[3]), 0.97);
    const wrap = d3.select("#fc-multiples").html("");
    SPREADS.forEach(([name, sg, se], idx) => {
        const cell = wrap.append("div");
        cell.append("p").attr("class", "fig-title").text(name);
        const id = `fc-m${idx}`;
        cell.append("div").attr("id", id);
        const traj = trajectories(last.value, 1.3, sg, se);
        const band = (lo, hi) => dates.map((d, k) => ({ d, lo: quant(traj.map(t => t[k]), lo), hi: quant(traj.map(t => t[k]), hi) }));
        const b90 = band(0.05, 0.95), b50 = band(0.25, 0.75);
        const med = dates.map((d, k) => ({ d, v: quant(traj.map(t => t[k]), 0.5) }));
        const { g, iw, ih } = chartFrame(`#${id}`, 320, 250, { top: 26, right: 10, bottom: 28, left: 44 });
        const x = d3.scaleTime().domain([addWeeks(obs[0].date, 4), dates[3]]).range([0, iw]);
        const y = d3.scaleLinear().domain([0, yMax]).nice().range([ih, 0]).clamp(true);
        axes(g, x, y, iw, ih, 3, fmtDay, 4);
        const area = d3.area().x(d => x(d.d)).y0(d => y(d.lo)).y1(d => y(d.hi));
        g.append("path").datum(b90).attr("d", area).attr("fill", "#7D8798").attr("fill-opacity", 0.35);
        g.append("path").datum(b50).attr("d", area).attr("fill", "#3E4757").attr("fill-opacity", 0.45);
        const line = d3.line().x((_, k) => x(dates[k])).y(v => y(v));
        traj.slice(0, 60).forEach(t => g.append("path").datum(t).attr("d", line).attr("fill", "none").attr("stroke", TRAJ).attr("stroke-opacity", 0.3));
        g.append("path").datum(med).attr("d", d3.line().x(d => x(d.d)).y(d => y(d.v))).attr("fill", "none").attr("stroke", INK).attr("stroke-width", 2).attr("stroke-dasharray", "4,3");
        const shownObs = obs.slice(4);
        lineOf(g, shownObs, x, y); dotsOf(g, shownObs, x, y, 3.2);
        text(g, 0, -10, `90% interval in week 4: ${fmt(Math.round(b90[3].lo))}–${fmt(Math.round(b90[3].hi))}`, { size: FS - 1, weight: 600, fill: MUTED });
    });
}

// Activity and trend --------------------------------------------------------------------------
// The forecast for the week after the one selected is a simple projection of the
// recent trend, spread into 1,000 trajectories. They fan out from the selected
// week, pile up in a histogram in the forecast week, and are counted per block.
function weeklyFigure(T, series, limits, trendOf) {
    if (!series.length) return;
    const visible = series.filter(d => d.date >= new Date("2025-11-01T00:00:00") && d.date <= new Date("2026-04-04T00:00:00"));
    const idxOf = s => Math.max(0, visible.findIndex(d => +d.date === +new Date(s + "T00:00:00")));
    const sel = { activity: idxOf("2025-12-13"), trend: idxOf("2026-01-17") };
    let view = "activity";
    createDial("#wk-dial", "activity");
    const anim = stepper("#wk-play", visible.length - 1, 1500, i => { sel[view] = i; draw(); });
    segButtons(".box-tabs", b => {
        view = b.dataset.view;
        createDial("#wk-dial", view === "trend" ? "trend" : "activity");
        draw();
    });

    function draw() {
        const i = Math.min(sel[view], visible.length - 2);
        const lastPt = visible[i], prev = visible[Math.max(0, i - 1)];
        const fDate = addWeeks(lastPt.date, 1);
        const growth = Math.min(1.8, Math.max(0.6, lastPt.value / Math.max(prev.value, 1)));
        const values = Z1.map(z => Math.max(0, lastPt.value * growth * Math.exp(0.22 * z)));
        const isTrend = view === "trend";
        const L = limits("0");

        let blocks, yDomain, xDomain;
        if (!isTrend) {
            const top = Math.max(T.very_high * 1.2, d3.max(visible, d => d.value) * 1.1);
            yDomain = [0, top];
            blocks = [["very_high", T.very_high, top], ["high", T.high, T.very_high], ["moderate", T.moderate, T.high], ["low", 0, T.moderate]]
                .map(([c, a, b]) => ({ c, a, b, fill: ACTIVITY_BAND_COLORS[c], hist: ACTIVITY_TEXT_COLORS[c], label: ACTIVITY_LABELS[c], lab: ACTIVITY_TEXT_COLORS[c], op: 1 }));
            xDomain = [visible[0].date, addWeeks(visible[visible.length - 1].date, 1)];
        } else {
            // From 0, so the reported weeks stay in view, to above nearly all
            // trajectories, so the histogram is not cut off at the top.
            const amp = Math.max(Math.abs(L.ld), L.li) * 1.35;
            const recent = series.filter(d => d.date >= addWeeks(lastPt.date, -6) && d.date <= lastPt.date);
            const lo = 0, hi = Math.max(lastPt.value + amp, quant(values, 0.995), d3.max(recent, d => d.value)) * 1.08;
            yDomain = [lo, hi];
            blocks = [["large_increase", lastPt.value + L.li, hi], ["increase", lastPt.value + L.i, lastPt.value + L.li],
                      ["stable", lastPt.value + L.d, lastPt.value + L.i], ["decrease", lastPt.value + L.ld, lastPt.value + L.d],
                      ["large_decrease", lo, lastPt.value + L.ld]]
                .map(([c, a, b]) => ({ c, a: Math.max(a, lo), b: Math.min(Math.max(b, lo), hi), fill: TREND_COLORS[c], hist: TREND_TEXT_COLORS[c], label: TREND_LABELS[c], lab: INK, op: 0.45 }));
            xDomain = [addWeeks(lastPt.date, -6), fDate];
        }
        const blockOf = v => isTrend ? trendOf(v - lastPt.value, "0") : classifyActivity(v, DEFAULT_LOCATION);
        const counts = Object.fromEntries(blocks.map(b => [b.c, 0]));
        values.forEach(v => { const c = blockOf(v); counts[c] = (counts[c] || 0) + 1; });
        const probs = Object.fromEntries(blocks.map(b => [b.c, counts[b.c] / N]));

        const W = 720, H = 360, m = { top: 26, right: 14, bottom: 30, left: 50 };
        const { g, ih } = chartFrame("#wk-chart", W, H, m);
        const iwAll = W - m.left - m.right;
        const plotW = 400, histW = 64, barX = plotW + histW + 20, barW = iwAll - barX - (view === "trend" ? 150 : 50);
        const x = d3.scaleTime().domain(xDomain).range([0, plotW]);
        const y = d3.scaleLinear().domain(yDomain).range([ih, 0]).clamp(true);
        const fx = x(fDate);

        // Blocks run across the chart, the forecast week and the bars.
        const bx0 = isTrend ? x(lastPt.date) : 0;
        blocks.forEach(b => {
            const ya = y(b.a), yb = y(b.b);
            if (ya - yb < 0.5) return;
            g.append("rect").attr("x", bx0).attr("width", iwAll - bx0).attr("y", yb).attr("height", ya - yb).attr("fill", b.fill).attr("fill-opacity", b.op);
        });
        g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(isTrend ? 4 : 5).tickFormat(fmtDay).tickSizeOuter(0))
            .call(a => a.selectAll("text").attr("font-size", FS - 0.5).attr("fill", MUTED)).call(a => a.select(".domain").attr("stroke", "#9aa6b2"));
        g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(fmtAxis).tickSizeOuter(0))
            .call(a => a.selectAll("text").attr("font-size", FS - 0.5).attr("fill", MUTED)).call(a => a.select(".domain").attr("stroke", "#9aa6b2"));

        // A line for every week; the selected one is dark.
        visible.forEach(d => {
            if (d.date < xDomain[0] || d.date > lastPt.date) return;
            const on = +d.date === +lastPt.date;
            g.append("line").attr("x1", x(d.date)).attr("x2", x(d.date)).attr("y1", 0).attr("y2", ih)
                .attr("stroke", on ? INK : "#8c99a6").attr("stroke-width", on ? 2 : 0.8).attr("stroke-opacity", on ? 1 : 0.45);
        });
        const past = series.filter(d => d.date >= xDomain[0] && d.date <= lastPt.date);
        lineOf(g, past, x, y); dotsOf(g, past, x, y, 3.4);
        const label = `Last reported ${fmtDay(lastPt.date)}: ${fmt(Math.round(lastPt.value))} admissions. Forecast for ${fmtDay(fDate)} →`;
        text(g, 0, -10, label, { size: FS });
        if (isTrend) g.append("line").attr("x1", x(lastPt.date)).attr("x2", fx).attr("y1", y(lastPt.value)).attr("y2", y(lastPt.value))
            .attr("stroke", INK).attr("stroke-dasharray", "4,3").attr("stroke-opacity", 0.8);

        // Trajectories fan out to the forecast week...
        values.slice(0, 90).forEach(v => g.append("line").attr("x1", x(lastPt.date)).attr("y1", y(lastPt.value)).attr("x2", fx).attr("y2", y(v))
            .attr("stroke", TRAJ).attr("stroke-opacity", 0.14));
        g.append("line").attr("x1", fx).attr("x2", fx).attr("y1", 0).attr("y2", ih).attr("stroke", INK).attr("stroke-width", 1.2);
        // ...and pile up in a histogram, colored by the block each bin is in.
        const bins = d3.bin().domain(yDomain).thresholds(36)(values);
        const hx = d3.scaleLinear().domain([0, d3.max(bins, b => b.length) || 1]).range([0, histW]);
        bins.forEach(b => {
            if (!b.length) return;
            const c = blockOf((b.x0 + b.x1) / 2), bl = blocks.find(bb => bb.c === c);
            g.append("rect").attr("x", fx).attr("y", y(b.x1)).attr("width", hx(b.length)).attr("height", Math.max(0.5, y(b.x0) - y(b.x1) - 0.5))
                .attr("fill", bl ? bl.hist : MUTED);
        });

        // Counting the trajectories in each block gives the share.
        const bs = d3.scaleLinear().domain([0, 1]).range([0, barW]);
        text(g, barX, -10, "Share in each block", { size: FS });
        // Each share sits beside its block; blocks too thin to hold a label are
        // spread apart (top to bottom, then back up) so the labels never overlap.
        const GAP = 16;
        const rows = blocks.map(b => {
            const ya = y(b.a), yb = y(b.b);
            return { b, ya, yb, cy: (ya + yb) / 2, hgt: Math.min(18, Math.max(5, ya - yb - 4)) };
        }).filter(r => isTrend || r.ya - r.yb >= 0.5).sort((p, q) => p.cy - q.cy);
        rows.forEach((r, k) => { r.cy = Math.max(r.cy, k ? rows[k - 1].cy + GAP : GAP / 2); });
        for (let k = rows.length - 1; k >= 0; k--) {
            const r = rows[k];
            r.cy = Math.min(r.cy, k < rows.length - 1 ? rows[k + 1].cy - GAP : ih - GAP / 2);
        }
        rows.forEach(({ b, ya, yb, cy, hgt }) => {
            hgt = Math.min(hgt, GAP - 4);
            g.append("rect").attr("x", barX).attr("y", cy - hgt / 2).attr("width", Math.max(1.5, bs(probs[b.c]))).attr("height", hgt).attr("fill", INK);
            text(g, barX + bs(probs[b.c]) + 6, cy, isTrend ? `${pctText(probs[b.c])}  ${b.label}` : pctText(probs[b.c]), { size: FS - (isTrend ? 1 : 0), dy: "0.35em", weight: 700 });
            if (ya - yb > 16 && !isTrend) text(g, 6, yb + 16, b.label, { size: FS, weight: 700, fill: b.lab });
        });

        // Clicking a week selects it (and pauses the animation).
        visible.forEach((d, k) => {
            if (k > visible.length - 2 || d.date < xDomain[0] || d.date > (isTrend ? lastPt.date : xDomain[1])) return;
            g.append("rect").attr("x", x(d.date) - 8).attr("width", 16).attr("y", 0).attr("height", ih)
                .attr("fill", "transparent").style("cursor", "pointer").on("click", () => anim.set(k));
        });

        const order = isTrend ? TREND_ORDER : ACTIVITY_ORDER;
        const labels = isTrend ? TREND_LABELS : ACTIVITY_LABELS;
        setDialNeedle("#wk-dial", isTrend ? "trend" : "activity", Object.fromEntries(order.map(c => [c, probs[c] || 0])));
        const top = order.reduce((a, c) => ((probs[c] || 0) > (probs[a] || 0) ? c : a), order[0]);
        const color = isTrend ? TREND_TEXT_COLORS[top] : ACTIVITY_TEXT_COLORS[top];
        d3.select("#wk-gauge-title").text(isTrend ? "Influenza Trend gauge" : "Influenza Activity gauge");
        d3.select("#wk-read").html(`Most likely <strong style="color:${color}">${labels[top]}</strong><br>${fmt(counts[top])} of 1,000 trajectories`);
        const cuts = [T.moderate, T.high, T.very_high].map(Math.ceil);
        d3.select("#wk-sub").text(isTrend
            ? "One week ahead. The colored blocks are the trend limits, measured from the last reported week."
            : "The colored blocks are the activity levels.");
        d3.select("#wk-note").text(isTrend
            ? `Weeks 2 to 4 work the same way, compared with the same last reported week, with wider limits. One week ahead: Sharply Decreasing ${signed(Math.round(L.ld))} admissions or less, Decreasing ${signed(Math.round(L.ld))} to ${signed(Math.round(L.d))}, Stable ${signed(Math.round(L.d))} to ${signed(Math.round(L.i))}, Increasing ${signed(Math.round(L.i))} to ${signed(Math.round(L.li))}, Sharply Increasing ${signed(Math.round(L.li))} or more.`
            : `Levels, set by the Moving Epidemic Method from past seasons: Low under ${fmt(cuts[0])}, Medium ${fmt(cuts[0])} to ${fmt(cuts[1] - 1)}, High ${fmt(cuts[1])} to ${fmt(cuts[2] - 1)}, Very High ${fmt(cuts[2])} or more admissions a week.`);
    }
}

// Season start --------------------------------------------------------------------------------
function startFigure(series, epidemic) {
    let obs = series.filter(d => d.date >= new Date("2025-09-27T00:00:00") && d.date <= new Date("2025-11-15T00:00:00"));
    if (obs.length < 3) obs = exampleWeeks([16, 9, 10, 16, 14, 17, 34].map(v => Math.round(v * SCALE)), "2025-11-15");
    const last = obs[obs.length - 1];
    const dates = [1, 2, 3, 4].map(k => addWeeks(last.date, k));
    createDial("#st-dial", "probability", onsetRamp);
    const traj = trajectories(last.value, 1.55, 0.14, 0.12);
    const first = traj.map(t => t.findIndex(v => v >= epidemic));
    const chance = [0, 1, 2, 3].map(k => d3.mean(first, fi => fi >= 0 && fi <= k ? 1 : 0));
    const anim = stepper("#st-play", 6, 1200, i => draw(Math.min(i, 4)));
    function draw(f) {
        const { g, iw, ih } = chartFrame("#st-chart", 640, 270, { top: 40, right: 16, bottom: 30, left: 50 });
        const x = d3.scaleTime().domain([obs[0].date, dates[3]]).range([0, iw]);
        const y = d3.scaleLinear().domain([0, epidemic * 2.4]).range([ih, 0]).clamp(true);
        axes(g, x, y, iw, ih, 6, fmtDay, 4);
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(epidemic)).attr("y2", y(epidemic))
            .attr("stroke", NAVY).attr("stroke-width", 2).attr("stroke-dasharray", "7,4");
        text(g, 4, y(epidemic) - 8, `Epidemic threshold: ${fmt(Math.round(epidemic))} admissions`, { fill: NAVY });
        text(g, x(dates[0]) - 22, -24, "Chance started by this week", { anchor: "end", size: FS - 0.5, weight: 600, fill: MUTED });
        dates.forEach((d, k) => text(g, x(d), -24, k < f ? pctText(chance[k]) : "", { anchor: "middle", size: FS + 1, weight: 700, fill: TEAL }));
        if (f > 0) {
            const line = d3.line().x((_, k) => x(dates[k])).y(v => y(v));
            traj.slice(0, 60).forEach((t, n) => {
                const seg = t.slice(0, f);
                if (seg.length > 1) g.append("path").datum(seg).attr("d", line).attr("fill", "none").attr("stroke", TRAJ).attr("stroke-opacity", 0.3).attr("stroke-width", 1.1);
                if (first[n] >= 0 && first[n] < f) g.append("circle").attr("cx", x(dates[first[n]])).attr("cy", y(t[first[n]])).attr("r", 3.4).attr("fill", TEAL);
            });
            g.append("line").attr("x1", x(dates[f - 1])).attr("x2", x(dates[f - 1])).attr("y1", -14).attr("y2", ih).attr("stroke", INK).attr("stroke-width", 1.6);
        }
        lineOf(g, obs, x, y); dotsOf(g, obs, x, y, 3.4);
        dates.forEach((d, k) => g.append("rect").attr("x", x(d) - 18).attr("width", 36).attr("y", -36).attr("height", ih + 36)
            .attr("fill", "transparent").style("cursor", "pointer").on("click", () => anim.set(k + 1)));
        const p = f > 0 ? chance[f - 1] : 0;
        setDialNeedle("#st-dial", "probability", p);
        d3.select("#st-read").html(f > 0 ? `<strong>${pctText(p)}</strong> chance it has started by the week ending ${fmtDay(dates[f - 1])}` : "Before the forecast: not started");
    }
}

// Peak ---------------------------------------------------------------------------------------
function peakFigure() {
    const start = new Date(seasonMeta.start + "T00:00:00");
    const W = d3.range(0, 45);
    createDial("#pk-dial", "probability", peakRamp);
    const traj = d3.range(N).map(n => {
        const p = 21 + 3 * Z1[n], H = 900 * SCALE * Math.exp(0.3 * Z2[0][n]), w = 4 + 0.6 * Z2[1][n];
        return W.map(t => 8 * SCALE + H * Math.exp(-((t - p) ** 2) / (2 * w * w)));
    });
    const peaks = traj.map(t => d3.maxIndex(t));
    const lo = Math.round(quant(peaks, 0.1)), hi = Math.round(quant(peaks, 0.9));
    const FIRST = 10, LAST = 34;
    const anim = stepper("#pk-play", LAST - FIRST + 1, 500, i => draw(FIRST + i));
    function draw(pk) {
        const passed = d3.mean(peaks, p => p <= pk ? 1 : 0);
        const { g, iw, ih } = chartFrame("#pk-chart", 640, 270, { top: 20, right: 16, bottom: 30, left: 50 });
        const x = d3.scaleLinear().domain([W[0], W[W.length - 1]]).range([0, iw]);
        const y = d3.scaleLinear().domain([0, 1500 * SCALE]).range([ih, 0]).clamp(true);
        axes(g, x, y, iw, ih, 7, w => fmtDay(addWeeks(start, w)), 4);
        g.append("rect").attr("x", x(lo)).attr("width", Math.max(2, x(hi) - x(lo))).attr("y", 0).attr("height", ih).attr("fill", PEAK_GOLD).attr("fill-opacity", 0.14);
        text(g, x(lo) + 4, 14, "Likely peak", { fill: "#7a5600" });
        g.append("rect").attr("x", x(pk)).attr("width", x(pk + 4) - x(pk)).attr("y", 0).attr("height", ih).attr("fill", NAVY).attr("fill-opacity", 0.1);
        const line = d3.line().x((_, k) => x(W[k])).y(v => y(v));
        traj.slice(0, 40).forEach((t, n) => {
            g.append("path").datum(t).attr("d", line).attr("fill", "none").attr("stroke", TRAJ).attr("stroke-opacity", 0.22);
            g.append("circle").attr("cx", x(peaks[n])).attr("cy", y(t[peaks[n]])).attr("r", 3.4)
                .attr("fill", peaks[n] <= pk ? PEAK_GOLD : "#fff").attr("stroke", peaks[n] <= pk ? PEAK_GOLD : TRAJ).attr("stroke-width", 1.4);
        });
        g.append("line").attr("x1", x(pk)).attr("x2", x(pk)).attr("y1", 0).attr("y2", ih).attr("stroke", INK).attr("stroke-width", 1.8);
        text(g, x(pk) - 6, ih - 10, `Forecast made ${fmtDay(addWeeks(start, pk))}`, { anchor: "end" });
        text(g, x(pk + 2), ih - 26, "4 weeks", { anchor: "middle", size: FS - 1, fill: NAVY });
        g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent").style("cursor", "pointer")
            .on("click", e => { const w = Math.round(x.invert(d3.pointer(e)[0])); anim.set(Math.max(FIRST, Math.min(LAST, w)) - FIRST); });
        setDialNeedle("#pk-dial", "probability", passed);
        const sun = w => { const s = addWeeks(start, w); s.setDate(s.getDate() - 6); return s; };
        d3.select("#pk-read").html(`<strong>${pctText(passed)}</strong> chance the peak has passed<br>Likely peak: ${fmtDay(sun(lo))} to ${fmtDay(addWeeks(start, hi))}`);
    }
}

// Try it ----------------------------------------------------------------------------------------
function tryFigure(T, limits) {
    createDial("#t-dial-activity", "activity");
    createDial("#t-dial-trend", "trend");
    let sigma = 0.3, h = 0, colorBy = "activity";
    segButtons("#t-spread", b => { sigma = +b.dataset.sigma; update(); });
    segButtons("#t-weeks", b => { h = +b.dataset.h; update(); });
    segButtons("#t-color", b => { colorBy = b.dataset.c; update(); });
    // Slider ranges in admissions for this location.
    const step = Math.max(1, Math.round(5 * SCALE / 10) * 10);
    [["#t-last", 1200, 150], ["#t-mid", 1600, 260]].forEach(([s, max, v]) => {
        const el = pick(s);
        el.min = step; el.step = step;
        el.max = Math.round(max * SCALE / step) * step;
        el.value = Math.round(v * SCALE / step) * step;
    });
    ["#t-last", "#t-mid"].forEach(s => pick(s).addEventListener("input", update));
    const lastDate = new Date("2026-10-10T00:00:00");
    const dates = [1, 2, 3, 4].map(k => addWeeks(lastDate, k));

    function update() {
        const last = +pick("#t-last").value, mid = +pick("#t-mid").value;
        pick("#t-last-out").textContent = `${fmt(last)} admissions`;
        pick("#t-mid-out").textContent = `${fmt(mid)} admissions`;
        const gr = Math.log(mid / last) / (h + 1);
        const traj = d3.range(N).map(i => [0, 1, 2, 3].map(k =>
            last * Math.exp(gr * Math.min(k + 1, h + 1) + sigma * Math.sqrt((k + 1) / (h + 1)) * Z1[i])));
        const samples = traj.map(t => t[h]);
        const share = f => samples.filter(f).length / N;

        const obs = exampleWeeks([Math.round(last * 0.55), Math.round(last * 0.7), Math.round(last * 0.85), last], "2026-10-10");
        const { g, iw, ih } = chartFrame("#t-chart", 960, 290, { top: 16, right: 140, bottom: 30, left: 50 });
        const x = d3.scaleTime().domain([obs[0].date, dates[3]]).range([0, iw]);
        const yMax = Math.max(last, quant(traj.map(t => t[3]), 0.95)) * 1.1;
        const y = d3.scaleLinear().domain([0, yMax]).nice().range([ih, 0]).clamp(true);
        const L = limits(String(h));
        const blocks = colorBy === "activity"
            ? [["low", 0, T.moderate], ["moderate", T.moderate, T.high], ["high", T.high, T.very_high], ["very_high", T.very_high, Infinity]]
                .map(([c, a, b]) => ({ a, b, fill: ACTIVITY_BAND_COLORS[c], op: 1, label: ACTIVITY_LABELS[c], x0: 0 }))
            : [["large_decrease", -Infinity, last + L.ld], ["decrease", last + L.ld, last + L.d], ["stable", last + L.d, last + L.i],
               ["increase", last + L.i, last + L.li], ["large_increase", last + L.li, Infinity]]
                .map(([c, a, b]) => ({ a, b, fill: TREND_COLORS[c], op: 0.45, label: TREND_LABELS[c], x0: x(lastDate) }));
        const [d0, d1] = y.domain();
        blocks.forEach(bk => {
            const a = Math.max(bk.a, d0), b = Math.min(bk.b, d1);
            if (b <= a) return;
            g.append("rect").attr("x", bk.x0).attr("width", iw - bk.x0).attr("y", y(b)).attr("height", y(a) - y(b)).attr("fill", bk.fill).attr("fill-opacity", bk.op);
            if (y(a) - y(b) > 14) text(g, iw + 8, (y(a) + y(b)) / 2, bk.label, { dy: "0.35em" });
        });
        axes(g, x, y, iw, ih, 7, fmtDay);
        const band = (lo, hi) => dates.map((d, k) => ({ d, lo: quant(traj.map(t => t[k]), lo), hi: quant(traj.map(t => t[k]), hi) }));
        const area = d3.area().x(d => x(d.d)).y0(d => y(d.lo)).y1(d => y(d.hi));
        g.append("path").datum(band(0.05, 0.95)).attr("d", area).attr("fill", "#7D8798").attr("fill-opacity", 0.35);
        g.append("path").datum(band(0.25, 0.75)).attr("d", area).attr("fill", "#3E4757").attr("fill-opacity", 0.45);
        const line = d3.line().x((_, k) => x(dates[k])).y(v => y(v));
        traj.slice(0, 50).forEach(t => g.append("path").datum(t).attr("d", line).attr("fill", "none").attr("stroke", TRAJ).attr("stroke-opacity", 0.3));
        g.append("path").datum(dates.map((d, k) => ({ d, v: quant(traj.map(t => t[k]), 0.5) }))).attr("d", d3.line().x(d => x(d.d)).y(d => y(d.v)))
            .attr("fill", "none").attr("stroke", INK).attr("stroke-width", 2).attr("stroke-dasharray", "4,3");
        const xs = x(dates[h]);
        g.append("rect").attr("x", xs - 16).attr("width", 32).attr("y", 0).attr("height", ih).attr("fill", "none").attr("stroke", INK).attr("stroke-dasharray", "3,3");
        text(g, xs, ih - 8, "Week you picked", { anchor: "middle" });
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(last)).attr("y2", y(last)).attr("stroke", INK).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "5,4");
        lineOf(g, obs, x, y); dotsOf(g, obs, x, y, 3.4);

        const actProbs = { low: share(v => v < T.moderate), moderate: share(v => v >= T.moderate && v < T.high),
                           high: share(v => v >= T.high && v < T.very_high), very_high: share(v => v >= T.very_high) };
        const entry = { median_value: quant(samples, 0.5), activity_probs: actProbs, activity_most_likely: "low" };
        const cat = classifyActivity(entry.median_value, DEFAULT_LOCATION);
        setDialNeedle("#t-dial-activity", "activity", actProbs);
        d3.select("#t-answer-activity").html(`Most likely <strong style="color:${ACTIVITY_TEXT_COLORS[cat]}">${ACTIVITY_LABELS[cat]}</strong>`);
        d3.select("#t-conf-activity").html(confHtml(confidenceActivity(entry)));
        d3.select("#t-bars-activity").html(barsHtml(ACTIVITY_ORDER, ACTIVITY_LABELS, ACTIVITY_COLORS, actProbs));

        const ch = v => v - last;
        const trendProbs = { large_decrease: share(v => ch(v) <= L.ld), decrease: share(v => ch(v) > L.ld && ch(v) <= L.d),
                             stable: share(v => ch(v) > L.d && ch(v) < L.i), increase: share(v => ch(v) >= L.i && ch(v) < L.li),
                             large_increase: share(v => ch(v) >= L.li) };
        const most = TREND_ORDER.reduce((a, c) => (trendProbs[c] > trendProbs[a] ? c : a), TREND_ORDER[0]);
        const tEntry = { trend_probs: trendProbs, trend_most_likely: most };
        const ts = trendSummary(tEntry);
        setDialNeedle("#t-dial-trend", "trend", trendProbs);
        d3.select("#t-answer-trend").html(`Most likely <strong style="color:${ts.color}">${ts.label}</strong>`);
        d3.select("#t-conf-trend").html(confHtml(confidenceTrend(tEntry)));
        d3.select("#t-bars-trend").html(barsHtml(TREND_ORDER, TREND_LABELS, TREND_COLORS, trendProbs));
        d3.select("#t-summary").html(`In the week you picked, the 80% interval (the dashboard's likely range) is <strong>${fmt(Math.round(quant(samples, 0.1)))} to ${fmt(Math.round(quant(samples, 0.9)))}</strong> admissions, ` +
            `and the median is <strong>${signed(Math.round(entry.median_value - last))}</strong> from the last reported week.`);
    }
    update();
}

initMethods().catch(err => console.error("Methods page failed:", err));
