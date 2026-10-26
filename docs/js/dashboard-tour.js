// Guided Tour — lightweight walkthrough with spotlight overlay.
// Written for everyone from epidemiologists to clinical staff: plain words
// first, the method in a sentence after.

// One explanation per gauge. Used by the gauge "?" buttons and by the
// tour's summary step.
const VIEW_INFO = {
    activity: {
        title: "Influenza Activity",
        body: "<p class=\"info-lead\">How busy hospitals are likely to be with flu in the week you picked.</p>" +
            "<p class=\"info-h\">How it\u2019s calculated</p>" +
            "<ol class=\"info-steps\">" +
            "<li>The model makes 1,000 forecasts of weekly flu hospital admissions, each with slightly different assumptions.</li>" +
            "<li>Each forecast is placed in a level using the fixed limits below.</li>" +
            "<li>The chance of each level is how many of the 1,000 forecasts land in it. The gauge shows the level of the middle forecast.</li>" +
            "</ol>" +
            "<!--detail:activity_table-->"
    },
    trend: {
        title: "Influenza Trend",
        body: "<p class=\"info-lead\">Whether flu hospital admissions are likely to go up, go down or stay about the same.</p>" +
            "<p class=\"info-h\">How it\u2019s calculated</p>" +
            "<ol class=\"info-steps\">" +
            "<li>Start from the most recent week of reported data: the week just before the forecast.</li>" +
            "<li>For each of the 1,000 forecasts, take the forecast admissions for the week you picked and subtract the admissions in that reported week. That difference is the <strong>change</strong>. Every forecast week is compared with the same reported week, so week 4 covers four weeks of change.</li>" +
            "<li>Sort the change into a trend using the limits below. The limits are changes in the weekly rate per 100,000 people (the FluSight trend categories), shown here as admissions for this location; a change of fewer than 10 admissions always counts as Stable. Weeks further ahead have wider limits, because admissions can change more over more weeks.</li>" +
            "<li>The chance of each trend is how many of the 1,000 forecasts land in it.</li>" +
            "</ol>" +
            "<!--detail:trend_table-->"
    },
    onset: {
        title: "Projected Season Start",
        body: "Has the flu season begun? The season starts the first week hospital admissions reach the <strong>epidemic threshold</strong>, the level that separates ordinary off-season activity from the flu season (the Moving Epidemic Method used by WHO Europe and ECDC). " +
            "Before that happens, the dial shows the chance the season will have started by the selected week, and the sentence says it in words. " +
            "Once reported admissions have crossed the threshold, the gauge reports the week it happened.<br><br>" +
            "<strong>Show all chances</strong> lists the chance for each of the four forecast weeks; these only go up from week 1 to week 4, because they mean \u201cby this week or earlier\u201d."
    },
    peak: {
        title: "Projected Peak Week",
        body: "When will admissions be highest, and is the worst over? Each model run has its own peak week; the sentence names the most likely one. " +
            "The dial is the chance the peak has <strong>already happened</strong> by the selected week: near 0% means it is still ahead, near 100% means it has most likely passed and admissions should decline.<br><br>" +
            "Underneath are the two most likely peak weeks. <strong>Show all chances</strong> lists more.<br><br>" +
            "The peak week is read from the whole length of each model run, so it can fall later than the four weeks shown on the chart."
    }
};

