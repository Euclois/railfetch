/**
 * CLI Trains - Vanilla JavaScript Controller
 * Clock, Refresh Loop, Data Fetch, Autocomplete, Departed/Upcoming rendering
 */

document.addEventListener('DOMContentLoaded', () => {
  const REFRESH_INTERVAL_SECS = 45;
  let refreshTimer = REFRESH_INTERVAL_SECS;
  let countdownInterval = null;
  let mcvBoardExpanded = false;

  // DOM Elements
  const clockElement = document.getElementById('terminal-clock');
  const timerElement = document.getElementById('refresh-counter');

  const rowsManSld = document.getElementById('rows-man-sld');
  const rowsSldMan = document.getElementById('rows-sld-man');
  const rowsSldMcv = document.getElementById('rows-sld-mcv');

  const searchForm = document.getElementById('search-form');
  const fromInput = document.getElementById('station-from');
  const toInput = document.getElementById('station-to');
  const datalist = document.getElementById('stations-list');
  const customResultsContainer = document.getElementById('custom-results-container');
  const customRouteTitle = document.getElementById('custom-route-title');
  const customCrsDetails = document.getElementById('custom-crs-details');
  const rowsCustomResults = document.getElementById('rows-custom-results');
  const clearSearchBtn = document.getElementById('clear-search-btn');

  const toggleMcv = document.getElementById('toggle-mcv');
  const contentMcv = document.getElementById('content-mcv');

  const tickerContent = document.getElementById('alerts-ticker-content');

  // ----------------------------------------
  // 1. CLOCK
  // ----------------------------------------
  const updateClock = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clockElement.textContent = `${hh}:${mm}:${ss}`;
  };
  setInterval(updateClock, 1000);
  updateClock();

  // ----------------------------------------
  // 2. REFRESH LOOP
  // ----------------------------------------
  const startCountdown = () => {
    if (countdownInterval) clearInterval(countdownInterval);
    refreshTimer = REFRESH_INTERVAL_SECS;

    countdownInterval = setInterval(() => {
      refreshTimer--;
      timerElement.textContent = `REFRESH: ${refreshTimer}s`;
      if (refreshTimer <= 0) {
        clearInterval(countdownInterval);
        triggerFullRefresh();
      }
    }, 1000);
  };

  const triggerFullRefresh = async () => {
    timerElement.textContent = "REFRESHING";
    await Promise.all([
      loadTrains('MAN', 'SLD', 4, rowsManSld),
      loadTrains('SLD', 'MAN', 4, rowsSldMan),
      loadAlerts()
    ]);
    if (mcvBoardExpanded) {
      await loadTrains('SLD', 'MCV', 4, rowsSldMcv);
    }
    startCountdown();
  };

  // ----------------------------------------
  // 3. DATA FETCH + RENDER
  // ----------------------------------------
  async function loadTrains(from, to, limit, domContainer) {
    try {
      let url = `/api/trains?from=${from}&limit=${limit}`;
      if (to) url += `&to=${to}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      renderBoard(data, domContainer);
    } catch (error) {
      console.error(`Fetch error ${from}->${to || 'ALL'}:`, error);
      domContainer.innerHTML = `<div class="loading-row" style="color:var(--red);">CONNECTION ERROR</div>`;
    }
  }

  function renderBoard(data, domContainer) {
    domContainer.innerHTML = '';

    // If mock / no token configured, show the message
    if (data.isMock) {
      const msg = data.message || 'NO API TOKEN — CONFIGURE RTT_TOKEN FOR LIVE DATA';
      domContainer.innerHTML = `<div class="loading-row">${escapeHtml(msg)}</div>`;
      return;
    }

    const departed = data.departed || [];
    const upcoming = data.upcoming || [];

    // Nothing at all
    if (departed.length === 0 && upcoming.length === 0) {
      domContainer.innerHTML = `<div class="loading-row">NO SCHEDULED DEPARTURES</div>`;
      return;
    }

    // Render departed services (last 2)
    if (departed.length > 0) {
      departed.forEach(item => {
        domContainer.appendChild(createRow(item, true));
      });

      // Thin separator between departed and upcoming
      const sep = document.createElement('div');
      sep.className = 'departed-separator';
      domContainer.appendChild(sep);
    }

    // Render upcoming services (next 4)
    if (upcoming.length > 0) {
      upcoming.forEach(item => {
        domContainer.appendChild(createRow(item, false));
      });
    } else if (departed.length > 0) {
      const noMore = document.createElement('div');
      noMore.className = 'loading-row';
      noMore.textContent = 'NO FURTHER DEPARTURES SCHEDULED';
      domContainer.appendChild(noMore);
    }
  }

  function createRow(item, isDeparted) {
    const row = document.createElement('div');
    let rowClass = 'departure-row';
    if (isDeparted) rowClass += ' row-departed';
    if (item.status === 'CANCELLED') rowClass += ' row-cancelled';
    row.className = rowClass;

    let statusClass = 'status-ontime';
    if (item.status.includes('LATE')) {
      statusClass = 'status-late';
    } else if (item.status === 'CANCELLED') {
      statusClass = 'status-cancelled';
    } else if (item.status.startsWith('DEPARTED')) {
      statusClass = 'status-departed';
    }

    const operatorStr = item.operator ? ` <small class="operator-tag">${escapeHtml(item.operator)}</small>` : '';

    row.innerHTML = `
      <span class="col-time">${item.scheduled}</span>
      <span class="col-dest">${escapeHtml(item.destination)}${operatorStr}</span>
      <span class="col-plat">${item.platform || '—'}</span>
      <span class="col-status ${statusClass}">${escapeHtml(item.status)}</span>
    `;
    return row;
  }

  // ----------------------------------------
  // 4. ALERTS TICKER
  // ----------------------------------------
  async function loadAlerts() {
    try {
      const response = await fetch('/api/alerts?crs=MAN');
      if (!response.ok) throw new Error("Ticker error");
      const data = await response.json();
      if (data.alerts && data.alerts.length > 0) {
        tickerContent.textContent = data.alerts.join("   //   ");
      }
    } catch (err) {
      console.error("Ticker error:", err);
      tickerContent.textContent = "CONNECTING TO NETWORK ALERTS...";
    }
  }

  // ----------------------------------------
  // 5. AUTOCOMPLETE
  // ----------------------------------------
  async function populateStations() {
    try {
      const response = await fetch('/stations.json');
      if (!response.ok) throw new Error("Stations unavailable");
      const stations = await response.json();
      datalist.innerHTML = '';
      stations.forEach(st => {
        const option = document.createElement('option');
        option.value = `${st.name} (${st.crs})`;
        datalist.appendChild(option);
      });
    } catch (e) {
      console.error("Station list error:", e);
    }
  }

  // ----------------------------------------
  // 6. CUSTOM SEARCH
  // ----------------------------------------
  const extractCrs = (val) => {
    if (!val) return null;
    const match = val.match(/\(([A-Z]{3})\)$/);
    return match ? match[1] : null;
  };

  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fromVal = fromInput.value.trim();
    const toVal = toInput.value.trim();
    const fromCrs = extractCrs(fromVal);
    const toCrs = extractCrs(toVal);

    if (!fromCrs) {
      alert("Select a station from the dropdown list.");
      return;
    }

    rowsCustomResults.innerHTML = `<div class="loading-row">SEARCHING...</div>`;
    customResultsContainer.classList.remove('hidden');

    const nameFrom = fromVal.replace(/\s*\([A-Z]{3}\)$/, "");
    const nameTo = toVal ? toVal.replace(/\s*\([A-Z]{3}\)$/, "") : "ANY DESTINATION";
    customRouteTitle.textContent = `${nameFrom.toUpperCase()} ➜ ${nameTo.toUpperCase()}`;
    customCrsDetails.textContent = `${fromCrs}${toCrs ? ' ➜ ' + toCrs : ''}`;

    await loadTrains(fromCrs, toCrs, 4, rowsCustomResults);
  });

  clearSearchBtn.addEventListener('click', () => {
    fromInput.value = '';
    toInput.value = '';
    customResultsContainer.classList.add('hidden');
    rowsCustomResults.innerHTML = '';
  });

  // ----------------------------------------
  // 7. COLLAPSIBLE (SLD ➜ MCV)
  // ----------------------------------------
  toggleMcv.addEventListener('click', () => {
    mcvBoardExpanded = !mcvBoardExpanded;
    if (mcvBoardExpanded) {
      toggleMcv.querySelector('.collapse-icon').textContent = '-';
      contentMcv.classList.remove('collapsed');
      rowsSldMcv.innerHTML = `<div class="loading-row">LOADING...</div>`;
      loadTrains('SLD', 'MCV', 4, rowsSldMcv);
    } else {
      toggleMcv.querySelector('.collapse-icon').textContent = '+';
      contentMcv.classList.add('collapsed');
      rowsSldMcv.innerHTML = '';
    }
  });

  // ----------------------------------------
  // 8. INIT
  // ----------------------------------------
  const init = async () => {
    await Promise.all([triggerFullRefresh(), populateStations()]);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => console.log('SW registered', reg.scope))
          .catch(err => console.warn('SW deferred', err));
      });
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  init();
});
