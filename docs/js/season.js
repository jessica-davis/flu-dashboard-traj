// Season selection shared by every page.
//
// data/seasons.json (written by scripts/process_trajectories.py) lists the
// seasons the site knows about. The active season comes from the ?season=
// query parameter, falling back to the manifest's default_season. Changing
// the header dropdown reloads the page with the new ?season= value; nav links
// carry the parameter so the choice persists across pages.
//
// Globals defined here: seasonManifest, seasonMeta, and the helpers below.
// Loaded before every other page script (no d3 dependency).

let seasonManifest = null;   // parsed data/seasons.json
let seasonMeta = null;       // the active season's manifest entry

async function loadSeasonManifest() {
    const res = await fetch("data/seasons.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load data/seasons.json (${res.status})`);
    seasonManifest = await res.json();
    return seasonManifest;
}

function selectableSeasons(manifest) {
    return (manifest?.seasons || []).filter(s => s.selectable);
}

// Active season: ?season= if it names a selectable season, else the default.
function resolveSeason(manifest) {
    const requested = new URLSearchParams(window.location.search).get("season");
    const selectable = selectableSeasons(manifest);
    return selectable.find(s => s.name === requested)
        || selectable.find(s => s.name === manifest.default_season)
        || selectable[selectable.length - 1]
        || null;
}

// URL for a generated data file, versioned with the manifest's generated_at so
// browsers (and the CDN) never serve a stale copy after a pipeline rerun.
function dataUrl(path) {
    const v = seasonManifest?.generated_at;
    return v ? `${path}?v=${encodeURIComponent(v)}` : path;
}

// URL of a per-season data file, e.g. seasonDataPath("2025-26", "peak_week.json").
function seasonDataPath(seasonName, file) {
    return dataUrl(`data/seasons/${seasonName}/${file}`);
}

// Seasons that started before `current`, oldest first (the "previous seasons"
// overlay list). Includes non-selectable, overlay-only seasons.
function previousSeasons(manifest, current) {
    return (manifest?.seasons || [])
        .filter(s => s.start < current.start)
        .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

// Most recent selectable season that has forecasts (for "view last season" links).
function latestSeasonWithForecasts(manifest, excludeName) {
    const withForecasts = selectableSeasons(manifest)
        .filter(s => s.has_forecasts && s.name !== excludeName)
        .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return withForecasts[withForecasts.length - 1] || null;
}

function seasonUrl(page, seasonName) {
    return `${page}?season=${encodeURIComponent(seasonName)}`;
}

function initSeasonSelect(manifest, current) {
    const select = document.getElementById("season-select");
    if (!select) return;
    select.innerHTML = "";
    // Newest season first.
    const seasons = selectableSeasons(manifest)
        .slice()
        .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
    seasons.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.name;
        opt.textContent = s.has_forecasts ? s.name : `${s.name} (surveillance only)`;
        select.appendChild(opt);
    });
    if (current) select.value = current.name;

    select.addEventListener("change", () => {
        const url = new URL(window.location.href);
        url.searchParams.set("season", select.value);
        window.location.href = url.href;
    });
}

// Rewrite header nav links so the season follows the reader between pages.
function propagateSeasonToNav(seasonName) {
    document.querySelectorAll(".header-nav a.nav-link[href]").forEach(a => {
        const base = a.getAttribute("href").split("?")[0];
        a.setAttribute("href", seasonUrl(base, seasonName));
    });
}

// "2026-09-05" -> "Sep 5, 2026"
function formatLongDateStr(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Fill a `.season-notice` card for a season with no forecasts yet.
// `page` is the page to link to for the most recent season with forecasts.
function renderSeasonNotice(el, manifest, season, page) {
    if (!el || !season) return;
    const prev = latestSeasonWithForecasts(manifest, season.name);
    const through = season.observed_through;
    const dataLine = through
        ? `Observed weekly ED visits are available through <strong>${formatLongDateStr(through)}</strong> and are shown in the chart below.`
        : `No weekly ED visit data has been reported for this season yet.`;
    const prevLine = prev
        ? ` <a href="${seasonUrl(page, prev.name)}">View the ${prev.name} season</a>.`
        : "";
    el.innerHTML = `
        <h3 class="season-notice-title">Forecasts for the ${season.name} season have not started yet.</h3>
        <p class="season-notice-text">${dataLine} Forecasts will appear here once the first forecast of the season is issued.${prevLine}</p>`;
}

// Load the manifest, resolve the active season, and wire the header.
// Returns seasonMeta (also set globally).
async function bootSeasonHeader() {
    const manifest = await loadSeasonManifest();
    seasonMeta = resolveSeason(manifest);
    if (!seasonMeta) throw new Error("data/seasons.json lists no selectable seasons");
    initSeasonSelect(manifest, seasonMeta);
    propagateSeasonToNav(seasonMeta.name);
    return seasonMeta;
}