const TOUR_STEPS = [
    {
        selector: ".card-map",
        infoKey: "map",
        title: "The map",
        text: "Every state for the forecast week you picked, colored by the gauge outlined in the panel on the right. " +
            "<strong>Click a gauge</strong> to change what the map shows, and <strong>click a state</strong> to see its gauges and chart. " +
            "<strong>United States</strong> goes back to the national forecast.<br><br>" +
            "For activity and trend, <strong>Uncertainty</strong> colors each state by its most likely answer, or by the lower or upper end of its forecast. " +
            "Hatched states have no forecast that week.",
        position: "right",
        wide: true
    },
    {
        selector: ".summary-headline",
        infoKey: "overview",
        title: "The overview",
        text: "The quick answer for the forecast week you picked.<br><br>" +
            "The top line is that week\u2019s dates. Below it are the <strong>activity level</strong> (how busy) and the <strong>trend</strong> (going up, down or staying about the same), followed by the likely number of flu hospital admissions.<br><br>" +
            "The two tiles give the likely dates for the <strong>season start</strong> and the <strong>peak</strong>. Their <strong>?</strong> explains what each one means.",
        position: "left"
    },
    {
        selector: "#tab-bar",
        infoKey: "tabs",
        title: "Two tabs",
        text: "These switch the gauges right below them. " +
            "<strong>Activity &amp; Trend</strong> shows how busy the week will be and which way admissions are heading. " +
            "<strong>Projected Start &amp; Peak</strong> shows whether the season has begun and when it is likely to peak. " +
            "Switching tabs also switches the map.",
        position: "left"
    },
    {
        selector: ".summary-pane.active",
        infoKey: "panels",
        title: "The gauges",
        text: "Each gauge has a <strong>needle</strong> pointing to the forecast, a short answer in words, and the chances of the two most likely answers. " +
            "The model makes 1,000 forecasts with slightly different assumptions, and the chances are how many of them agree.<br><br>" +
            "<strong>Show all chances</strong> lists every option. The <strong>?</strong> on each gauge explains how it is calculated, with this week as an example.",
        position: "left",
        wide: true
    },
    {
        selector: ".panel-week-row",
        infoKey: "panels",
        title: "Forecast week",
        text: "Each forecast covers the next four weeks. Pick a week here: the overview and the gauges describe that week, and the chart outlines it with a dotted box. " +
            "The first week ends on the forecast date, and it is the first week not yet reported when the forecast was made.",
        position: "left"
    },
    {
        selector: ".traj-chart-container",
        infoKey: "traj",
        title: "The chart",
        text: "Weekly flu hospital admissions for the selected location this season and the forecast for the next four weeks.<br><br>" +
            "<strong>Black dots</strong> on a solid line are the weekly counts known when the forecast was made. " +
            "<strong>White dots</strong> on a dashed line are counts reported afterwards, so you can see how the forecast did. " +
            "The <strong>grey bands</strong> are where admissions are likely to land: half of the forecasts fall inside the darker band and nine in ten inside the lighter one. A narrow band means a confident forecast.<br><br>" +
            "<strong>Click any week on the chart</strong> to see the forecast made that week.<br><br>" +
            "<em>Recent weeks can change as late reports come in.</em> Turn on <strong>Data as reported</strong> to see the numbers as they stood when the forecast was made.",
        position: "top",
        wide: true
    },
    {
        selector: ".traj-controls",
        infoKey: "traj",
        title: "Chart options",
        text: "<strong>Forecast</strong> picks an earlier forecast date and <strong>Location</strong> picks a state. " +
            "<strong>Forecast bands</strong> turns the bands on and off, and <strong>Trajectories</strong> draws individual model runs.<br><br>" +
            "<strong>Activity levels</strong> shades the chart by level. " +
            "<strong>Previous seasons</strong> adds past seasons, lined up by week, to compare timing and size. " +
            "<strong>Data as reported</strong> adds, in orange, the data as it stood when the forecast was made. " +
            "<strong>Full season</strong> shows the whole season.",
        position: "bottom"
    }
];

// Build INFO_TEXT automatically from TOUR_STEPS — single source of truth.
// Each step's infoKey maps it to an info button. Steps sharing a key are combined.
function buildInfoText() {
    var result = {};
    var divider = '<hr class="info-divider">';
    TOUR_STEPS.forEach(function(step) {
        if (!step.infoKey) return;
        var html = '<div class="info-section"><strong class="info-section-title">' + step.title + '</strong>' + step.text;
        // Include dropdown content expanded inline
        if (step.dropdown) {
            step.dropdown.items.forEach(function(item) {
                html += divider + '<strong class="info-subsection-title">' + item.title + '</strong>' + item.body;
            });
        }
        html += '</div>';
        if (result[step.infoKey]) {
            result[step.infoKey] += divider + html;
        } else {
            result[step.infoKey] = html;
        }
    });
    return result;
}

