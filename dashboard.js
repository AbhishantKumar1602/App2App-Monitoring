// ============================================================
// STATE MANAGEMENT
// ============================================================
const state = {
  raw: [],
  filtered: [],
  brandData: [],
  filteredBrandData: [],
  filteredBrandDetails: [],
  vmAdwareData: [],
  filteredVmAdwareData: [],
  vmRackInfo: {},
  // Pre-built lookup indices for O(1) filtering
  indices: {
    byExtName: new Map(),
    byNetwork:  new Map(),
    byType:     new Map(),
    byPub:      new Map(),
    byCoupon:   new Map(),
    byServer:   new Map(),
  },
};

// Chart instances — destroyed & rebuilt on data change
const charts = {
  timeline: null,
  typeChart: null,
  networkBrand: null,
  networkDist: null,
  brandNetwork: null,
  brandViolation: null,
  brandTimeline: null,
  hourChart: null,
  serverChart: null,
  durationChart: null,
};

// Server utilization history for sparkline
const utilHistory = [];

// Normalize server name to standard format
function normalizeServerName(name) {
  if (!name) return name;
  return name.replace(/^s*server/i, "Server");
}

// ── Loading progress bar ──────────────────────────────────────
function setLoadProgress(pct, label) {
  const bar  = document.getElementById("loadProgressBar");
  const wrap = document.getElementById("loadProgressWrap");
  const txt  = document.getElementById("loadProgressText");
  if (!bar || !wrap) return;
  wrap.style.display = pct >= 100 ? "none" : "flex";
  bar.style.width = Math.min(pct, 100) + "%";
  if (txt) txt.textContent = label || "";
}

// ── Index builder (called once after raw data ready) ─────────
function buildIndices(data) {
  const idx = state.indices;
  idx.byExtName.clear(); idx.byNetwork.clear();
  idx.byType.clear(); idx.byPub.clear(); idx.byCoupon.clear(); idx.byServer.clear();

  data.forEach((r, i) => {
    // extensionName
    if (r.extensionName) {
      if (!idx.byExtName.has(r.extensionName)) idx.byExtName.set(r.extensionName, []);
      idx.byExtName.get(r.extensionName).push(i);
    }
    // networks (comma-separated)
    r.networks.split(",").forEach(n => {
      const net = n.trim();
      if (!net) return;
      if (!idx.byNetwork.has(net)) idx.byNetwork.set(net, []);
      idx.byNetwork.get(net).push(i);
    });
    // type
    if (r.type) {
      if (!idx.byType.has(r.type)) idx.byType.set(r.type, []);
      idx.byType.get(r.type).push(i);
    }
    // pubValue
    if (r.pubValue) {
      if (!idx.byPub.has(r.pubValue)) idx.byPub.set(r.pubValue, []);
      idx.byPub.get(r.pubValue).push(i);
    }
    // couponSite
    if (r.couponSite) {
      if (!idx.byCoupon.has(r.couponSite)) idx.byCoupon.set(r.couponSite, []);
      idx.byCoupon.get(r.couponSite).push(i);
    }
    // serverName
    if (r.serverName) {
      const norm = normalizeServerName(r.serverName);
      if (!idx.byServer.has(norm)) idx.byServer.set(norm, []);
      idx.byServer.get(norm).push(i);
    }
  });
}

// ── Set-intersection helper ──────────────────────────────────
function indexLookup(map, key) {
  return map.has(key) ? new Set(map.get(key)) : null; // null means "not found"
}

function intersectSets(a, b) {
  if (a === "ALL") return b;
  if (b === "ALL") return a;
  const result = new Set();
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  small.forEach(v => { if (large.has(v)) result.add(v); });
  return result;
}

// Matrix click-to-filter state
let matrixFilter = { brand: null, network: null };
function esc(val) {
  if (val == null) return "-";
  return String(val)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(str) {
  if (!str) return "-";
  return str.split("T")[0];
}

function normalizeBrand(val) {
  return (val || "Unknown").trim();
}

function setTableMessage(tbodySelector, msg, cols) {
  const tbody = document.querySelector(tbodySelector);
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:#666;padding:24px;">${esc(msg)}</td></tr>`;
}

function fillSelect(selectId, values, allLabel = "All") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentVal = select.value;
  const sorted = [...new Set(values.filter(Boolean))].sort();
  select.innerHTML = `<option value="">${allLabel}</option>`;
  sorted.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    select.appendChild(opt);
  });
  if (currentVal && sorted.includes(currentVal)) select.value = currentVal;
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

// ============================================================
// CHART DEFAULTS
// ============================================================
const PALETTE = ["#667eea","#64ffda","#ff6b6b","#ffd700","#43e97b","#4facfe","#ff9966","#a18fff","#38f9d7","#ff4b5c","#e040fb","#00bcd4"];

function baseOpts(hideScales) {
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#e0e0e0", font: { family: "'Segoe UI', system-ui, sans-serif" } } },
      tooltip: { backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0", borderColor: "#2a2a40", borderWidth: 1 },
    },
  };
  if (!hideScales) {
    opts.scales = {
      x: { ticks: { color: "#b0b0b0" }, grid: { color: "rgba(255,255,255,0.06)" } },
      y: { ticks: { color: "#b0b0b0" }, grid: { color: "rgba(255,255,255,0.06)" } },
    };
  }
  return opts;
}

// ============================================================
// RACK INFO
// ============================================================
function loadRackInfo() {
  return fetch("vm_rack_info.json?t=" + Date.now())
    .then(r => r.json())
    .then(data => { Object.keys(data).forEach(k => { state.vmRackInfo[k.toLowerCase()] = data[k]; }); })
    .catch(err => console.warn("Rack info not available:", err));
}

// ============================================================
// SERVER STATUS (auto-refresh 60s)
// ============================================================
function fetchServerStatus() {
  fetch("https://app2app.io/vptapi/Api/Task/GetRunningVm?VmId=0&TaskMasterId=0")
    .then(r => r.json())
    .then(data => {
      const list = data.data?.vmMasterList || [];
      const renderVm = vm => {
        const name = esc(normalizeServerName(vm.vmName || vm.vmId || "Unknown"));
        const loc = state.vmRackInfo[name.toLowerCase()] || "";
        const locHtml = loc ? `<div style="font-size:13px;font-weight:500;margin-top:3px;color:#0000b3;">${esc(loc)}</div>` : "";
        return `<span class="${vm.vmStatus === 1 ? "busy-server" : "free-server"}">${name}${locHtml}</span>`;
      };
      const busy = list.filter(v => v.vmStatus === 1);
      const free = list.filter(v => v.vmStatus === 0);
      const busyDiv = document.getElementById("busyServerStatus");
      const freeDiv = document.getElementById("freeServerStatus");
      if (busyDiv) busyDiv.innerHTML = busy.length === 0 ? "No busy servers." : busy.map(renderVm).join(" ");
      if (freeDiv) freeDiv.innerHTML = free.length === 0 ? "No free servers." : free.map(renderVm).join(" ");
      const ts = document.getElementById("serverStatusTimestamp");
      if (ts) ts.textContent = "Last updated: " + new Date().toLocaleTimeString();

      // Count labels
      const busyCount = document.getElementById("busyCount");
      const freeCount = document.getElementById("freeCount");
      if (busyCount) busyCount.textContent = `(${busy.length})`;
      if (freeCount) freeCount.textContent = `(${free.length})`;

      // utilization summary removed
    })
    .catch(() => {
      ["busyServerStatus","freeServerStatus"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "Error loading server status.";
      });
    });
}

// ============================================================
// MAIN DATA LOAD
// ============================================================
function sessionDurationMins(start, end) {
  const s = parseDate(start), e = parseDate(end);
  if (!s || !e) return null;
  const diff = (e - s) / 60000;
  return diff > 0 && diff < 1440 ? Math.round(diff) : null;
}

function loadMainData() {
  setTableMessage("#dataTable tbody", "Loading...", 6);
  setLoadProgress(5, "Fetching data…");

  fetch("data.json?t=" + Date.now())
    .then(r => { setLoadProgress(20, "Parsing JSON…"); return r.json(); })
    .then(data => {
      setLoadProgress(35, "Normalising records…");

      // ── Step 1: normalise (sync, fast) ─────────────────────
      const raw = [];
      const validData = data.filter(r => r && typeof r === "object");
      validData.forEach(r => {
        const dur = sessionDurationMins(r.automationStart, r.automationEnd);
        // extract hour for heatmap
        const hourMatch = r.automationStart ? r.automationStart.match(/T(\d{2}):/) : null;
        raw.push({
          extensionId:        r.extensionId        || "",
          extensionName:      r.extensionName      || "",
          keyword:            normalizeBrand(r.keyword),
          networks:           r.networks            || "",
          voilationTypeFLP:   r.voilationTypeFLP    || "",
          automationStart:    r.automationStart     || "",
          automationEnd:      r.automationEnd       || "",
          sessionDurMins:     dur,
          hour:               hourMatch ? parseInt(hourMatch[1], 10) : null,
          incidenceId:        r.incidenceId         || "",
          videoFilePath:      r.videoFilePath       || "",
          networkLogFilePath: r.networkLogFilePath  || "",
          type:               r.type                || "",
          landingUrl:         r.landingUrl          || "",
          finalLandingUrl:    r.finalLandingUrl     || "",
          redirectionURL:     r.redirectionURL      || "",
          redirectionURLFLP:  r.redirectionURLFLP   || "",
          redirectionURL2:    r.redirectionURL2     || "",
          redirectionURL2FLP: r.redirectionURL2FLP  || "",
          brandUrl:           r.brandUrl            || "",
          screenShotPath:     r.screenShotPath      || "",
          landingScreenshot:  r.landingScreenshot   || "",
          couponSite:         r.couponSite          || "",
          pubName:            r.pubName             || "",
          pubValue:           r.pubValue            || "",
          advName:            r.advName             || "",
          advValue:           r.advValue            || "",
          vm:                 r.vm                  || "",
          serverName:         r.serverName          || "",
        });
      });

      // ── Step 2: sort (sync) ─────────────────────────────────
      raw.sort((a, b) => (a.automationStart < b.automationStart ? 1 : a.automationStart > b.automationStart ? -1 : 0));
      state.raw = raw;

      setLoadProgress(55, "Building filter indices…");

      // ── Step 3: indices + selects (yield to browser first) ─
      setTimeout(() => {
        buildIndices(raw);

        // Build select lists from single-pass Maps
        const extNames = [], netNames = [], typeNames = [], pubNames = [], couponNames = [], serverNames = [];
        const extSeen = new Set(), netSeen = new Set(), typeSeen = new Set(), pubSeen = new Set(), couponSeen = new Set(), serverSeen = new Set();
        raw.forEach(d => {
          if (d.extensionName && !extSeen.has(d.extensionName)) { extSeen.add(d.extensionName); extNames.push(d.extensionName); }
          d.networks.split(",").forEach(n => { const t = n.trim(); if (t && !netSeen.has(t)) { netSeen.add(t); netNames.push(t); } });
          if (d.type && !typeSeen.has(d.type)) { typeSeen.add(d.type); typeNames.push(d.type); }
          if (d.pubValue && !pubSeen.has(d.pubValue)) { pubSeen.add(d.pubValue); pubNames.push(d.pubValue); }
          if (d.couponSite && !couponSeen.has(d.couponSite)) { couponSeen.add(d.couponSite); couponNames.push(d.couponSite); }
          if (d.serverName && !serverSeen.has(d.serverName)) { serverSeen.add(d.serverName); serverNames.push(normalizeServerName(d.serverName)); }
        });

        fillSelect("extensionFilter", extNames, "All Extensions");
        fillSelect("networkFilter",   netNames, "All Networks");
        fillSelect("typeFilter",      typeNames, "All Types");
        fillSelect("pubFilter",       pubNames, "All Publishers");
        fillSelect("couponSiteFilter",couponNames, "All Coupon Sites");
        fillSelect("serverFilter",    serverNames, "All Servers");
        initializeDatePickers();

        setLoadProgress(70, "Rendering table…");

        // ── Step 4: render table immediately, charts after ───
        setTimeout(() => {
          applyFilters();
          setLoadProgress(85, "Building charts…");
          setTimeout(() => {
            initializeBrandData(raw);
            
            // Refresh VM matrix if adware data is ready (sync findings data)
            if (state.vmAdwareData && state.vmAdwareData.length > 0) {
              applyVmAdwareFilters();
            }

            setLoadProgress(100, "Done");
          }, 50);
        }, 0);
      }, 0);
    })
    .catch(err => {
      console.error("Error loading data:", err);
      setTableMessage("#dataTable tbody", "Failed to load data.", 6);
      setLoadProgress(100);
    });
}

