/**
 * CLI Trains - Vanilla JavaScript Controller
 * Core logic for Clock, Refresh Loop, AJAX Fetch, Autocomplete datalist, and Offline Ticket Vault
 */

document.addEventListener('DOMContentLoaded', () => {
  // App Config Constants
  const REFRESH_INTERVAL_SECS = 45;
  let refreshTimer = REFRESH_INTERVAL_SECS;
  let countdownInterval = null;
  let mcvBoardExpanded = false;

  // DOM Elements
  const clockElement = document.getElementById('terminal-clock');
  const timerElement = document.getElementById('refresh-counter');
  
  // Tables
  const rowsManSld = document.getElementById('rows-man-sld');
  const rowsSldMan = document.getElementById('rows-sld-man');
  const rowsSldMcv = document.getElementById('rows-sld-mcv');
  
  // Custom Search
  const searchForm = document.getElementById('search-form');
  const fromInput = document.getElementById('station-from');
  const toInput = document.getElementById('station-to');
  const datalist = document.getElementById('stations-list');
  const customResultsContainer = document.getElementById('custom-results-container');
  const customRouteTitle = document.getElementById('custom-route-title');
  const customCrsDetails = document.getElementById('custom-crs-details');
  const rowsCustomResults = document.getElementById('rows-custom-results');
  const clearSearchBtn = document.getElementById('clear-search-btn');

  // Collapsible Victoria Board
  const toggleMcv = document.getElementById('toggle-mcv');
  const contentMcv = document.getElementById('content-mcv');



  // Alerts
  const tickerContent = document.getElementById('alerts-ticker-content');

  // ----------------------------------------
  // 1. CLOCK LOOP (1-second intervals)
  // ----------------------------------------
  const updateClock = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clockElement.textContent = `[ ${hh}:${mm}:${ss} ]`;
  };
  setInterval(updateClock, 1000);
  updateClock(); // Run immediately

  // ----------------------------------------
  // 2. MASTER AUTO-REFRESH & TIMER LOOP
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
    timerElement.textContent = "REFRESH: NOW";
    timerElement.classList.add('blinking');
    
    // Refresh fixed boards concurrently
    await Promise.all([
      loadTrains('MAN', 'SLD', 4, rowsManSld),
      loadTrains('SLD', 'MAN', 4, rowsSldMan),
      loadAlerts()
    ]);

    // If collapsible SLD->MCV board is active, refresh it too
    if (mcvBoardExpanded) {
      await loadTrains('SLD', 'MCV', 4, rowsSldMcv);
    }

    timerElement.classList.remove('blinking');
    startCountdown();
  };

  // ----------------------------------------
  // 3. SERVICE LOADERS (AJAX FETCH FROM BACKEND)
  // ----------------------------------------
  async function loadTrains(from, to, limit, domContainer) {
    try {
      let url = `/api/trains?from=${from}&limit=${limit}`;
      if (to) {
        url += `&to=${to}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const departures = await response.json();
      renderDepartures(departures, domContainer);
    } catch (error) {
      console.error(`Error loading departures for ${from}->${to || 'ALL'}:`, error);
      domContainer.innerHTML = `<div class="loading-row" style="color:var(--red);">[ERROR: DATABASE CONNECTION TIMEOUT / OFFLINE]</div>`;
    }
  }

  function renderDepartures(departures, domContainer) {
    if (!departures || departures.length === 0) {
      domContainer.innerHTML = `<div class="loading-row">[NOMINAL // NO DEPARTURES SCHEDULED IN NEXT 2 HOURS]</div>`;
      return;
    }

    domContainer.innerHTML = '';

    departures.forEach(item => {
      const row = document.createElement('div');
      row.className = `departure-row ${item.status === 'CANCELLED' ? 'row-cancelled' : ''}`;
      
      // Determine status element class
      let statusClass = 'status-ontime';
      if (item.status.includes('LATE')) {
        statusClass = 'status-late';
      } else if (item.status === 'CANCELLED') {
        statusClass = 'status-cancelled';
      } else if (item.status === 'DEPARTED') {
        statusClass = 'status-departed';
      }

      row.innerHTML = `
        <span class="col-time">${item.scheduled}</span>
        <span class="col-dest">${escapeHtml(item.destination)} <small style="color:var(--text-dim); font-size: 0.75rem;">(${escapeHtml(item.operator)})</small></span>
        <span class="col-plat">${item.platform || '—'}</span>
        <span class="col-status ${statusClass}">${escapeHtml(item.status)}</span>
      `;
      domContainer.appendChild(row);
    });
  }

  // Fetch alerts ticker
  async function loadAlerts() {
    try {
      const response = await fetch('/api/alerts?crs=MAN');
      if (!response.ok) throw new Error("Ticker connection error");
      const data = await response.json();
      
      if (data.alerts && data.alerts.length > 0) {
        tickerContent.textContent = data.alerts.join("   //   ");
      }
    } catch (err) {
      console.error("Ticker fetch failure:", err);
      tickerContent.textContent = "STATION METRO STATUS NOMINAL // CONNECTING TO NETWORK ALERTS DATABASE...";
    }
  }

  // ----------------------------------------
  // 4. AUTOCOMPLETE LIST & STATION SCRAPING
  // ----------------------------------------
  async function populateStations() {
    try {
      const response = await fetch('/stations.json');
      if (!response.ok) throw new Error("Stations list unavailable");
      const stations = await response.json();
      
      datalist.innerHTML = '';
      stations.forEach(st => {
        const option = document.createElement('option');
        option.value = `${st.name} (${st.crs})`;
        datalist.appendChild(option);
      });
      console.log(`Loaded ${stations.length} stations in autocompleter datalist.`);
    } catch (e) {
      console.error("Datalist load failure:", e);
    }
  }

  // ----------------------------------------
  // 5. CUSTOM ROUTE SEARCH LOGIC
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
      alert("ERROR: INVALID ORIGIN STATION format. Please select from the dropdown autocomplete list.");
      return;
    }

    // Set header loading indicator
    rowsCustomResults.innerHTML = `<div class="loading-row">EXECUTING CUSTOM QUERY (FROM: ${fromCrs} TO: ${toCrs || 'ALL'})...</div>`;
    customResultsContainer.classList.remove('hidden');
    
    // Generate route visual title
    const nameFrom = fromVal.replace(/\s*\([A-Z]{3}\)$/, "");
    const nameTo = toVal ? toVal.replace(/\s*\([A-Z]{3}\)$/, "") : "ANY DESTINATION";
    
    customRouteTitle.textContent = `${nameFrom.toUpperCase()} ➜ ${nameTo.toUpperCase()}`;
    customCrsDetails.textContent = `[ ${fromCrs}${toCrs ? ' ➜ ' + toCrs : ''} ]`;

    // Fetch and load
    await loadTrains(fromCrs, toCrs, 4, rowsCustomResults);
  });

  clearSearchBtn.addEventListener('click', () => {
    fromInput.value = '';
    toInput.value = '';
    customResultsContainer.classList.add('hidden');
    rowsCustomResults.innerHTML = '';
  });

  // ----------------------------------------
  // 6. COLLAPSIBLE ACCORDIONS (SLD ➜ MCV)
  // ----------------------------------------
  toggleMcv.addEventListener('click', () => {
    mcvBoardExpanded = !mcvBoardExpanded;
    if (mcvBoardExpanded) {
      toggleMcv.querySelector('.collapse-icon').textContent = '[-]';
      contentMcv.classList.remove('collapsed');
      rowsSldMcv.innerHTML = `<div class="loading-row">CONNECTING TO RTT DATABASE...</div>`;
      loadTrains('SLD', 'MCV', 4, rowsSldMcv);
    } else {
      toggleMcv.querySelector('.collapse-icon').textContent = '[+]';
      contentMcv.classList.add('collapsed');
      rowsSldMcv.innerHTML = '';
    }
  });



  // ----------------------------------------
  // 8. MASTER INITIALIZATION ON PAGE LOAD
  // ----------------------------------------
  const init = async () => {
    await Promise.all([
      triggerFullRefresh(),
      populateStations()
    ]);
    
    // Register PWA service worker if supported
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => console.log('ServiceWorker sandbox initialized.', reg.scope))
          .catch(err => console.warn('ServiceWorker registration deferred.', err));
      });
    }
  };

  // Helper function to escape HTML string
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