var INFO_TEXT = buildInfoText();

// Which Methods section each "?" links to.
var METHODS_SECTION = {
    activity: "weekly", trend: "weekly", onset: "start", peak: "peak",
    season_start_def: "start", peak_def: "peak", traj: "forecast",
    panels: "weekly", overview: "weekly", tabs: "weekly", map: "weekly"
};

// Definitions behind the "?" on the summary tiles.
INFO_TEXT.season_start_def =
    '<div class="info-section"><strong class="info-section-title">Projected season start</strong>' +
    '<p class="info-lead">The flu season starts the first week that flu hospital admissions reach <strong><!--detail:epidemic--> admissions a week</strong>.</p>' +
    '<p class="info-week">That level, the <em>epidemic threshold</em>, separates the usual low off-season numbers from real flu-season activity.</p>' +
    '<p class="info-week">The dates shown are the likely range for that first week: 8 in 10 of the model\u2019s forecasts put the start between them. Once the season has started, the tile shows the week it happened.</p></div>';
INFO_TEXT.peak_def =
    '<div class="info-section"><strong class="info-section-title">Projected peak</strong>' +
    '<p class="info-lead">The peak is the week with the most flu hospital admissions this season.</p>' +
    '<p class="info-week">After the peak, weekly admissions are expected to come down.</p>' +
    '<p class="info-week">The dates shown are the likely range for the peak week: 8 in 10 of the model\u2019s forecasts put the peak between them. After the peak has passed, the tile says when it most likely was.</p></div>';
Object.keys(VIEW_INFO).forEach(function (k) {
    INFO_TEXT[k] = '<div class="info-section"><strong class="info-section-title">' + VIEW_INFO[k].title + '</strong>' + VIEW_INFO[k].body + '</div>';
});

let tourActive = false;
let tourStep = 0;
let tourOverlay = null;
let tourPopup = null;
let tourHighlighted = [];

function startTour() {
    // The tour walks through forecast widgets that are hidden in surveillance-only mode.
    if (typeof AppState !== "undefined" && AppState.surveillanceOnly) return;
    tourActive = true;
    tourStep = 0;

    // Create overlay
    tourOverlay = document.createElement("div");
    tourOverlay.className = "tour-overlay";
    tourOverlay.addEventListener("click", endTour);
    document.body.appendChild(tourOverlay);

    // Create popup
    tourPopup = document.createElement("div");
    tourPopup.className = "tour-popup";
    tourPopup.addEventListener("click", e => e.stopPropagation());
    document.body.appendChild(tourPopup);

    // Keyboard navigation
    document.addEventListener("keydown", tourKeyHandler);

    goToStep(0);
}

function endTour() {
    tourActive = false;

    tourHighlighted.forEach(el => el.classList.remove("tour-spotlight"));
    tourHighlighted = [];

    if (tourOverlay) {
        tourOverlay.remove();
        tourOverlay = null;
    }
    if (tourPopup) {
        tourPopup.remove();
        tourPopup = null;
    }

    document.removeEventListener("keydown", tourKeyHandler);
}

function tourKeyHandler(e) {
    if (!tourActive) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (tourStep < TOUR_STEPS.length - 1) goToStep(tourStep + 1);
        else endTour();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (tourStep > 0) goToStep(tourStep - 1);
    } else if (e.key === "Escape") {
        e.preventDefault();
        endTour();
    }
}

function buildDropdownHTML(dropdown) {
    if (!dropdown) return "";
    let html = '<div class="tour-dropdown">';
    html += '<button class="tour-dropdown-toggle">' + dropdown.label + ' <span class="tour-dropdown-chevron">&#9662;</span></button>';
    html += '<div class="tour-dropdown-body" style="display:none;">';
    dropdown.items.forEach(function(item) {
        html += '<div class="tour-dropdown-item">';
        html += '<button class="tour-dropdown-item-header"><strong>' + item.title + '</strong> <span class="tour-dropdown-chevron">&#9662;</span></button>';
        html += '<div class="tour-dropdown-item-body" style="display:none;">' + item.body + '</div>';
        html += '</div>';
    });
    html += '</div></div>';
    return html;
}