// ============================================================
// DATE PICKERS
// ============================================================
function initializeDatePickers() {
  const fp = flatpickr("#fromDate", { dateFormat: "Y-m-d", onChange: applyFilters });
  const tp = flatpickr("#toDate", { dateFormat: "Y-m-d", onChange: applyFilters });
  document.getElementById("clearFromDate")?.addEventListener("click", () => { fp.clear(); applyFilters(); });
  document.getElementById("clearToDate")?.addEventListener("click", () => { tp.clear(); applyFilters(); });
  const bfp = flatpickr("#brandFromDate", { dateFormat: "Y-m-d", onChange: applyBrandFilters });
  const btp = flatpickr("#brandToDate", { dateFormat: "Y-m-d", onChange: applyBrandFilters });
  document.getElementById("clearBrandFromDate")?.addEventListener("click", () => { bfp.clear(); applyBrandFilters(); });
  document.getElementById("clearBrandToDate")?.addEventListener("click", () => { btp.clear(); applyBrandFilters(); });
}

// ============================================================
// REPORTS FILTER — indexed, O(1) for select-based filters
// ============================================================
function applyFilters() {
  const ext      = document.getElementById("extensionFilter")?.value  || "";
  const extIdName= (document.getElementById("extensionIdNameBox")?.value || "").trim().toLowerCase();
  const network  = document.getElementById("networkFilter")?.value    || "";
  const typeVal  = document.getElementById("typeFilter")?.value       || "";
  const pubVal   = document.getElementById("pubFilter")?.value        || "";
  const couponVal= document.getElementById("couponSiteFilter")?.value || "";
  const server   = document.getElementById("serverFilter")?.value     || "";
  const from     = document.getElementById("fromDate")?.value         || "";
  const to       = document.getElementById("toDate")?.value           || "";
  const search   = (document.getElementById("searchBox")?.value || "").toLowerCase();

  const idx = state.indices;
  let candidateSet = "ALL"; // "ALL" = no index filter yet

  if (ext)       candidateSet = intersectSets(candidateSet, indexLookup(idx.byExtName, ext)       || new Set());
  if (network)   candidateSet = intersectSets(candidateSet, indexLookup(idx.byNetwork,  network)  || new Set());
  if (typeVal)   candidateSet = intersectSets(candidateSet, indexLookup(idx.byType,     typeVal)  || new Set());
  if (pubVal)    candidateSet = intersectSets(candidateSet, indexLookup(idx.byPub,      pubVal)   || new Set());
  if (couponVal) candidateSet = intersectSets(candidateSet, indexLookup(idx.byCoupon,   couponVal)|| new Set());
  if (server)    candidateSet = intersectSets(candidateSet, indexLookup(idx.byServer,   server)   || new Set());

  let filtered;
  if (candidateSet === "ALL") {
    filtered = state.raw;
  } else {
    filtered = [];
    candidateSet.forEach(i => { if (state.raw[i]) filtered.push(state.raw[i]); });
    filtered.sort((a, b) => (a.automationStart < b.automationStart ? 1 : a.automationStart > b.automationStart ? -1 : 0));
  }

  if (extIdName) filtered = filtered.filter(d =>
    d.extensionName.toLowerCase().includes(extIdName) ||
    d.extensionId.toLowerCase().includes(extIdName));
  if (from) filtered = filtered.filter(d => d.automationStart >= from);
  if (to)   filtered = filtered.filter(d => d.automationStart <= to + "T23:59:59");
  if (search) {
    const s = search;
    filtered = filtered.filter(d =>
      d.keyword.toLowerCase().includes(s) ||
      d.voilationTypeFLP.toLowerCase().includes(s) ||
      d.networks.toLowerCase().includes(s) ||
      String(d.incidenceId).includes(s) ||
      d.extensionName.toLowerCase().includes(s) ||
      d.type.toLowerCase().includes(s) ||
      d.pubValue.toLowerCase().includes(s) ||
      d.couponSite.toLowerCase().includes(s) ||
      d.serverName.toLowerCase().includes(s));
  }

  if (matrixFilter.brand && matrixFilter.network) {
    filtered = filtered.filter(d =>
      d.keyword === matrixFilter.brand &&
      d.networks.split(",").map(n => n.trim()).includes(matrixFilter.network));
  }

  state.filtered = filtered;
  currentPage = 1;
  updateDashboard(filtered);
  requestAnimationFrame(() => renderAnalyticsCharts(filtered));
}

// ============================================================
// DASHBOARD KPIs + TABLE
// ============================================================
function updateDashboard(data) {
  document.getElementById("totalRecords").textContent = data.length;
  document.getElementById("uniqueExtensions").textContent = new Set(data.map(d => d.extensionId)).size;
  document.getElementById("uniqueBrands").textContent = new Set(data.map(d => d.keyword.toLowerCase())).size;
  document.getElementById("latestDate").textContent = data.length ? fmtDate(data[0].automationStart) : "-";

  // KPIs for networks and others
  const networks = new Set(data.flatMap(d => (d.networks || "").split(",").map(n => n.trim()).filter(Boolean)));
  const kpiNets = document.getElementById("kpiActiveNetworksCount");
  if (kpiNets) kpiNets.textContent = networks.size;

  const netCounts = {};
  data.forEach(d => { (d.networks || "").split(",").forEach(n => { const net = n.trim(); if (net) netCounts[net] = (netCounts[net] || 0) + 1; }); });
  const topNet = Object.entries(netCounts).sort((a,b) => b[1] - a[1])[0];
  const kpiTopNet = document.getElementById("kpiTopNetwork");
  if (kpiTopNet) kpiTopNet.textContent = topNet ? `${topNet[0]} (${topNet[1]})` : "—";

  const pubs = new Set(data.map(d => d.pubValue).filter(Boolean));
  const kpiPubs = document.getElementById("kpiUniquePubs");
  if (kpiPubs) kpiPubs.textContent = pubs.size;

  const couponCounts = {};
  data.forEach(d => { if (d.couponSite) { try { const h = new URL(d.couponSite).hostname.replace("www.",""); couponCounts[h] = (couponCounts[h] || 0) + 1; } catch(e) {} } });
  const topCoupon = Object.entries(couponCounts).sort((a,b) => b[1] - a[1])[0];
  const kpiTopCoupon = document.getElementById("kpiTopCoupon");
  if (kpiTopCoupon) kpiTopCoupon.textContent = topCoupon ? `${topCoupon[0]} (${topCoupon[1]})` : "—";

  // Fingerprint suspected (multi-extension publishers)
  const pubToExts = {};
  data.forEach(d => { if (d.pubValue) { if (!pubToExts[d.pubValue]) pubToExts[d.pubValue] = new Set(); pubToExts[d.pubValue].add(d.extensionId); } });
  const suspected = Object.values(pubToExts).filter(s => s.size > 1).length;
  const kpiFinger = document.getElementById("kpiFingerprintSuspect");
  if (kpiFinger) kpiFinger.textContent = suspected;

  // High-risk extension count
  const riskData = computeExtensionRisk(data);
  const maxScore = riskData[0]?.score || 1;
  const highRiskExts = riskData.filter(e => e.score >= maxScore * 0.7);
  const kpiHR = document.getElementById("kpiHighRisk");
  if (kpiHR) kpiHR.textContent = highRiskExts.length;
  const kpiHRSub = document.getElementById("kpiHighRiskSub");
  if (kpiHRSub) kpiHRSub.innerHTML = `<span style="color:rgba(255,255,255,0.7);font-size:11px;">of ${riskData.length} total</span>`;

  // Affiliate swaps count
  const swaps = data.filter(r => r.redirectionURL && r.redirectionURLFLP && r.redirectionURL !== r.redirectionURLFLP);
  const kpiSwap = document.getElementById("kpiSwapCount");
  if (kpiSwap) kpiSwap.textContent = swaps.length;
  const swapPct = data.length > 0 ? ((swaps.length / data.length) * 100).toFixed(1) : 0;
  const kpiSwapPct = document.getElementById("kpiSwapPct");
  if (kpiSwapPct) kpiSwapPct.innerHTML = `<span style="color:rgba(255,255,255,0.7);font-size:11px;">${swapPct}% of records</span>`;

  // Restore week-over-week calculations for anomaly detection
  const now = new Date();
  const thisWeekStart = new Date(now); const dow = now.getDay();
  thisWeekStart.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); thisWeekStart.setHours(0,0,0,0);
  const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);
  let thisWk = 0, lastWk = 0;
  data.forEach(d => {
    const dt = parseDate(d.automationStart);
    if (!dt) return;
    if (dt >= thisWeekStart) thisWk++;
    else if (dt >= lastWeekStart) lastWk++;
  });

  // Anomaly detection — spike if today > 2x 7-day avg
  detectAndShowAnomaly(data, thisWk, lastWk);

  renderReportsTable(data);
}

