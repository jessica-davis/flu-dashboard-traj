// Main entry point — app state, data loading, initialization

const AppState = {
    currentTab: "trend",
    currentEstimate: "most_likely",
    currentRefDate: null,
    currentHorizon: 1,
    selectedState: "US",
    admissionsRate: "total" // "total" or "percapita"
};

let dashboardData = null;
let locationsData = null;
let topoData = null;

async function init() {
    try {
        const [dd, ld, td] = await Promise.all([
            d3.json("data/dashboard_data.json"),
            d3.json("data/locations.json"),
            d3.json("data/us-states.json")
        ]);

        dashboardData = dd;
        locationsData = ld;
        topoData = td;

        // Auto-detect most recent reference date
        AppState.currentRefDate = dashboardData.most_recent_reference_date;

        // Display last-updated timestamp
        const lastUpdatedEl = document.getElementById("last-updated");
        if (lastUpdatedEl && AppState.currentRefDate) {
            const d = new Date(AppState.currentRefDate + "T00:00:00");
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const formatted = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
            lastUpdatedEl.textContent = `\u00A0\u00A0|\u00A0\u00A0Last Updated: ${formatted}`;
        }

        // Initialize components
        initControls();
        initMap(topoData);
        initLegend();
        initGauges();
        initTrajectoryChart();
        initInfoButtons();

        // Initial render
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

function updateAll() {
    updateMapColors();
    updateGauges();
    updateLegend();
}

// Start the app
init();