// Get combined bounding rect for multiple selectors
function getCombinedRect(selectors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const els = [];
    selectors.forEach(function(sel) {
        const el = document.querySelector(sel);
        if (!el) return;
        els.push(el);
        const r = el.getBoundingClientRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right);
        maxY = Math.max(maxY, r.bottom);
    });
    return {
        els: els,
        rect: { left: minX, top: minY, right: maxX, bottom: maxY,
                width: maxX - minX, height: maxY - minY }
    };
}

function goToStep(n) {
    tourStep = n;
    var step = TOUR_STEPS[n];

    // Resolve target elements
    var selectors = step.selectors || [step.selector];
    var combined = getCombinedRect(selectors);
    var targets = combined.els;
    var rect = combined.rect;

    if (targets.length === 0) return;

    // Remove previous highlights
    tourHighlighted.forEach(function(el) { el.classList.remove("tour-spotlight"); });
    tourHighlighted = [];

    // Scroll first target into view
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(function() {
        targets.forEach(function(el) {
            el.classList.add("tour-spotlight");
        });
        tourHighlighted = targets;

        // Recompute rect after scroll
        combined = getCombinedRect(selectors);
        rect = combined.rect;

        var pad = 8;
        var r = 6;
        var x1 = rect.left - pad;
        var y1 = rect.top - pad;
        var x2 = rect.right + pad;
        var y2 = rect.bottom + pad;

        tourOverlay.style.clipPath = 'polygon(' +
            '0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ' +
            x1 + 'px ' + (y1 + r) + 'px, ' +
            (x1 + r) + 'px ' + y1 + 'px, ' +
            (x2 - r) + 'px ' + y1 + 'px, ' +
            x2 + 'px ' + (y1 + r) + 'px, ' +
            x2 + 'px ' + (y2 - r) + 'px, ' +
            (x2 - r) + 'px ' + y2 + 'px, ' +
            (x1 + r) + 'px ' + y2 + 'px, ' +
            x1 + 'px ' + (y2 - r) + 'px, ' +
            x1 + 'px ' + (y1 + r) + 'px)';

        var isLast = n === TOUR_STEPS.length - 1;
        var isFirst = n === 0;
        var dropdownHTML = buildDropdownHTML(step.dropdown);

        // Apply wide class for steps with longer content
        tourPopup.className = "tour-popup" + (step.wide ? " tour-popup-wide" : "");

        tourPopup.innerHTML =
            '<button class="tour-close" aria-label="Close tour">&times;</button>' +
            '<div class="tour-popup-body">' +
                '<div class="tour-step-title">' + step.title + '</div>' +
                '<div class="tour-step-text">' + step.text + '</div>' +
                dropdownHTML +
            '</div>' +
            '<div class="tour-nav">' +
                '<span class="tour-counter">' + (n + 1) + ' of ' + TOUR_STEPS.length + '</span>' +
                '<div class="tour-arrows">' +
                    '<button class="tour-arrow tour-prev" ' + (isFirst ? 'disabled' : '') + ' aria-label="Previous">&#8592;</button>' +
                    '<button class="tour-arrow tour-next" aria-label="' + (isLast ? 'Finish' : 'Next') + '">' + (isLast ? 'Finish &#10003;' : '&#8594;') + '</button>' +
                '</div>' +
            '</div>';

        tourPopup.querySelector(".tour-close").addEventListener("click", endTour);
        tourPopup.querySelector(".tour-prev").addEventListener("click", function() {
            if (tourStep > 0) goToStep(tourStep - 1);
        });
        tourPopup.querySelector(".tour-next").addEventListener("click", function() {
            if (tourStep < TOUR_STEPS.length - 1) goToStep(tourStep + 1);
            else endTour();
        });

        // Wire up dropdown toggles
        var mainToggle = tourPopup.querySelector(".tour-dropdown-toggle");
        if (mainToggle) {
            mainToggle.addEventListener("click", function() {
                var body = mainToggle.nextElementSibling;
                var chevron = mainToggle.querySelector(".tour-dropdown-chevron");
                var isOpen = body.style.display !== "none";
                body.style.display = isOpen ? "none" : "block";
                chevron.innerHTML = isOpen ? "&#9662;" : "&#9652;";
                setTimeout(function() { positionPopup(rect, step.position); }, 50);
            });
        }
        tourPopup.querySelectorAll(".tour-dropdown-item-header").forEach(function(hdr) {
            hdr.addEventListener("click", function() {
                var itemBody = hdr.nextElementSibling;
                var chevron = hdr.querySelector(".tour-dropdown-chevron");
                var isOpen = itemBody.style.display !== "none";
                itemBody.style.display = isOpen ? "none" : "block";
                chevron.innerHTML = isOpen ? "&#9662;" : "&#9652;";
                setTimeout(function() { positionPopup(rect, step.position); }, 50);
            });
        });

        positionPopup(rect, step.position);
    }, 350);
}