// ── ANOMALY DETECTION BANNER ───────────────────────────────
function detectAndShowAnomaly(data, thisWk, lastWk) {
  const banner = document.getElementById("anomalyBanner");
  if (!banner) return;
  const alerts = [];

  // Spike: this week > 2x last week
  if (lastWk > 0 && thisWk >= lastWk * 2) {
    alerts.push(`📈 <b>Spike detected:</b> This week has ${thisWk} findings — ${Math.round((thisWk/lastWk)*100)}% of last week (${lastWk}).`);
  }

  // New extensions (first seen within last 7 days)
  const now = new Date();
  const thisWeekStart = new Date(now); const dow = now.getDay();
  thisWeekStart.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); thisWeekStart.setHours(0,0,0,0);
  const extFirstSeen = {};
  data.forEach(d => {
    const dt = parseDate(d.automationStart);
    if (!dt || !d.extensionId) return;
    if (!extFirstSeen[d.extensionId] || dt < extFirstSeen[d.extensionId]) extFirstSeen[d.extensionId] = dt;
  });
  const brandNewExts = Object.entries(extFirstSeen).filter(([,dt]) => dt >= thisWeekStart);
  if (brandNewExts.length > 0) {
    const names = brandNewExts.map(([id]) => {
      const r = data.find(x => x.extensionId === id);
      return r ? r.extensionName : id;
    }).join(", ");
    alerts.push(`🆕 <span title="${esc(names)}" style="cursor:help;border-bottom:1px dotted rgba(255,255,255,0.5);"><b>${brandNewExts.length} new extension(s)</b></span> detected for the first time this week.`);
  }

  // Escalating brands: this wk > 2x last wk
  const brandMap = {};
  data.forEach(d => {
    if (!brandMap[d.keyword]) brandMap[d.keyword] = { thisWk: 0, lastWk: 0 };
    const dt = parseDate(d.automationStart);
    if (!dt) return;
    const lastWeekStart2 = new Date(thisWeekStart); lastWeekStart2.setDate(thisWeekStart.getDate() - 7);
    if (dt >= thisWeekStart) brandMap[d.keyword].thisWk++;
    else if (dt >= lastWeekStart2) brandMap[d.keyword].lastWk++;
  });
  const escalating = Object.entries(brandMap).filter(([,v]) => v.lastWk > 0 && v.thisWk >= v.lastWk * 2).map(([b]) => b);
  if (escalating.length > 0) {
    alerts.push(`⚡ <b>Escalating brands:</b> ${escalating.slice(0,3).map(esc).join(", ")}${escalating.length > 3 ? ` +${escalating.length - 3} more` : ""} doubled in findings this week.`);
  }

  if (alerts.length > 0) {
    banner.innerHTML = alerts.map(a => `<div class="anomaly-item">⚠️ ${a}</div>`).join("");
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

const PAGE_SIZE = 100;
let currentPage = 1;

// ── Builds the evidence button group for a record row ──────
function buildEvidenceBtns(r) {
  const payload = JSON.stringify({
    inc:               r.incidenceId        || "",
    brand:             r.keyword            || "",
    video:             r.videoFilePath       || "",
    log:               r.networkLogFilePath  || "",
    shot:              r.screenShotPath      || "",
    landing:           r.landingScreenshot   || "",
    landingUrl:        r.landingUrl          || "",
    finalLandingUrl:   r.finalLandingUrl     || "",
    brandUrl:          r.brandUrl            || "",
    redirectionURL2:   r.redirectionURL2     || "",
    redirectionURL2FLP:r.redirectionURL2FLP  || "",
    couponSite:        r.couponSite          || "",
    pubName:           r.pubName             || "",
    pubValue:          r.pubValue            || "",
    advName:           r.advName             || "",
    advValue:          r.advValue            || "",
    durMins:           r.sessionDurMins != null ? r.sessionDurMins : "",
    violationType:     r.voilationTypeFLP    || "",
    type:              r.type               || "",
    network:           r.networks            || "",
  });

  const hasAny = r.videoFilePath || r.networkLogFilePath || r.screenShotPath || r.landingScreenshot;
  if (!hasAny) return "";

  const btns = [];
  if (r.screenShotPath || r.landingScreenshot)
    btns.push(`<button class="ev-pill ev-pill-img" onclick='openEvidenceModal(${payload})' title="View Screenshots">📸</button>`);
  if (r.videoFilePath)
    btns.push(`<button class="ev-pill ev-pill-vid" onclick='openEvidenceModal(${payload})' title="Watch Video">🎬</button>`);
  if (r.networkLogFilePath)
    btns.push(`<button class="ev-pill ev-pill-log" onclick='openEvidenceModal(${payload})' title="View SAZ Log">🌐</button>`);

  return `<div class="ev-pills">${btns.join("")}</div>`;
}

function renderReportsTable(data) {
  const tbody = document.querySelector("#dataTable tbody");
  if (!tbody) return;
  if (data.length === 0) {
    setTableMessage("#dataTable tbody", "No records match your filters.", 8);
    renderPagination(0, "#reportsPagination");
    return;
  }
  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = 1;
  const pageData = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  pageData.forEach(r => {
    const tr = document.createElement("tr");
    const evBtns = buildEvidenceBtns(r);

    const iTd = document.createElement("td");
    iTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div>
      <div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>
      ${r.sessionDurMins !== null && r.sessionDurMins !== undefined ? `<div class="dur-badge" style="margin-top:3px;">${r.sessionDurMins}m</div>` : ""}`;
    const eTd = document.createElement("td");
    eTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;
    const bTd = document.createElement("td"); bTd.textContent = r.keyword || "-";
    const vTd = document.createElement("td");
    vTd.innerHTML = `<span>${esc(r.voilationTypeFLP || "-")}</span>
      ${r.type ? `<div style="font-size:11px;color:#888;margin-top:2px;">${esc(r.type)}</div>` : ""}`;
    const nTd = document.createElement("td"); nTd.textContent = r.networks || "-";
    const pTd = document.createElement("td");
    pTd.innerHTML = r.pubValue
      ? `<code class="aff-id-code" style="font-size:11px;">${esc(r.pubValue)}</code>
         ${r.couponSite ? `<div style="font-size:10px;color:#666;margin-top:2px;">via ${esc((() => { try { return new URL(r.couponSite).hostname.replace("www.",""); } catch(e){ return r.couponSite; }})())}</div>` : ""}`
      : "-";
    const evTd = document.createElement("td"); evTd.innerHTML = evBtns || "-";
    tr.append(iTd, eTd, bTd, vTd, nTd, pTd, evTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  renderPagination(data.length, "#reportsPagination");
}

function renderPagination(total, containerId) {
  const container = document.querySelector(containerId);
  if (!container) return;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) {
    container.innerHTML = total > 0 ? `<span class="page-info">Showing ${total} records</span>` : "";
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  container.innerHTML = `
    <span class="page-info">Showing ${start}–${end} of ${total} records</span>
    <div class="page-btns">
      <button class="page-btn" onclick="changePage(-1)" ${currentPage === 1 ? "disabled" : ""}>← Prev</button>
      <span class="page-num">Page ${currentPage} / ${totalPages}</span>
      <button class="page-btn" onclick="changePage(1)" ${currentPage === totalPages ? "disabled" : ""}>Next →</button>
    </div>`;
}

function changePage(dir) {
  const totalPages = Math.ceil(state.filtered.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(totalPages, currentPage + dir));
  renderReportsTable(state.filtered);
}

// ============================================================
// ═══  ANALYTICS CHARTS — Reports Tab  ═══════════════════════
// ============================================================

function renderAnalyticsCharts(data) {
  renderTimelineChart(data);
  renderTypeChart(data);
  renderNetworkDistChart(data);
  // Stagger heavy renders to keep UI responsive
  setTimeout(() => {
    renderExtensionRiskTable(data);
    renderNetworkBrandMatrix(data);
    renderPublisherIntelTable(data);
    renderAffiliateSwapTable(data);
    // New analytics
    renderHourHeatmap(data);
    renderServerDistChart(data);
    renderDurationChart(data);
    renderQuickIntelStats(data);
  }, 0);
}

// ── NEW: Hour-of-Day Activity Heatmap ────────────────────────
function renderHourHeatmap(data) {
  destroyChart("hourChart");
  const ctx = document.getElementById("hourChart");
  if (!ctx) return;

  const counts = new Array(24).fill(0);
  data.forEach(r => { if (r.hour !== null) counts[r.hour]++; });
  const labels = Array.from({length: 24}, (_, i) => `${String(i).padStart(2,"0")}:00`);
  const maxVal = Math.max(...counts, 1);
  const colors = counts.map(v => {
    const t = v / maxVal;
    // dark blue → hot orange
    const r = Math.round(102 + (255 - 102) * t);
    const g = Math.round(126 + (107 - 126) * t);
    const b = Math.round(234 + (107 - 234) * t);
    return `rgba(${r},${g},${b},0.8)`;
  });

  const opts = baseOpts();
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.maxRotation = 45;
  opts.plugins.tooltip = {
    backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0",
    borderColor: "#2a2a40", borderWidth: 1,
    callbacks: { label: c => ` ${c.parsed.y} findings at ${labels[c.parsed.x]}` }
  };

  charts.hourChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Findings",
        data: counts,
        backgroundColor: colors,
        borderRadius: 3,
        borderWidth: 0,
      }]
    },
    options: opts,
  });
}

// ── NEW: Server Distribution Chart ───────────────────────────
function renderServerDistChart(data) {
  destroyChart("serverChart");
  const ctx = document.getElementById("serverChart");
  if (!ctx) return;

  const counts = {};
  data.forEach(r => {
    const s = r.serverName || "Unknown";
    counts[s] = (counts[s] || 0) + 1;
  });
  const sorted = Object.entries(counts)
    .filter(([k]) => k !== "Unknown" || Object.keys(counts).length === 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  if (!sorted.length) return;

  const opts = baseOpts();
  opts.indexAxis = "y";
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.stepSize = 1;

  charts.serverChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: "Findings",
        data: sorted.map(([, v]) => v),
        backgroundColor: PALETTE.slice(0, sorted.length),
        borderRadius: 4,
      }]
    },
    options: opts,
  });
}

// ── NEW: Session Duration Distribution ───────────────────────
function renderDurationChart(data) {
  destroyChart("durationChart");
  const ctx = document.getElementById("durationChart");
  if (!ctx) return;

  const buckets = { "0–5m": 0, "5–15m": 0, "15–30m": 0, "30–60m": 0, "60m+": 0, "N/A": 0 };
  data.forEach(r => {
    const d = r.sessionDurMins;
    if (d === null || d === undefined) { buckets["N/A"]++; return; }
    if (d <= 5)       buckets["0–5m"]++;
    else if (d <= 15) buckets["5–15m"]++;
    else if (d <= 30) buckets["15–30m"]++;
    else if (d <= 60) buckets["30–60m"]++;
    else              buckets["60m+"]++;
  });

  const labels = Object.keys(buckets).filter(k => buckets[k] > 0);
  const values = labels.map(k => buckets[k]);
  const colors = ["#667eea","#64ffda","#ffd700","#ff9966","#ff6b6b","#444"];

  const opts = baseOpts(true);
  opts.cutout = "58%";
  opts.plugins.legend = { position: "right", labels: { color: "#e0e0e0", padding: 12, boxWidth: 12, font: { size: 12 } } };
  opts.plugins.tooltip = {
    backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0",
    borderColor: "#2a2a40", borderWidth: 1,
    callbacks: {
      label: c => {
        const total = c.dataset.data.reduce((s, v) => s + v, 0);
        return ` ${c.label}: ${c.parsed} (${((c.parsed / total) * 100).toFixed(1)}%)`;
      }
    }
  };

  charts.durationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderColor: "#0f0f23", borderWidth: 2 }]
    },
    options: opts,
  });
}

// ── NEW: Quick Intel Stats bar ────────────────────────────────
function renderQuickIntelStats(data) {
  const el = document.getElementById("quickIntelBar");
  if (!el) return;

  if (!data.length) {
    el.innerHTML = `<div class="qi-card" style="grid-column:1/-1;justify-content:center;"><span style="color:#666;font-size:13px;">No data to analyse</span></div>`;
    return;
  }

  // Avg session duration
  const durs = data.map(r => r.sessionDurMins).filter(d => d !== null && d !== undefined);
  const avgDur = durs.length ? (durs.reduce((s, v) => s + v, 0) / durs.length).toFixed(1) : "—";
  const avgDurDisplay = durs.length ? avgDur + "m" : "—";

  // Peak hour
  const hourCounts = new Array(24).fill(0);
  data.forEach(r => { if (r.hour !== null && r.hour !== undefined) hourCounts[r.hour]++; });
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakHourStr = hourCounts[peakHour] > 0 ? `${String(peakHour).padStart(2,"0")}:00` : "—";

  // Top server
  const serverCounts = {};
  data.forEach(r => { if (r.serverName) serverCounts[r.serverName] = (serverCounts[r.serverName] || 0) + 1; });
  const topServerEntry = Object.entries(serverCounts).sort((a, b) => b[1] - a[1])[0];
  const topServer   = topServerEntry ? topServerEntry[0] : "—";
  const topServerCt = topServerEntry ? topServerEntry[1] : 0;

  // Top coupon site
  const couponCounts = {};
  data.forEach(r => {
    if (r.couponSite) {
      try { const h = new URL(r.couponSite).hostname.replace("www.", ""); couponCounts[h] = (couponCounts[h] || 0) + 1; }
      catch(e) {}
    }
  });
  const topCouponEntry = Object.entries(couponCounts).sort((a, b) => b[1] - a[1])[0];
  const topCoupon = topCouponEntry ? topCouponEntry[0] : "—";

  // Cookie stuffing %
  const csCount = data.filter(r => r.voilationTypeFLP && r.voilationTypeFLP.toLowerCase().includes("cookie")).length;
  const csPct = data.length > 0 ? ((csCount / data.length) * 100).toFixed(1) : "0";

  function card(icon, value, label, iconBg) {
    return `<div class="qi-card">
      <div class="qi-icon-wrap" style="background:${iconBg || "rgba(102,126,234,0.12)"};">${icon}</div>
      <div class="qi-body">
        <div class="qi-value" title="${value}">${value}</div>
        <div class="qi-label">${label}</div>
      </div>
    </div>`;
  }

  el.innerHTML =
    card("⏱", avgDurDisplay,   "Avg Session",       "rgba(100,255,218,0.1)") +
    card("🕐", peakHourStr,    "Peak Hour",          "rgba(255,215,0,0.1)") +
    card("🖥️", topServer,      `Top Server (${topServerCt})`, "rgba(79,172,254,0.1)") +
    card("🛍️", topCoupon,      "Top Coupon Site",   "rgba(255,153,102,0.1)") +
    card("🍪", csPct + "%",    "Cookie Stuffing",   "rgba(255,75,92,0.1)");
}


// 1. Findings Over Time — with 7-day rolling avg + cumulative toggle
function renderTimelineChart(data) {
  destroyChart("timeline");
  const ctx = document.getElementById("timelineChart");
  if (!ctx) return;

  const showRolling = document.getElementById("showRollingAvg")?.checked !== false;
  const showCumulative = document.getElementById("showCumulative")?.checked === true;

  const dateCounts = {};
  data.forEach(r => {
    const d = fmtDate(r.automationStart);
    if (d !== "-") dateCounts[d] = (dateCounts[d] || 0) + 1;
  });
  const labels = Object.keys(dateCounts).sort();
  const values = labels.map(l => dateCounts[l]);

  // 7-day rolling average
  const rolling = values.map((_, i) => {
    const window = values.slice(Math.max(0, i - 6), i + 1);
    return +(window.reduce((s, v) => s + v, 0) / window.length).toFixed(1);
  });

  // Cumulative
  let cum = 0;
  const cumulative = values.map(v => (cum += v, cum));

  // Week-over-week subtitle
  const total = values.reduce((s, v) => s + v, 0);
  const recent7 = values.slice(-7).reduce((s, v) => s + v, 0);
  const prev7 = values.slice(-14, -7).reduce((s, v) => s + v, 0);
  const subtitleEl = document.getElementById("timelineSubtitle");
  if (subtitleEl) {
    const changeStr = prev7 > 0 ? ` · last 7d vs prev 7d: ${recent7 > prev7 ? "+" : ""}${recent7 - prev7}` : "";
    subtitleEl.textContent = `${total} total findings · ${labels.length} days${changeStr}`;
  }

  const opts = baseOpts();
  opts.plugins.legend.display = showRolling || showCumulative;
  opts.scales.x.ticks.maxTicksLimit = 14;
  opts.scales.x.ticks.maxRotation = 45;
  if (showCumulative) {
    opts.scales.y1 = { type: "linear", display: true, position: "right", ticks: { color: "#64ffda" }, grid: { drawOnChartArea: false }, title: { display: true, text: "Cumulative", color: "#64ffda" } };
  }

  const datasets = [{
    label: "Daily Findings",
    data: values,
    backgroundColor: "rgba(102,126,234,0.65)",
    borderColor: "#667eea",
    borderWidth: 1,
    borderRadius: 4,
    hoverBackgroundColor: "#64ffda",
    yAxisID: "y",
  }];

  if (showRolling) datasets.push({
    label: "7-day Avg",
    data: rolling,
    type: "line",
    borderColor: "#ffd700",
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.4,
    fill: false,
    yAxisID: "y",
  });

  if (showCumulative) datasets.push({
    label: "Cumulative",
    data: cumulative,
    type: "line",
    borderColor: "#64ffda",
    borderWidth: 1.5,
    borderDash: [4, 4],
    pointRadius: 0,
    tension: 0.4,
    fill: false,
    yAxisID: "y1",
  });

  charts.timeline = new Chart(ctx, { type: "bar", data: { labels, datasets }, options: opts });
}
// 3. Top Networks Chart (Restored)
function renderNetworkDistChart(data) {
  destroyChart("networkDist");
  const ctx = document.getElementById("networkDistChart");
  if (!ctx) return;

  const counts = {};
  data.forEach(r => {
    if (r.networks) r.networks.split(",").forEach(n => {
      const net = n.trim();
      if (net) counts[net] = (counts[net] || 0) + 1;
    });
  });

  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) return;

  const labels = sorted.map(s => s[0]);
  const values = sorted.map(s => s[1]);

  charts.networkDist = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Findings",
        data: values,
        backgroundColor: PALETTE.slice(0, labels.length),
        borderRadius: 4
      }]
    },
    options: {
      ...baseOpts(),
      indexAxis: "y",
      plugins: { legend: { display: false } }
    }
  });
}


// 2. BEP vs OLM Type Chart
function renderTypeChart(data) {
  destroyChart("typeChart");
  const ctx = document.getElementById("typeChart");
  if (!ctx) return;
  const counts = {};
  data.forEach(r => {
    const t = r.type || "Unknown";
    counts[t] = (counts[t] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return;

  // Colour map — BEP gets orange, OLM gets teal, unknown gets grey
  const colorMap = { BEP: "#ff9966", OLM: "#64ffda" };
  const bgColors = sorted.map(([k]) => colorMap[k] || "#667eea");

  charts.typeChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: bgColors, borderColor: "#0f0f23", borderWidth: 2, hoverOffset: 8 }],
    },
    options: {
      ...baseOpts(true),
      cutout: "60%",
      plugins: {
        legend: { position: "right", labels: { color: "#e0e0e0", padding: 14, boxWidth: 14, font: { size: 13 } } },
        tooltip: { backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0", borderColor: "#2a2a40", borderWidth: 1,
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            }
          }
        },
      },
    },
  });
}

// ── Publisher Intelligence Table ─────────────────────────────
function renderPublisherIntelTable(data) {
  const tbody = document.querySelector("#publisherIntelTable tbody");
  if (!tbody) return;
  const pubMap = {};
  data.forEach(r => {
    if (!r.pubValue) return;
    const key = r.pubValue;
    if (!pubMap[key]) pubMap[key] = {
      pubValue: key, pubName: r.pubName,
      extensions: new Set(), brands: new Set(), networks: new Set(),
      couponSites: new Set(), count: 0, swapCount: 0,
    };
    pubMap[key].extensions.add(r.extensionId);
    pubMap[key].brands.add(r.keyword);
    pubMap[key].networks.add(r.networks);
    if (r.couponSite) pubMap[key].couponSites.add(r.couponSite);
    pubMap[key].count++;
    // This pub is in a swap if it's the injected one (pubValue from FLP)
    if (r.redirectionURL2FLP && r.redirectionURL2FLP.includes(r.pubValue)) pubMap[key].swapCount++;
  });

  const sorted = Object.values(pubMap).sort((a,b)=>b.extensions.size - a.extensions.size || b.count - a.count);
  const badge = document.getElementById("pubIntelCount");
  if (badge) badge.textContent = sorted.length;
  const multiExtBadge = document.getElementById("pubIntelMultiExt");
  if (multiExtBadge) multiExtBadge.textContent = sorted.filter(p=>p.extensions.size>1).length;

  if (!sorted.length) { setTableMessage("#publisherIntelTable tbody","No publisher data in current filter.",6); return; }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  sorted.forEach((p, idx) => {
    const isMultiExt = p.extensions.size > 1;
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = `Click to filter to publisher: ${p.pubValue}`;
    tr.addEventListener("click", () => {
      const sel = document.getElementById("pubFilter");
      if (sel) { sel.value = p.pubValue; applyFilters(); }
    });

    const rankTd = document.createElement("td"); rankTd.innerHTML = `<span class="rank-num">#${idx+1}</span>`;
    const idTd = document.createElement("td");
    idTd.innerHTML = `<code class="aff-id-code ${isMultiExt?"aff-suspect":""}">${esc(p.pubValue)}</code>
      ${p.pubName ? `<span style="font-size:11px;color:#666;margin-left:6px;">(${esc(p.pubName)})</span>` : ""}
      ${isMultiExt ? `<span class="fraud-badge">⚠️ Multi-ext</span>` : ""}
      <button class="copy-btn" onclick="event.stopPropagation();copyToClipboard('${p.pubValue.replace(/'/g,"\\'")}',this)" title="Copy">📋</button>`;
    const extTd = document.createElement("td"); extTd.textContent = p.extensions.size;
    const brandTd = document.createElement("td"); brandTd.textContent = p.brands.size;
    const countTd = document.createElement("td");
    countTd.innerHTML = `<span class="badge">${p.count}</span>`;
    const couponTd = document.createElement("td");
    couponTd.innerHTML = [...p.couponSites].slice(0,3).map(s => {
      try { return `<span class="net-tag">${esc(new URL(s).hostname.replace("www.",""))}</span>`; }
      catch(e) { return `<span class="net-tag">${esc(s)}</span>`; }
    }).join(" ") || `<span style="color:#444;">—</span>`;
    tr.append(rankTd, idTd, extTd, brandTd, countTd, couponTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// ── Network × Brand Matrix — upgraded ───────────────────────
function renderNetworkBrandMatrix(data) {
  const wrapper = document.getElementById("networkBrandMatrix");
  if (!wrapper) return;

  const networkSet = new Set();
  const brandCounts = {};
  const netTotals = {};
  data.forEach(r => {
    r.networks.split(",").forEach(n => { const net = n.trim(); if (net) { networkSet.add(net); netTotals[net] = (netTotals[net] || 0) + 1; } });
    brandCounts[r.keyword] = (brandCounts[r.keyword] || 0) + 1;
  });

  // Top 8 networks by total findings
  const networks = Object.entries(netTotals).sort((a,b) => b[1]-a[1]).slice(0, 8).map(([n]) => n);
  // Top 12 brands by total findings, sorted by row total desc
  const topBrands = Object.entries(brandCounts).sort((a,b) => b[1]-a[1]).slice(0, 12).map(([b]) => b);

  if (networks.length === 0 || topBrands.length === 0) {
    wrapper.innerHTML = '<p style="color:#666;padding:16px;">No data available.</p>'; return;
  }

  const matrix = {};
  topBrands.forEach(b => { matrix[b] = {}; networks.forEach(n => { matrix[b][n] = 0; }); });
  data.forEach(r => {
    if (!matrix[r.keyword]) return;
    r.networks.split(",").forEach(n => { const net = n.trim(); if (net && matrix[r.keyword][net] !== undefined) matrix[r.keyword][net]++; });
  });

  // Sort brands by row total descending
  const sortedBrands = topBrands.slice().sort((a, b) => {
    const aTotal = networks.reduce((s, n) => s + matrix[a][n], 0);
    const bTotal = networks.reduce((s, n) => s + matrix[b][n], 0);
    return bTotal - aTotal;
  });

  let maxVal = 0;
  sortedBrands.forEach(b => networks.forEach(n => { if (matrix[b][n] > maxVal) maxVal = matrix[b][n]; }));

  const cellColor = (v) => {
    if (v === 0) return "#0f0f23";
    const intensity = Math.min(v / (maxVal || 1), 1);
    const r = Math.round(102 + (255 - 102) * intensity);
    const g = Math.round(126 + (75 - 126) * intensity);
    const b = Math.round(234 + (92 - 234) * intensity);
    return `rgb(${r},${g},${b})`;
  };
  const textColor = (v) => v === 0 ? "#333" : v / (maxVal || 1) > 0.5 ? "#fff" : "#e0e0e0";

  // Column totals
  const colTotals = {};
  networks.forEach(n => { colTotals[n] = sortedBrands.reduce((s, b) => s + matrix[b][n], 0); });

  let html = '<div class="matrix-scroll"><table class="matrix-table"><thead><tr><th class="matrix-corner">Brand \\ Network</th>';
  networks.forEach(n => { html += `<th class="matrix-net" title="${esc(n)}: ${colTotals[n]} total">${esc(n)}</th>`; });
  html += '<th class="matrix-net">Total</th></tr></thead><tbody>';

  sortedBrands.forEach(b => {
    const rowTotal = networks.reduce((s, n) => s + matrix[b][n], 0);
    html += `<tr><td class="matrix-brand">${esc(b)}</td>`;
    networks.forEach(n => {
      const v = matrix[b][n];
      const isActive = matrixFilter.brand === b && matrixFilter.network === n;
      html += `<td class="matrix-cell${isActive ? " matrix-cell-active" : ""}" style="background:${cellColor(v)};color:${textColor(v)};" title="${esc(b)} × ${esc(n)}: ${v}" onclick="matrixCellClick('${esc(b).replace(/'/g,"\\'")}','${esc(n).replace(/'/g,"\\'")}',${v})">${v > 0 ? v : ""}</td>`;
    });
    html += `<td class="matrix-total">${rowTotal}</td></tr>`;
  });

  // Column totals row
  html += '<tr><td class="matrix-brand" style="color:#64ffda;font-size:12px;">Network Total</td>';
  networks.forEach(n => { html += `<td class="matrix-total" style="background:rgba(100,255,218,0.05);">${colTotals[n]}</td>`; });
  const grandTotal = Object.values(colTotals).reduce((s,v)=>s+v,0);
  html += `<td class="matrix-total" style="color:#ffd700;">${grandTotal}</td></tr>`;
  html += '</tbody></table></div>';
  wrapper.innerHTML = html;
}

function matrixCellClick(brand, network, count) {
  if (count === 0) return;
  const clearBtn = document.getElementById("clearMatrixFilterBtn");
  if (matrixFilter.brand === brand && matrixFilter.network === network) {
    // Toggle off
    matrixFilter = { brand: null, network: null };
    if (clearBtn) clearBtn.style.display = "none";
  } else {
    matrixFilter = { brand, network };
    if (clearBtn) { clearBtn.style.display = ""; clearBtn.textContent = `✕ Clear: ${brand} × ${network}`; }
  }
  applyFilters();
}

document.getElementById("clearMatrixFilterBtn")?.addEventListener("click", () => {
  matrixFilter = { brand: null, network: null };
  document.getElementById("clearMatrixFilterBtn").style.display = "none";
  applyFilters();
});

// ── NEW: Affiliate ID Swap Detector ───────────────────────
function extractAffiliateId(url) {
  if (!url) return null;
  // Try ranSiteID (Rakuten/CJ pattern)
  const ranMatch = url.match(/ranSiteID=([^&]+)/i) || url.match(/ransiteid=([^&]+)/i);
  if (ranMatch) return ranMatch[1];
  // Try generic affiliate ID params
  const patterns = [/[?&]affiliateid=([^&]+)/i, /[?&]aff_id=([^&]+)/i, /[?&]affiliate_id=([^&]+)/i, /[?&]pid=([^&]+)/i, /[?&]subid=([^&]+)/i, /[?&]clickref=([^&]+)/i];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function extractAffiliateParam(url, param) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get(param);
  } catch (e) {
    console.warn("Invalid URL:", url);
    return null;
  }
}

function renderAffiliateSwapTable(data) {
  const tbody = document.querySelector("#affiliateSwapTable tbody");
  if (!tbody) return;

  // Use pubValue (ground truth from API) for detection — much more reliable than regex
  // A swap is confirmed when pubValue (orig publisher) != what's injected in redirectionURL2FLP
  const swaps = data.filter(r => {
    if (!r.redirectionURL2 || !r.redirectionURL2FLP) return false;
    return r.redirectionURL2 !== r.redirectionURL2FLP;
  }).sort((a,b) => {
    const aReal = a.pubValue && a.redirectionURL2FLP && !a.redirectionURL2FLP.includes(a.pubValue) ? 1 : 0;
    const bReal = b.pubValue && b.redirectionURL2FLP && !b.redirectionURL2FLP.includes(b.pubValue) ? 1 : 0;
    if (bReal !== aReal) return bReal - aReal;
    return (parseDate(b.automationStart)||0) - (parseDate(a.automationStart)||0);
  });

  const pct = data.length > 0 ? ((swaps.length / data.length) * 100).toFixed(1) : 0;
  const swapPctBadge = document.getElementById("swapPctBadge");
  const swapPctValue = document.getElementById("swapPctValue");
  if (swapPctBadge) swapPctBadge.style.display = swaps.length > 0 ? "" : "none";
  if (swapPctValue) swapPctValue.textContent = `${pct}%`;

  if (swaps.length === 0) {
    setTableMessage("#affiliateSwapTable tbody", "No affiliate swap evidence found in current filter.", 7);
    const badge = document.getElementById("swapCount"); if (badge) badge.textContent = 0;
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  swaps.forEach(r => {
    const origPub = r.pubValue || "—";
    // Extract the publisher ID injected in redirectionURL2FLP by looking at the id= param (LinkShare pattern)
    let injPub = "—";
    try {
      const u = new URL(r.redirectionURL2FLP);
      injPub = u.searchParams.get("id") || u.searchParams.get(r.pubName) || "—";
    } catch(e) {}
    const isRealSwap = origPub !== "—" && injPub !== "—" && origPub.toLowerCase() !== injPub.toLowerCase();
    const tr = document.createElement("tr");

    const incTd = document.createElement("td");
    incTd.innerHTML = `<b>${esc(r.incidenceId||"-")}</b><div style="font-size:11px;color:#666;">${esc(fmtDate(r.automationStart))}</div>`;
    const extTd = document.createElement("td");
    extTd.innerHTML = `${esc(r.extensionName)}<br><span style="font-size:11px;color:#555;">${esc(r.extensionId)}</span>`;
    const brandTd = document.createElement("td"); brandTd.textContent = r.keyword;
    const netTd = document.createElement("td"); netTd.textContent = r.networks;

    // Original publisher (from pubValue field — ground truth)
    const origTd = document.createElement("td");
    origTd.innerHTML = `
      <code class="swap-id">${esc(origPub)}</code>
      <button class="copy-btn" onclick="copyToClipboard('${esc(origPub).replace(/'/g,"\\'")}',this)" title="Copy">📋</button>
      <div style="font-size:10px;color:#666;margin-top:3px;" title="${esc(r.redirectionURL2)}">↗ ${esc(r.redirectionURL2?.substring(0,60))}…</div>`;

    // Injected publisher (from redirectionURL2FLP)
    const injTd = document.createElement("td");
    if (isRealSwap) {
      injTd.innerHTML = `
        <code class="swap-id injected">${esc(injPub)}</code>
        <button class="copy-btn" onclick="copyToClipboard('${esc(injPub).replace(/'/g,"\\'")}',this)" title="Copy">📋</button>
        <div style="font-size:10px;color:#666;margin-top:3px;" title="${esc(r.redirectionURL2FLP)}">↗ ${esc(r.redirectionURL2FLP?.substring(0,60))}…</div>`;
    } else {
      injTd.innerHTML = `<span style="color:#666;font-size:12px;">Same publisher — params differ</span>
        <div style="font-size:10px;color:#444;margin-top:3px;" title="${esc(r.redirectionURL2FLP)}">↗ ${esc(r.redirectionURL2FLP?.substring(0,60))}…</div>`;
    }

    const durTd = document.createElement("td");
    durTd.innerHTML = r.sessionDurMins !== null && r.sessionDurMins !== undefined
      ? `<span class="dur-badge">${r.sessionDurMins}m</span>` : "-";

    tr.append(incTd, extTd, brandTd, netTd, origTd, injTd, durTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  const badge = document.getElementById("swapCount");
  if (badge) badge.textContent = swaps.length;
}

function copyToClipboard(text, btn) {
  navigator.clipboard?.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✅";
    btn.style.color = "#43e97b";
    setTimeout(() => { btn.textContent = orig; btn.style.color = ""; }, 1500);
  }).catch(() => {});
}

// ============================================================
// ═══  UNIFIED EVIDENCE VIEWER MODAL  ════════════════════════
// ============================================================

// params: all fields from buildEvidenceBtns payload
function openEvidenceModal(params) {
  const modal  = document.getElementById("evidenceModal");
  const meta   = document.getElementById("evMeta");
  const urlBar = document.getElementById("evUrls");
  const tabBar = document.getElementById("evTabBar");
  const panels = document.getElementById("evPanels");
  if (!modal) return;

  // ── Meta header ───────────────────────────────────────────
  meta.innerHTML = `
    <span class="ev-brand">${esc(params.brand || "—")}</span>
    <span class="ev-sep">·</span>
    <span class="ev-inc">Incident <b>${esc(params.inc || "—")}</b></span>
    ${params.violationType ? `<span class="ev-vtype ev-vtype-${(params.violationType||"").toLowerCase().replace(/\s+/g,"-")}">${esc(params.violationType)}</span>` : ""}
    ${params.type ? `<span class="ev-type-badge">${esc(params.type)}</span>` : ""}
    ${params.durMins !== "" && params.durMins !== undefined ? `<span class="dur-badge">⏱ ${params.durMins}m session</span>` : ""}`;

  // ── URL chain section ─────────────────────────────────────
  const urlRows = [
    { label: "Landing URL",        val: params.landingUrl },
    { label: "Final Landing URL",  val: params.finalLandingUrl },
    { label: "Redirect URL 2",     val: params.redirectionURL2 },
    { label: "Redirect URL 2 FLP", val: params.redirectionURL2FLP },
  ].filter(u => u.val);

  if (urlRows.length > 0) {
    urlBar.style.display = "";
    urlBar.innerHTML = urlRows.map(u =>
      `<div class="ev-url-row">
        <span class="ev-url-label">${u.icon||"🔗"} ${esc(u.label)}</span>
        <a class="ev-url-val" href="${esc(u.val)}" target="_blank" rel="noopener" title="${esc(u.val)}">${esc(u.val)}</a>
        <button class="copy-btn" onclick="copyToClipboard('${u.val.replace(/'/g,"\\'")}',this)" title="Copy">📋</button>
      </div>`).join("");
  } else {
    urlBar.style.display = "none";
    urlBar.innerHTML = "";
  }

  // ── Build tabs ────────────────────────────────────────────
  const tabs = [];
  if (params.shot || params.landing)  tabs.push({ id: "screenshots", icon: "📸", label: "Screenshots" });
  if (params.video)                   tabs.push({ id: "video",       icon: "🎬", label: "Video" });
  if (params.log)                     tabs.push({ id: "sazlog",      icon: "🌐", label: "SAZ Log" });
  if (tabs.length === 0)              tabs.push({ id: "nodata",      icon: "⚠️", label: "No Evidence" });

  tabBar.innerHTML = tabs.map((t, i) =>
    `<button class="ev-tab${i === 0 ? " ev-tab-active" : ""}" onclick="switchEvTab('${t.id}',this)">${t.icon} ${t.label}</button>`
  ).join("");

  // ── Build panels ──────────────────────────────────────────
  panels.innerHTML = "";

  tabs.forEach((t, i) => {
    const panel = document.createElement("div");
    panel.className = "ev-panel" + (i === 0 ? " ev-panel-active" : "");
    panel.dataset.tab = t.id;

    if (t.id === "screenshots") {
      panel.innerHTML = buildScreenshotPanel(params.shot, params.landing);
    } else if (t.id === "video") {
      panel.innerHTML = buildVideoPanel(params.video);
    } else if (t.id === "sazlog") {
      panel.innerHTML = buildSazPanel(params.log);
    } else {
      panel.innerHTML = `<div class="ev-empty">No evidence files attached to this record.</div>`;
    }
    panels.appendChild(panel);
  });

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function buildScreenshotPanel(shot, landing) {
  let html = '<div class="ev-screenshot-grid">';
  if (shot) {
    html += `<div class="ev-img-wrap">
      <div class="ev-img-label">📸 Screenshot</div>
      <img src="${esc(shot)}" class="ev-img" alt="Screenshot" loading="lazy"
           onclick="window.open('${esc(shot)}','_blank')"
           onerror="this.parentNode.innerHTML='<div class=ev-img-err>Image unavailable</div>'">
    </div>`;
  }
  if (landing) {
    html += `<div class="ev-img-wrap">
      <div class="ev-img-label">🏠 Landing Screenshot</div>
      <img src="${esc(landing)}" class="ev-img" alt="Landing Screenshot" loading="lazy"
           onclick="window.open('${esc(landing)}','_blank')"
           onerror="this.parentNode.innerHTML='<div class=ev-img-err>Image unavailable</div>'">
    </div>`;
  }
  if (!shot && !landing) html += `<div class="ev-empty">No screenshots available.</div>`;
  html += "</div>";
  return html;
}

function buildVideoPanel(videoUrl) {
  // Determine if direct video file or external link
  const isDirectVideo = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(videoUrl);
  if (isDirectVideo) {
    return `
      <div class="ev-video-wrap">
        <video class="ev-video" controls autoplay preload="metadata" controlsList="nodownload">
          <source src="${esc(videoUrl)}" type="video/mp4">
          <source src="${esc(videoUrl)}" type="video/webm">
          Your browser does not support the video tag.
        </video>
        <div class="ev-video-actions">
          <a href="${esc(videoUrl)}" target="_blank" rel="noopener" class="ev-action-btn">↗ Open in new tab</a>
          <a href="${esc(videoUrl)}" download class="ev-action-btn">⬇ Download</a>
        </div>
      </div>`;
  } else {
    // Non-direct URL (e.g. a stream or external viewer)
    return `
      <div class="ev-video-wrap">
        <div class="ev-video-external">
          <div style="font-size:48px;margin-bottom:16px;">🎬</div>
          <p style="color:#b0b0b0;margin-bottom:20px;">This video is hosted externally and cannot be embedded directly.</p>
          <a href="${esc(videoUrl)}" target="_blank" rel="noopener" class="ev-action-btn ev-action-btn-primary">↗ Open Video</a>
        </div>
      </div>`;
  }
}

function buildSazPanel(logUrl) {
  // The SAZ viewer is already a web app — embed it in an iframe
  const viewerUrl = logUrl.startsWith("http") ? `https://app2app.io/sazviewer/?url=${encodeURIComponent(logUrl)}` : logUrl;
  return `
    <div class="ev-saz-wrap">
      <div class="ev-saz-toolbar">
        <span style="color:#64ffda;font-size:13px;font-weight:600;">🌐 SAZ Network Log</span>
        <div style="display:flex;gap:8px;">
          <button class="copy-btn ev-action-btn" onclick="copyToClipboard('${esc(logUrl).replace(/'/g,"\\'")}',this)" style="font-size:12px;">📋 Copy URL</button>
          <a href="${esc(viewerUrl)}" target="_blank" rel="noopener" class="ev-action-btn">↗ Open in new tab</a>
        </div>
      </div>
      <iframe
        src="${esc(viewerUrl)}"
        class="ev-saz-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy"
        title="SAZ Log Viewer">
      </iframe>
      <div class="ev-saz-fallback" id="sazFallback" style="display:none;">
        <p style="color:#b0b0b0;margin-bottom:16px;">If the viewer doesn't load, open it directly:</p>
        <a href="${esc(viewerUrl)}" target="_blank" rel="noopener" class="ev-action-btn ev-action-btn-primary">↗ Open SAZ Viewer</a>
      </div>
    </div>`;
}

function switchEvTab(tabId, btn) {
  document.querySelectorAll(".ev-tab").forEach(t => t.classList.remove("ev-tab-active"));
  document.querySelectorAll(".ev-panel").forEach(p => p.classList.remove("ev-panel-active"));
  if (btn) btn.classList.add("ev-tab-active");
  const panel = document.querySelector(`.ev-panel[data-tab="${tabId}"]`);
  if (panel) panel.classList.add("ev-panel-active");
}

function closeEvidenceModal(e) {
  if (e && e.target !== document.getElementById("evidenceModal")) return;
  _stopEvidenceMedia();
  document.getElementById("evidenceModal").style.display = "none";
  document.body.style.overflow = "";
}

function _stopEvidenceMedia() {
  // Stop any playing video to prevent audio continuing in background
  document.querySelectorAll("#evidenceModal video").forEach(v => { v.pause(); v.currentTime = 0; });
  // Clear iframes to stop network log from loading
  document.querySelectorAll("#evidenceModal iframe").forEach(f => { f.src = "about:blank"; });
}

// Keyboard support — Escape closes modal
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const modal = document.getElementById("evidenceModal");
    if (modal && modal.style.display !== "none") {
      _stopEvidenceMedia();
      modal.style.display = "none";
      document.body.style.overflow = "";
    }
  }
});

// Keep backward compat for openLightbox calls from gallery thumbs
function openLightbox(params) {
  openEvidenceModal({
    inc: params.inc,
    brand: params.brand,
    shot: params.shot,
    landing: params.landing,
  });
}
function closeLightbox(e) { closeEvidenceModal(e); }

// ── NEW: Affiliate Fingerprint (injected ID clusters) ─────
// 4. Extension Risk Score

// 4. Extension Risk Score
const VIOLATION_WEIGHTS = { "critical": 5, "high": 4, "medium": 3, "low": 2 };
function getViolationWeight(v) {
  const lv = (v || "").toLowerCase();
  for (const [k, w] of Object.entries(VIOLATION_WEIGHTS)) { if (lv.includes(k)) return w; }
  return 2;
}

function computeExtensionRisk(data) {
  const extMap = {};
  data.forEach(r => {
    const id = r.extensionId || "Unknown";
    if (!extMap[id]) extMap[id] = { id, name: r.extensionName || id, brands: new Set(), violations: [], networks: new Set(), findings: 0 };
    extMap[id].brands.add(r.keyword.toLowerCase());
    extMap[id].violations.push(r.voilationTypeFLP);
    extMap[id].networks.add(r.networks);
    extMap[id].findings++;
  });
  return Object.values(extMap).map(ext => {
    const avgWeight = ext.violations.reduce((s, v) => s + getViolationWeight(v), 0) / (ext.violations.length || 1);
    const score = Math.round(ext.brands.size * avgWeight * Math.log1p(ext.findings));
    return { ...ext, uniqueBrands: ext.brands.size, uniqueNetworks: ext.networks.size, score };
  }).sort((a, b) => b.score - a.score);
}

function renderExtensionRiskTable(data) {
  const tbody = document.querySelector("#extensionRiskTable tbody");
  if (!tbody) return;
  const riskData = computeExtensionRisk(data).slice(0, 20);
  if (riskData.length === 0) { setTableMessage("#extensionRiskTable tbody", "No data available.", 6); return; }
  const maxScore = riskData[0].score || 1;
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  riskData.forEach((ext, idx) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = `Click to filter records to ${ext.name}`;
    tr.addEventListener("click", () => {
      const box = document.getElementById("extensionIdNameBox");
      if (box) { box.value = ext.id; applyFilters(); }
      // scroll to records table
      document.getElementById("dataTable")?.scrollIntoView({ behavior: "smooth" });
    });
    const lvl = ext.score >= maxScore * 0.7 ? "risk-high" : ext.score >= maxScore * 0.35 ? "risk-med" : "risk-low";
    const lbl = ext.score >= maxScore * 0.7 ? "HIGH" : ext.score >= maxScore * 0.35 ? "MED" : "LOW";
    const pct = Math.round((ext.score / maxScore) * 100);
    const avgW = (ext.violations.reduce((s, v) => s + getViolationWeight(v), 0) / (ext.violations.length || 1)).toFixed(2);
    const formula = `Score = ${ext.uniqueBrands} brands × ${avgW} avg weight × log(${ext.findings} findings) = ${ext.score}`;
    const rankTd = document.createElement("td"); rankTd.innerHTML = `<span class="rank-num">#${idx + 1}</span>`;
    const nameTd = document.createElement("td"); nameTd.innerHTML = `<b>${esc(ext.name)}</b><br><span style="font-size:11px;color:#666;">${esc(ext.id)}</span>`;
    const fTd = document.createElement("td"); fTd.textContent = ext.findings;
    const bTd = document.createElement("td"); bTd.textContent = ext.uniqueBrands;
    const nTd = document.createElement("td"); nTd.textContent = ext.uniqueNetworks;
    const sTd = document.createElement("td");
    sTd.title = formula;
    sTd.innerHTML = `
      <div class="risk-score-wrap">
        <span class="risk-badge ${lvl}">${lbl}</span>
        <div class="risk-bar-bg"><div class="risk-bar-fill ${lvl}" style="width:${pct}%"></div></div>
        <span class="risk-num">${ext.score}</span>
      </div>`;
    tr.append(rankTd, nameTd, fTd, bTd, nTd, sTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// ============================================================
// ═══  BRAND MANAGEMENT + TREND INDICATORS  ══════════════════
// ============================================================

function getWeekBucket(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

function computeTrend(findings) {
  const now = new Date();
  const thisWeekStart = new Date(now);
  const dow = now.getDay();
  thisWeekStart.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  thisWeekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);
  let thisWeek = 0, lastWeek = 0;
  findings.forEach(f => {
    const d = parseDate(f.automationStart);
    if (!d) return;
    if (d >= thisWeekStart) thisWeek++;
    else if (d >= lastWeekStart) lastWeek++;
  });
  return { thisWeek, lastWeek, diff: thisWeek - lastWeek };
}

function trendArrow(trend) {
  if (trend.diff > 0) return `<span class="trend-up">↑ +${trend.diff}</span>`;
  if (trend.diff < 0) return `<span class="trend-down">↓ ${trend.diff}</span>`;
  return `<span class="trend-flat">→ 0</span>`;
}

function computeFirstSeen(findings) {
  let earliest = null;
  findings.forEach(f => { const d = parseDate(f.automationStart); if (d && (!earliest || d < earliest)) earliest = d; });
  return earliest ? earliest.toISOString().split("T")[0] : "-";
}

function initializeBrandData(data) {
  const brandMap = {};
  data.forEach(record => {
    const brandKey = record.keyword.toLowerCase();
    const brandDisplay = record.keyword;
    if (!brandMap[brandKey]) brandMap[brandKey] = { brand: brandDisplay, brandKey, findings: [], extensionIds: new Set(), latestDate: record.automationStart };
    brandMap[brandKey].findings.push(record);
    brandMap[brandKey].extensionIds.add(record.extensionId);
    const recDate = parseDate(record.automationStart);
    const curDate = parseDate(brandMap[brandKey].latestDate);
    if (recDate && curDate && recDate > curDate) brandMap[brandKey].latestDate = record.automationStart;
  });
  state.brandData = Object.values(brandMap).map(item => ({
    brand: item.brand, brandKey: item.brandKey,
    totalFindings: item.findings.length,
    uniqueExtensions: item.extensionIds.size,
    latestDate: item.latestDate,
    firstSeen: computeFirstSeen(item.findings),
    trend: computeTrend(item.findings),
    findings: item.findings,
  })).sort((a, b) => b.totalFindings - a.totalFindings);

  updateBrandKPIs(state.brandData);
  updateBrandSummaryTable(state.brandData);
  renderTopBrandsChart(state.brandData);
}

function applyBrandFilters() {
  const from = document.getElementById("brandFromDate")?.value || "";
  const to = document.getElementById("brandToDate")?.value || "";
  const search = (document.getElementById("brandSearchBox")?.value || "").toLowerCase();

  let filtered = state.brandData.map(item => {
    let vf = item.findings;
    if (from) vf = vf.filter(f => f.automationStart >= from);
    if (to) vf = vf.filter(f => f.automationStart <= to + "T23:59:59");
    const latestDate = vf.length ? vf.reduce((max, f) => (parseDate(f.automationStart) || 0) > (parseDate(max) || 0) ? f.automationStart : max, "") : "";
    return { ...item, findings: vf, totalFindings: vf.length, uniqueExtensions: new Set(vf.map(f => f.extensionId)).size, latestDate, firstSeen: computeFirstSeen(vf), trend: computeTrend(vf) };
  }).filter(item => item.totalFindings > 0);

  if (search) filtered = filtered.filter(item => item.brand.toLowerCase().includes(search));
  filtered.sort((a, b) => b.totalFindings - a.totalFindings);
  state.filteredBrandData = filtered;
  updateBrandSummaryTable(filtered);
  updateBrandKPIs(filtered);
  renderTopBrandsChart(filtered);
}

function updateBrandKPIs(data) {
  document.getElementById("totalBrands").textContent = data.length;
  const total = data.reduce((s, i) => s + i.totalFindings, 0);
  document.getElementById("totalBrandFindings").textContent = total;
  document.getElementById("avgFindingsPerBrand").textContent = data.length > 0 ? (total / data.length).toFixed(1) : "0";
  const chronic = data.filter(b => {
    const first = parseDate(b.firstSeen); const last = parseDate(b.latestDate);
    return first && last && (last - first) >= 14 * 24 * 60 * 60 * 1000;
  });
  const el = document.getElementById("chronicBrands");
  if (el) el.textContent = chronic.length;
}

function updateBrandSummaryTable(data) {
  state.filteredBrandData = data;
  const tbody = document.querySelector("#brandTable tbody");
  if (!tbody) return;
  document.getElementById("brandTableSubtitle").textContent = `Showing ${data.length} brands`;
  if (data.length === 0) { setTableMessage("#brandTable tbody", "No brands match your filters.", 6); return; }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  data.forEach(item => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showBrandDetails(item));
    const isNew = item.firstSeen !== "-" && (new Date() - parseDate(item.firstSeen)) < 7 * 24 * 60 * 60 * 1000;
    const newBadge = isNew ? `<span class="new-badge">NEW</span>` : "";
    const weeks = new Set(item.findings.map(f => getWeekBucket(f.automationStart)).filter(Boolean));
    const repeatFlag = weeks.size >= 3 ? `<span class="repeat-badge">🔁 Repeat</span>` : "";

    const bTd = document.createElement("td"); bTd.innerHTML = `<b>${esc(item.brand)}</b> ${newBadge}`;
    const fTd = document.createElement("td"); fTd.innerHTML = `<span class="badge">${item.totalFindings}</span>`;
    const eTd = document.createElement("td"); eTd.textContent = item.uniqueExtensions;
    const tTd = document.createElement("td");
    tTd.innerHTML = trendArrow(item.trend) + `<span style="font-size:11px;color:#555;margin-left:6px;">this wk: ${item.trend.thisWeek}</span>`;
    const dTd = document.createElement("td");
    dTd.innerHTML = `<div>${esc(fmtDate(item.latestDate))}</div><div style="font-size:11px;color:#555;">since ${esc(item.firstSeen)}</div>`;
    const rTd = document.createElement("td"); rTd.innerHTML = repeatFlag || `<span style="color:#444;font-size:12px;">—</span>`;
    tr.append(bTd, fTd, eTd, tTd, dTd, rTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// Top 15 Brands Chart (Removed)
function renderTopBrandsChart(data) {
  return;
}

// Brand Detail — show/close
function showBrandDetails(brandItem) {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");
  const summaryChart = document.getElementById("topBrandsChartSection");
  if (detailSection) { detailSection.style.display = "block"; detailSection.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (summaryTable) summaryTable.style.display = "none";
  if (summaryChart) summaryChart.style.display = "none";
  updateBrandDetailsTable(brandItem.brand, brandItem.findings, brandItem);
  renderBrandNetworkMiniChart(brandItem.findings, brandItem.brand);
  renderBrandViolationChart(brandItem.findings, brandItem.brand);
  renderBrandTimeline(brandItem.findings);
  renderBrandScreenshots(brandItem.findings);
}

function closeBrandDetails() {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");
  const summaryChart = document.getElementById("topBrandsChartSection");
  if (detailSection) detailSection.style.display = "none";
  if (summaryTable) summaryTable.style.display = "";
  if (summaryChart) summaryChart.style.display = "";
}

function updateBrandDetailsTable(brandName, findings, brandItem) {
  state.filteredBrandDetails = findings;
  const tbody = document.querySelector("#brandDetailsTable tbody");
  if (!tbody) return;
  const uniqueExts = new Set(findings.map(f => f.extensionId)).size;
  const infoEl = document.getElementById("brandDetailInfo");
  if (infoEl) infoEl.textContent = `${brandName}: ${findings.length} findings across ${uniqueExts} extension(s)`;

  // Escalation banner
  const escBanner = document.getElementById("brandEscalationBanner");
  if (escBanner && brandItem) {
    const { thisWeek, lastWeek } = brandItem.trend;
    if (lastWeek > 0 && thisWeek >= lastWeek * 2) {
      escBanner.style.display = "block";
      escBanner.innerHTML = `<span class="anomaly-item" style="font-size:13px;">⚡ <b>Escalating:</b> This week has ${thisWeek} findings vs ${lastWeek} last week (${Math.round(thisWeek/lastWeek*100)}% increase). Investigate urgently.</span>`;
    } else { escBanner.style.display = "none"; }
  }

  if (findings.length === 0) { setTableMessage("#brandDetailsTable tbody", "No findings found.", 5); return; }
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  findings.forEach(r => {
    const tr = document.createElement("tr");
    const evBtns = buildEvidenceBtns(r);
    const iTd = document.createElement("td"); iTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div><div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>`;
    const eTd = document.createElement("td"); eTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;
    const vTd = document.createElement("td"); vTd.textContent = r.voilationTypeFLP || "-";
    const nTd = document.createElement("td"); nTd.textContent = r.networks || "-";
    const evTd = document.createElement("td"); evTd.innerHTML = evBtns || "-";
    tr.append(iTd, eTd, vTd, nTd, evTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// Brand detail — network mini donut
function renderBrandNetworkMiniChart(findings, brandName) {
  destroyChart("brandNetwork");
  const ctx = document.getElementById("brandNetworkChart");
  if (!ctx) return;
  const counts = {};
  findings.forEach(f => {
    if (f.networks) f.networks.split(",").forEach(n => { const net = n.trim(); if (net) counts[net] = (counts[net] || 0) + 1; });
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sorted.length === 0) return;
  charts.brandNetwork = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: PALETTE, borderColor: "#0f0f23", borderWidth: 2 }],
    },
    options: {
      ...baseOpts(true),
      cutout: "55%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#e0e0e0", padding: 10, boxWidth: 12, font: { size: 11 } } },
        title: { display: true, text: `Networks — ${brandName}`, color: "#64ffda", font: { size: 13 } },
        tooltip: { backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0", borderColor: "#2a2a40", borderWidth: 1 },
      },
    },
  });
}

// Brand detail — violation type donut
function renderBrandViolationChart(findings, brandName) {
  destroyChart("brandViolation");
  const ctx = document.getElementById("brandViolationChart");
  if (!ctx) return;
  const counts = {};
  findings.forEach(f => { const v = f.voilationTypeFLP || "Unknown"; counts[v] = (counts[v] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return;
  charts.brandViolation = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: PALETTE.slice(4), borderColor: "#0f0f23", borderWidth: 2 }],
    },
    options: {
      ...baseOpts(true),
      cutout: "55%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#e0e0e0", padding: 10, boxWidth: 12, font: { size: 11 } } },
        title: { display: true, text: `Violations — ${brandName}`, color: "#64ffda", font: { size: 13 } },
        tooltip: { backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0", borderColor: "#2a2a40", borderWidth: 1 },
      },
    },
  });
}

// Brand detail — findings timeline
function renderBrandTimeline(findings) {
  destroyChart("brandTimeline");
  const ctx = document.getElementById("brandTimelineChart");
  if (!ctx) return;
  const dateCounts = {};
  findings.forEach(f => { const d = fmtDate(f.automationStart); if (d !== "-") dateCounts[d] = (dateCounts[d] || 0) + 1; });
  const labels = Object.keys(dateCounts).sort();
  const values = labels.map(l => dateCounts[l]);
  const opts = baseOpts();
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.maxTicksLimit = 10;
  opts.scales.x.ticks.maxRotation = 40;
  charts.brandTimeline = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Findings", data: values, backgroundColor: "rgba(100,255,218,0.5)", borderColor: "#64ffda", borderWidth: 1, borderRadius: 3 }] },
    options: opts,
  });
}

// Brand detail — screenshot gallery
function renderBrandScreenshots(findings) {
  const gallery = document.getElementById("brandScreenshotGallery");
  const grid = document.getElementById("brandScreenshotGrid");
  if (!gallery || !grid) return;
  const shots = findings.filter(f => f.screenShotPath || f.landingScreenshot).slice(0, 12);
  if (shots.length === 0) { gallery.style.display = "none"; return; }
  gallery.style.display = "";
  grid.innerHTML = "";
  shots.forEach(r => {
    [r.screenShotPath, r.landingScreenshot].filter(Boolean).forEach((src, i) => {
      const wrap = document.createElement("div");
      wrap.className = "gallery-thumb";
      wrap.innerHTML = `<img src="${esc(src)}" alt="Screenshot" loading="lazy" onerror="this.style.display='none'">
        <div class="gallery-caption">${esc(r.incidenceId)} · ${i === 0 ? "Screenshot" : "Landing"}</div>`;
      wrap.addEventListener("click", () => openLightbox({ inc: r.incidenceId, brand: r.keyword, shot: r.screenShotPath, landing: r.landingScreenshot }));
      grid.appendChild(wrap);
    });
  });
}

// ============================================================
// ═══  VM ADWARE + CHART  ═════════════════════════════════════
// ============================================================

function fetchVmWiseAdware() {
  setTableMessage("#vmAdwareTable tbody", "Loading...", 4);
  fetch("https://app2app.io/vptapi/Api/Master/GetvmWiseAdware")
    .then(r => r.json())
    .then(data => {
      if (data?.data?.list) {
        state.vmAdwareData = data.data.list;
        fillSelect("vmFilter", state.vmAdwareData.map(d => d.vmName), "All VMs");
        fillSelect("vmAdwareExtensionFilter", state.vmAdwareData.map(d => d.extensionName), "All Extensions");
        applyVmAdwareFilters();
      } else {
        setTableMessage("#vmAdwareTable tbody", "No VM adware data available.", 4);
      }
    })
    .catch(err => {
      console.error("Error loading VM Adware data:", err);
      setTableMessage("#vmAdwareTable tbody", "Error loading VM adware data.", 4);
    });
}

function renderServerExtensionMatrix(adwareData, findingsData) {
  const summaryGrid = document.getElementById("serverSummaryGrid");
  if (!summaryGrid) return;

  // 1. Group by Server
  const serverMap = {};

  // Adware data (potential findings)
  adwareData.forEach(ad => {
    let sName = ad.vmName || "Unknown";
    sName = normalizeServerName(sName);
    const sKey = sName.toLowerCase();
    if (!serverMap[sKey]) {
      serverMap[sKey] = { name: sName, findingsCount: 0, adwareCount: 0, extensions: {} };
    }
    const extId = ad.extensionId;
    if (!serverMap[sKey].extensions[extId]) {
      serverMap[sKey].extensions[extId] = { id: extId, name: ad.extensionName, findings: 0, isInstalled: true, lastDate: null };
      serverMap[sKey].adwareCount++;
    }
  });

  // Findings data
  findingsData.forEach(f => {
    let sName = f.serverName || f.vm || "Unknown";
    sName = normalizeServerName(sName);
    const sKey = sName.toLowerCase();
    if (!serverMap[sKey]) {
      serverMap[sKey] = { name: sName, findingsCount: 0, adwareCount: 0, extensions: {} };
    }
    const extId = f.extensionId;
    if (!serverMap[sKey].extensions[extId]) {
      serverMap[sKey].extensions[extId] = { id: extId, name: f.extensionName, findings: 0, isInstalled: false, lastDate: null };
    }
    const e = serverMap[sKey].extensions[extId];
    e.findings++;
    serverMap[sKey].findingsCount++;

    // Track last date
    if (f.automationStart) {
      if (!e.lastDate || f.automationStart > e.lastDate) {
        e.lastDate = f.automationStart;
      }
    }
  });

  state.serverMatrixCache = serverMap;

  // 2. Render Summary Grid
  summaryGrid.innerHTML = "";
  Object.values(serverMap).sort((a,b) => b.findingsCount - a.findingsCount || a.name.localeCompare(b.name)).forEach(s => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.style.border = s.findingsCount > 0 ? "1px solid rgba(100,255,218,0.2)" : "1px solid rgba(255,255,255,0.05)";
    card.onclick = () => showServerDetail(s.name);
    
    const loc = state.vmRackInfo[s.name.toLowerCase()] || "";
    
    card.innerHTML = `
      <div class="card-content">
        <div class="card-value" style="font-size: 18px; color: #64ffda;">${esc(s.name)}</div>
        <div class="card-label">${loc ? esc(loc) : "Server"}</div>
        <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; color: #b0b0b0;">Findings: <b style="color: ${s.findingsCount > 0 ? "#64ffda" : "#666"};">${s.findingsCount}</b></span>
          <span style="font-size: 12px; color: #b0b0b0;">Adware: <b>${s.adwareCount}</b></span>
        </div>
      </div>
    `;
    summaryGrid.appendChild(card);
  });
}

function showServerDetail(serverName) {
  const section = document.getElementById("serverDetailSection");
  const title = document.getElementById("selectedServerTitle");
  const tbody = document.querySelector("#serverExtensionMatrixTable tbody");
  if (!section || !title || !tbody) return;

  const serverData = state.serverMatrixCache[serverName.toLowerCase()];
  if (!serverData) return;

  title.textContent = `Server Detail: ${serverName}`;
  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });

  tbody.innerHTML = "";
  const exts = Object.values(serverData.extensions).sort((a,b) => b.findings - a.findings);

  const frag = document.createDocumentFragment();
  exts.forEach(e => {
    const tr = document.createElement("tr");
    
    const nameTd = document.createElement("td");
    nameTd.innerHTML = `<b>${esc(e.name)}</b><br><span style="font-size:11px;color:#888;">${esc(e.id)}</span>`;
    
    const countTd = document.createElement("td");
    countTd.innerHTML = `<span class="badge" style="background:${e.findings > 0 ? "rgba(102,126,234,0.2)" : "rgba(255,107,107,0.1)"}; color:${e.findings > 0 ? "#64ffda" : "#ff6b6b"};">${e.findings}</span>`;
    
    const dateTd = document.createElement("td");
    dateTd.innerHTML = `<span style="font-size:12px;color:#b0b0b0;">${e.lastDate ? fmtDate(e.lastDate) : "—"}</span>`;

    const statusTd = document.createElement("td");
    if (e.findings > 0) {
      statusTd.innerHTML = `<span style="color:#43e97b; font-size:12px;">● Active Finding</span>`;
    } else if (e.isInstalled) {
      statusTd.innerHTML = `<span style="color:#ff6b6b; font-size:12px;">○ 0 Findings (Installed Adware)</span>`;
    } else {
      statusTd.innerHTML = `<span style="color:#888; font-size:12px;">- Manual Found</span>`;
    }

    tr.append(nameTd, countTd, dateTd, statusTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function hideServerDetail() {
  const section = document.getElementById("serverDetailSection");
  if (section) section.style.display = "none";
}

function applyVmAdwareFilters() {
  const selectedVm = document.getElementById("vmFilter")?.value || "";
  const selectedExt = document.getElementById("vmAdwareExtensionFilter")?.value || "";
  const searchTerm = (document.getElementById("vmAdwareSearchBox")?.value || "").trim().toLowerCase();
  let filtered = state.vmAdwareData;
  if (selectedVm) filtered = filtered.filter(d => d.vmName === selectedVm);
  if (selectedExt) filtered = filtered.filter(d => d.extensionName === selectedExt);
  if (searchTerm) filtered = filtered.filter(d => (d.extensionName || "").toLowerCase().includes(searchTerm) || (d.extensionId || "").toLowerCase().includes(searchTerm));
  state.filteredVmAdwareData = filtered;
  updateVmAdwareTable(filtered);
  renderVmAdwareChart(filtered);
  renderServerExtensionMatrix(filtered, state.raw);
}

function updateVmAdwareTable(data) {
  const tbody = document.querySelector("#vmAdwareTable tbody");
  if (!tbody) return;
  if (data.length === 0) { setTableMessage("#vmAdwareTable tbody", "No results found.", 4); return; }
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  data.forEach(r => {
    const tr = document.createElement("tr");
    const dateStr = r.createddate ? r.createddate.split(" ")[0] : "-";
    const vmName = normalizeServerName(r.vmName || "Unknown");
    const loc = state.vmRackInfo[vmName.toLowerCase()] || "";
    const vmDisplay = loc ? `${vmName} — ${loc}` : vmName;
    const eTd = document.createElement("td"); eTd.textContent = r.extensionId || "-";
    const nTd = document.createElement("td"); nTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#64ffda;">${esc(vmDisplay)}</span>`;
    const bTd = document.createElement("td"); bTd.textContent = r.browser || "-";
    const dTd = document.createElement("td"); dTd.textContent = dateStr;
    tr.append(eTd, nTd, bTd, dTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function renderVmAdwareChart(data) {
  return;
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(viewId, tabElement) {
  document.querySelectorAll(".view-content").forEach(el => el.style.display = "none");
  const target = document.getElementById("view-" + viewId);
  if (target) target.style.display = "block";
  document.querySelectorAll(".nav-tab").forEach(el => el.classList.remove("active"));
  if (tabElement) tabElement.classList.add("active");
  if (viewId === "server-status") fetchServerStatus();
}

// ============================================================
// EXCEL EXPORTS
// ============================================================
function exportToExcel(dataArray, columns, sheetName, fileName) {
  const exportData = dataArray.map(r => {
    const row = {};
    columns.forEach(([label, key]) => { row[label] = key === "__latestDate__" ? fmtDate(r.latestDate) : (r[key] != null ? r[key] : "-"); });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

function exportRiskReport() {
  const data = computeExtensionRisk(state.filtered.length ? state.filtered : state.raw);
  const exportData = data.map((e, i) => ({
    Rank: i + 1, "Extension ID": e.id, "Extension Name": e.name,
    "Total Findings": e.findings, "Unique Brands": e.uniqueBrands, "Unique Networks": e.uniqueNetworks, "Risk Score": e.score,
  }));
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extension Risk");
  XLSX.writeFile(wb, "extension_risk_report.xlsx");
}

// ============================================================
// UPDATE DATA BUTTON
// ============================================================
function initUpdateBtn() {
  const btn = document.getElementById("updateDataBtn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    const status = document.getElementById("updateStatus");
    if (status) status.textContent = "Updating...";
    fetch("http://localhost:5000/run-dashboard-bat", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        if (status) status.textContent = data.success ? "Data updated!" : "Update failed.";
        setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      })
      .catch(() => {
        if (status) status.textContent = "Error updating data.";
        setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      });
  });
}


// ============================================================
// DOMContentLoaded
// ============================================================
document.addEventListener("DOMContentLoaded", function () {
  initUpdateBtn();
  loadRackInfo().then(() => {
    fetchVmWiseAdware();
    fetchServerStatus();
    setInterval(fetchServerStatus, 60000);
  });
  loadMainData();

  document.getElementById("extensionFilter")?.addEventListener("change", applyFilters);
  document.getElementById("networkFilter")?.addEventListener("change", applyFilters);
  document.getElementById("typeFilter")?.addEventListener("change", applyFilters);
  document.getElementById("pubFilter")?.addEventListener("change", applyFilters);
  document.getElementById("couponSiteFilter")?.addEventListener("change", applyFilters);
  document.getElementById("serverFilter")?.addEventListener("change", applyFilters);
  document.getElementById("searchBox")?.addEventListener("input", debouncedApplyFilters);
  document.getElementById("extensionIdNameBox")?.addEventListener("input", debouncedApplyFilters);
  document.getElementById("brandSearchBox")?.addEventListener("input", debouncedApplyBrandFilters);
  document.getElementById("vmFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareExtensionFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareSearchBox")?.addEventListener("input", debouncedApplyVmFilters);

  // Timeline toggles
  document.getElementById("showRollingAvg")?.addEventListener("change", () => renderTimelineChart(state.filtered.length ? state.filtered : state.raw));
  document.getElementById("showCumulative")?.addEventListener("change", () => renderTimelineChart(state.filtered.length ? state.filtered : state.raw));

  // Matrix filter clear
  document.getElementById("clearMatrixFilterBtn")?.addEventListener("click", () => {
    matrixFilter = { brand: null, network: null };
    document.getElementById("clearMatrixFilterBtn").style.display = "none";
    applyFilters();
  });

  document.getElementById("downloadExcelBtn")?.addEventListener("click", () => {
    exportToExcel(state.filtered.length ? state.filtered : state.raw, [
      ["Incidence Id","incidenceId"],["Extension Id","extensionId"],["Extension Name","extensionName"],
      ["Brand","keyword"],["Violation","voilationTypeFLP"],["Type","type"],
      ["Networks","networks"],["Publisher ID","pubValue"],["Publisher Param","pubName"],
      ["Advertiser ID","advValue"],["Advertiser Param","advName"],
      ["Coupon Site","couponSite"],["Session Duration (mins)","sessionDurMins"],
      ["Video File Path","videoFilePath"],["Screen Shot Path","screenShotPath"],
      ["Network Log File Path","networkLogFilePath"],["Landing Url","landingUrl"],
      ["Landing Screenshot","landingScreenshot"],["Brand Url","brandUrl"],
      ["Final Landing Url","finalLandingUrl"],
      ["Redirection URL","redirectionURL"],["Redirection URL FLP","redirectionURLFLP"],
      ["Redirection URL2","redirectionURL2"],["Redirection URL2 FLP","redirectionURL2FLP"],
      ["Started Date","automationStart"],["End Date","automationEnd"],
    ], "Records", "extension_records.xlsx");
  });

  document.getElementById("downloadRiskExcelBtn")?.addEventListener("click", exportRiskReport);

  document.getElementById("downloadBrandExcelBtn")?.addEventListener("click", () => {
    const data = state.filteredBrandData.length ? state.filteredBrandData : state.brandData;
    const detailVisible = document.getElementById("brandDetailsSection")?.style.display !== "none";
    if (detailVisible && state.filteredBrandDetails.length) {
      exportToExcel(state.filteredBrandDetails, [
        ["Incidence Id","incidenceId"],["Extension Id","extensionId"],["Extension Name","extensionName"],
        ["Brand","keyword"],["Violation","voilationTypeFLP"],["Networks","networks"],
        ["Started Date","automationStart"],["Video File Path","videoFilePath"],["Network Log File Path","networkLogFilePath"],
      ], "Brand Details", "brand_findings_details.xlsx");
    } else {
      const ws = XLSX.utils.json_to_sheet(data.map(b => ({
        Brand: b.brand, "Total Findings": b.totalFindings, "Unique Extensions": b.uniqueExtensions,
        "First Seen": b.firstSeen, "Latest Finding": fmtDate(b.latestDate),
        "This Week": b.trend.thisWeek, "Last Week": b.trend.lastWeek, "Trend": b.trend.diff,
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Brand Summary");
      XLSX.writeFile(wb, "brand_summary.xlsx");
    }
  });

  document.getElementById("downloadVmAdwareExcelBtn")?.addEventListener("click", () => {
    const toExport = state.filteredVmAdwareData.length ? state.filteredVmAdwareData : state.vmAdwareData;
    const exportData = toExport.map(r => {
      const vmName = normalizeServerName(r.vmName || "Unknown");
      const loc = state.vmRackInfo[vmName.toLowerCase()] || "";
      return { "Extension ID": r.extensionId || "-", "Extension Name": r.extensionName || "-", "VM Name": vmName, Location: loc, Browser: r.browser || "-", "Created Date": r.createddate || "-" };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VM Adware Data");
    XLSX.writeFile(wb, "vm_adware_report.xlsx");
  });
});

// ============================================================
// DEBOUNCE UTILITY
// ============================================================
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const debouncedApplyFilters      = debounce(applyFilters, 200);
const debouncedApplyBrandFilters = debounce(applyBrandFilters, 200);
const debouncedApplyVmFilters    = debounce(applyVmAdwareFilters, 200);

// ============================================================
// UTILITY FUNCTIONS (single canonical definitions)
// ============================================================
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function clearAllFilters() {
  document.querySelectorAll('select').forEach(sel => sel.value = '');

  document.querySelectorAll('.flatpickr-input').forEach(input => {
    if (input._flatpickr) input._flatpickr.clear();
    else input.value = '';
  });

  ['searchBox', 'extensionIdNameBox', 'brandSearchBox', 'vmSearchBox', 'vmAdwareSearchBox'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  matrixFilter = { brand: null, network: null };
  const clearMatrixBtn = document.getElementById('clearMatrixFilterBtn');
  if (clearMatrixBtn) clearMatrixBtn.style.display = 'none';

  if (typeof applyFilters === 'function') applyFilters();
  if (typeof applyBrandFilters === 'function') applyBrandFilters();
  if (typeof applyVmAdwareFilters === 'function') applyVmAdwareFilters();

  document.getElementById('floatingUtils')?.classList.remove('active');
  scrollToTop();
}

// ============================================================
// FAB / FLOATING MENU (single canonical setup — runs after DOM ready)
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  const fabMain     = document.getElementById('fabMain');
  const floatingUtils = document.getElementById('floatingUtils');
  if (!fabMain || !floatingUtils) return;

  fabMain.addEventListener('click', function (e) {
    e.stopPropagation();
    floatingUtils.classList.toggle('active');
  });

  document.addEventListener('click', function (e) {
    if (!floatingUtils.contains(e.target)) {
      floatingUtils.classList.remove('active');
    }
  });
});