// Guided Tour — lightweight walkthrough with spotlight overlay

const TOUR_STEPS = [
    {
        selector: "#tab-bar",
        title: "Trend vs. Activity",
        text: "Switch between two views. Trend shows whether hospitalizations are increasing or decreasing. Activity shows the overall level of flu activity.",
        position: "bottom"
    },
    {
        selector: ".card-map",
        title: "US Forecast Map",
        text: "The map shows state-level forecasts. Hover over a state to see its full probability distribution. Click a state to jump to its trajectory forecast below. The legend, forecast week, and estimate type are all controlled within this card.",
        position: "right"
    },
    {
        selector: ".horizon-control",
        title: "Forecast Week",
        text: "Select a forecast week. The current week and up to 4 weeks ahead are available. Click any button to change the forecast horizon.",
        position: "right"
    },
    {
        selector: ".estimate-control",
        title: "Estimate Selector",
        text: "Choose between the most likely forecast, or the lower and upper bounds based on the cumulative probability distribution.",
        position: "right"
    },
    {
        selector: ".card-gauges",
        title: "National Summary",
        text: "These gauges summarize the national forecast. The needle position reflects the probability-weighted outlook. The top two most likely categories are shown below each gauge.",
        position: "left"
    },
    {
        selector: "#trajectory-section",
        title: "Trajectory Forecasts",
        text: "Individual forecast trajectories for a selected location. Each colored line is one possible future scenario. Click anywhere on the chart to jump to the nearest reference date.",
        position: "top"
    },
    {
        selector: ".traj-controls",
        title: "Trajectory Controls",
        text: "Change the location, number of visible trajectories, horizon coloring, or toggle historical season curves for context.",
        position: "bottom"
    }
];

// Info text for each card's info button (keyed by data-info attribute)
const INFO_TEXT = {
    map: "The map shows state-level forecasts. Hover over a state to see its probability distribution. Click a state to view its trajectory forecast below. Use the buttons on the left to change the forecast week or estimate type.",
    gauges: "These gauges summarize the national forecast. The needle position reflects the probability-weighted outlook for the US. The top two most likely categories are shown below each gauge with their probabilities.",
    traj: "Individual forecast trajectories for a selected location. Each colored line is one possible future scenario. Click anywhere on the chart to jump to the nearest reference date. Use the controls to change location, trajectory count, horizon coloring, or add historical context."
};

let tourActive = false;
let tourStep = 0;
let tourOverlay = null;
let tourPopup = null;
let tourHighlighted = null;

function startTour() {
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

    if (tourHighlighted) {
        tourHighlighted.classList.remove("tour-spotlight");
        tourHighlighted = null;
    }

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

function goToStep(n) {
    tourStep = n;
    const step = TOUR_STEPS[n];
    const target = document.querySelector(step.selector);
    if (!target) return;

    if (tourHighlighted) {
        tourHighlighted.classList.remove("tour-spotlight");
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(() => {
        target.classList.add("tour-spotlight");
        tourHighlighted = target;

        const rect = target.getBoundingClientRect();
        const pad = 8;
        const r = 6;
        const x1 = rect.left - pad;
        const y1 = rect.top - pad;
        const x2 = rect.right + pad;
        const y2 = rect.bottom + pad;

        tourOverlay.style.clipPath = `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
            ${x1}px ${y1 + r}px,
            ${x1 + r}px ${y1}px,
            ${x2 - r}px ${y1}px,
            ${x2}px ${y1 + r}px,
            ${x2}px ${y2 - r}px,
            ${x2 - r}px ${y2}px,
            ${x1 + r}px ${y2}px,
            ${x1}px ${y2 - r}px,
            ${x1}px ${y1 + r}px
        )`;

        const isLast = n === TOUR_STEPS.length - 1;
        const isFirst = n === 0;

        tourPopup.innerHTML = `
            <button class="tour-close" aria-label="Close tour">&times;</button>
            <div class="tour-step-title">${step.title}</div>
            <div class="tour-step-text">${step.text}</div>
            <div class="tour-nav">
                <span class="tour-counter">${n + 1} of ${TOUR_STEPS.length}</span>
                <div class="tour-arrows">
                    <button class="tour-arrow tour-prev" ${isFirst ? "disabled" : ""} aria-label="Previous">&#8592;</button>
                    <button class="tour-arrow tour-next" aria-label="${isLast ? "Finish" : "Next"}">${isLast ? "Finish &#10003;" : "&#8594;"}</button>
                </div>
            </div>
        `;

        tourPopup.querySelector(".tour-close").addEventListener("click", endTour);
        tourPopup.querySelector(".tour-prev").addEventListener("click", () => {
            if (tourStep > 0) goToStep(tourStep - 1);
        });
        tourPopup.querySelector(".tour-next").addEventListener("click", () => {
            if (tourStep < TOUR_STEPS.length - 1) goToStep(tourStep + 1);
            else endTour();
        });

        positionPopup(rect, step.position);
    }, 350);
}

function positionPopup(targetRect, preferred) {
    const popup = tourPopup;
    const gap = 14;

    popup.style.left = "0px";
    popup.style.top = "0px";
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left, top;

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

// --- Info Buttons ---

function initInfoButtons() {
    document.querySelectorAll(".info-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const key = btn.getAttribute("data-info");
            const text = INFO_TEXT[key];
            if (!text) return;

            const popover = document.getElementById("info-popover");
            const isVisible = popover.classList.contains("visible") &&
                popover.dataset.activeKey === key;

            // Toggle off if same button clicked
            if (isVisible) {
                popover.classList.remove("visible");
                popover.dataset.activeKey = "";
                return;
            }

            popover.textContent = text;
            popover.dataset.activeKey = key;
            popover.classList.add("visible");

            // Position near the button
            const btnRect = btn.getBoundingClientRect();
            let left = btnRect.left - 260;
            let top = btnRect.bottom + 8;

            if (left < 16) left = 16;
            if (top + 120 > window.innerHeight) top = btnRect.top - 120;

            popover.style.left = left + "px";
            popover.style.top = top + "px";
        });
    });

    // Close popover when clicking elsewhere
    document.addEventListener("click", () => {
        document.getElementById("info-popover").classList.remove("visible");
    });
}