function positionPopup(targetRect, preferred) {
    var popup = tourPopup;
    var gap = 14;

    popup.style.left = "0px";
    popup.style.top = "0px";
    var pw = popup.offsetWidth;
    var ph = popup.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var left, top;

    if (preferred === "bottom") {
        left = targetRect.left + targetRect.width / 2 - pw / 2;
        top = targetRect.bottom + gap;
    } else if (preferred === "top") {
        left = targetRect.left + targetRect.width / 2 - pw / 2;
        top = targetRect.top - ph - gap;
    } else if (preferred === "right") {
        left = targetRect.right + gap;
        top = targetRect.top + targetRect.height / 2 - ph / 2;
    } else if (preferred === "left") {
        left = targetRect.left - pw - gap;
        top = targetRect.top + targetRect.height / 2 - ph / 2;
    }

    if (left + pw > vw - 16) left = vw - pw - 16;
    if (left < 16) left = 16;
    if (top + ph > vh - 16) top = vh - ph - 16;
    if (top < 16) top = 16;

    popup.style.left = left + "px";
    popup.style.top = top + "px";
}

// --- Info Buttons (modal panel) ---

// One listener for every "?" on the page, including ones drawn later
// (the summary tiles are rebuilt whenever the forecast changes).
function initInfoButtons() {
    document.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-info]");
        if (!btn) return;
        e.stopPropagation();
        var key = btn.getAttribute("data-info");
        var text = INFO_TEXT[key];
        if (!text) return;
        // Fill numbers and tables for the selected forecast at click time.
        text = text.replace(/<!--detail:(\w+)-->/g, function (_, k) {
            return (typeof infoDetailHtml === "function") ? infoDetailHtml(k) : "";
        });
        openInfoModal(text, METHODS_SECTION[key]);
    });
}

function openInfoModal(html, section) {
    // Remove existing modal if open
    closeInfoModal();

    var backdrop = document.createElement("div");
    backdrop.className = "info-modal-backdrop";
    backdrop.addEventListener("click", closeInfoModal);

    var panel = document.createElement("div");
    panel.className = "info-modal";
    panel.addEventListener("click", function(e) { e.stopPropagation(); });
    var seasonQuery = (typeof seasonMeta !== "undefined" && seasonMeta) ? "?season=" + encodeURIComponent(seasonMeta.name) : "";
    panel.innerHTML =
        '<button class="info-modal-close" aria-label="Close">&times;</button>' +
        '<div class="info-modal-body">' + html +
            (section ? '<div class="info-modal-footer"><a href="methods.html' + seasonQuery + '#' + section + '">How this is calculated</a></div>' : '') +
        '</div>';

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    panel.querySelector(".info-modal-close").addEventListener("click", closeInfoModal);

    // Close on Escape
    document.addEventListener("keydown", infoModalKeyHandler);
}

function closeInfoModal() {
    var existing = document.querySelector(".info-modal-backdrop");
    if (existing) existing.remove();
    document.removeEventListener("keydown", infoModalKeyHandler);
}

function infoModalKeyHandler(e) {
    if (e.key === "Escape") {
        e.preventDefault();
        closeInfoModal();
    }
}
