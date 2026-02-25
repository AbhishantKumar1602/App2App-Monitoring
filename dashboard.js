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
};

// Chart instances — destroyed & rebuilt on data change
const charts = {
  timeline: null,
  topBrands: null,
  violations: null,
  vmAdware: null,
  extensionRisk: null,
  networkDist: null,
  brandNetwork: null,
  typeChart: null,
  networkBrand: null,
};

// ============================================================
// UTILITY HELPERS
// ============================================================
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
        const name = esc(vm.vmName || vm.vmId || "Unknown");
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
      // Utilization bar
      const utilEl = document.getElementById("serverUtilSummary");
      if (utilEl && list.length > 0) {
        const pct = Math.round((busy.length / list.length) * 100);
        utilEl.innerHTML = `
          <div class="util-bar-wrap"><div class="util-bar" style="width:${pct}%"></div></div>
          <span class="util-label">${busy.length} / ${list.length} VMs busy (${pct}%)</span>`;
      }
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
function loadMainData() {
  setTableMessage("#dataTable tbody", "Loading...", 7);
  fetch("data.json?t=" + Date.now())
    .then(r => r.json())
    .then(data => {
      state.raw = data
        .filter(r => r && typeof r === "object")
        .map(r => ({
          ...r,
          extensionId: r.extensionId || "",
          extensionName: r.extensionName || "",
          keyword: normalizeBrand(r.keyword),
          networks: r.networks || "",
          voilationTypeFLP: r.voilationTypeFLP || "",
          automationStart: r.automationStart || "",
          incidenceId: r.incidenceId || "",
          videoFilePath: r.videoFilePath || "",
          networkLogFilePath: r.networkLogFilePath || "",
          type: r.type || "",
          landingUrl: r.landingUrl || "",
          finalLandingUrl: r.finalLandingUrl || "",
          redirectionURL: r.redirectionURL || "",
          redirectionURLFLP: r.redirectionURLFLP || "",
          brandUrl: r.brandUrl || "",
          screenShotPath: r.screenShotPath || "",
          landingScreenshot: r.landingScreenshot || "",
        }));
      state.raw.sort((a, b) => (parseDate(b.automationStart) || 0) - (parseDate(a.automationStart) || 0));
      fillSelect("extensionFilter", state.raw.map(d => d.extensionName), "All Extensions");
      fillSelect("networkFilter", state.raw.flatMap(d => d.networks ? d.networks.split(",").map(n => n.trim()) : []), "All Networks");
      fillSelect("typeFilter", state.raw.map(d => d.type).filter(Boolean), "All Types");
      initializeDatePickers();
      applyFilters();
      initializeBrandData(state.raw);
    })
    .catch(err => {
      console.error("Error loading data:", err);
      setTableMessage("#dataTable tbody", "Failed to load data.", 7);
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
// REPORTS FILTER
// ============================================================
function applyFilters() {
  const ext = document.getElementById("extensionFilter")?.value || "";
  const extIdName = (document.getElementById("extensionIdNameBox")?.value || "").trim().toLowerCase();
  const network = document.getElementById("networkFilter")?.value || "";
  const typeVal = document.getElementById("typeFilter")?.value || "";
  const from = document.getElementById("fromDate")?.value || "";
  const to = document.getElementById("toDate")?.value || "";
  const search = (document.getElementById("searchBox")?.value || "").toLowerCase();

  let filtered = state.raw;
  if (ext) filtered = filtered.filter(d => d.extensionName === ext || d.extensionId === ext);
  if (extIdName) filtered = filtered.filter(d => d.extensionName.toLowerCase().includes(extIdName) || d.extensionId.toLowerCase().includes(extIdName));
  if (network) filtered = filtered.filter(d => d.networks.split(",").map(n => n.trim()).includes(network));
  if (typeVal) filtered = filtered.filter(d => d.type === typeVal);
  if (from) filtered = filtered.filter(d => d.automationStart >= from);
  if (to) filtered = filtered.filter(d => d.automationStart <= to + "T23:59:59");
  if (search) filtered = filtered.filter(d =>
    d.keyword.toLowerCase().includes(search) ||
    d.voilationTypeFLP.toLowerCase().includes(search) ||
    d.networks.toLowerCase().includes(search) ||
    d.incidenceId.toString().includes(search) ||
    d.extensionName.toLowerCase().includes(search) ||
    d.type.toLowerCase().includes(search)
  );

  state.filtered = filtered;
  updateDashboard(filtered);
  renderAnalyticsCharts(filtered);
}

// ============================================================
// DASHBOARD KPIs + TABLE
// ============================================================
function updateDashboard(data) {
  document.getElementById("totalRecords").textContent = data.length;
  document.getElementById("uniqueExtensions").textContent = new Set(data.map(d => d.extensionId)).size;
  document.getElementById("uniqueBrands").textContent = new Set(data.map(d => d.keyword.toLowerCase())).size;
  document.getElementById("latestDate").textContent = data.length ? fmtDate(data[0].automationStart) : "-";
  renderReportsTable(data);
}

const PAGE_SIZE = 100;
let currentPage = 1;

function renderReportsTable(data) {
  const tbody = document.querySelector("#dataTable tbody");
  if (!tbody) return;
  if (data.length === 0) {
    setTableMessage("#dataTable tbody", "No records match your filters.", 7);
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
    const videoLink = r.videoFilePath ? `<a href="${esc(r.videoFilePath)}" target="_blank" rel="noopener">View</a>` : "-";
    const logLink = r.networkLogFilePath ? `<a href="https://app2app.io/sazviewer/?url=${esc(r.networkLogFilePath)}" target="_blank" rel="noopener">View</a>` : "-";
    const iTd = document.createElement("td");
    iTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div><div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>`;
    const eTd = document.createElement("td");
    eTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;
    const bTd = document.createElement("td"); bTd.textContent = r.keyword || "-";
    const vTd = document.createElement("td"); vTd.textContent = r.voilationTypeFLP || "-";
    const nTd = document.createElement("td"); nTd.textContent = r.networks || "-";
    const viTd = document.createElement("td"); viTd.innerHTML = videoLink;
    const lTd = document.createElement("td"); lTd.innerHTML = logLink;
    tr.append(iTd, eTd, bTd, vTd, nTd, viTd, lTd);
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
  renderViolationDonut(data);
  renderNetworkDistChart(data);
  renderTypeChart(data);
  renderExtensionRiskTable(data);
  renderNetworkBrandMatrix(data);
  renderAffiliateSwapTable(data);
  renderAffiliateFingerprintTable(data);
}

// 1. Findings Over Time
function renderTimelineChart(data) {
  destroyChart("timeline");
  const ctx = document.getElementById("timelineChart");
  if (!ctx) return;
  const dateCounts = {};
  data.forEach(r => {
    const d = fmtDate(r.automationStart);
    if (d !== "-") dateCounts[d] = (dateCounts[d] || 0) + 1;
  });
  const labels = Object.keys(dateCounts).sort();
  const values = labels.map(l => dateCounts[l]);
  const opts = baseOpts();
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.maxTicksLimit = 14;
  opts.scales.x.ticks.maxRotation = 45;
  charts.timeline = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Findings",
        data: values,
        backgroundColor: "rgba(102,126,234,0.75)",
        borderColor: "#667eea",
        borderWidth: 1,
        borderRadius: 4,
        hoverBackgroundColor: "#64ffda",
      }],
    },
    options: opts,
  });
}

// 2. Violation Type Donut
function renderViolationDonut(data) {
  destroyChart("violations");
  const ctx = document.getElementById("violationsChart");
  if (!ctx) return;
  const counts = {};
  data.forEach(r => {
    const v = r.voilationTypeFLP || "Unknown";
    counts[v] = (counts[v] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  charts.violations = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: PALETTE, borderColor: "#0f0f23", borderWidth: 2, hoverOffset: 8 }],
    },
    options: {
      ...baseOpts(true),
      cutout: "60%",
      plugins: {
        legend: { position: "right", labels: { color: "#e0e0e0", padding: 12, boxWidth: 14 } },
        tooltip: { backgroundColor: "#1a1a2e", titleColor: "#64ffda", bodyColor: "#e0e0e0", borderColor: "#2a2a40", borderWidth: 1 },
      },
    },
  });
}

// 3. Network Distribution
function renderNetworkDistChart(data) {
  destroyChart("networkDist");
  const ctx = document.getElementById("networkDistChart");
  if (!ctx) return;
  const counts = {};
  data.forEach(r => {
    if (r.networks) r.networks.split(",").forEach(n => { const net = n.trim(); if (net) counts[net] = (counts[net] || 0) + 1; });
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const opts = baseOpts();
  opts.indexAxis = "y";
  opts.plugins.legend.display = false;
  charts.networkDist = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ label: "Findings", data: sorted.map(([, v]) => v), backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }],
    },
    options: opts,
  });
}

// ── NEW: BEP vs OLM Type Chart ────────────────────────────
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

// ── NEW: Network × Brand Matrix ───────────────────────────
function renderNetworkBrandMatrix(data) {
  const wrapper = document.getElementById("networkBrandMatrix");
  if (!wrapper) return;

  // Collect all networks and top brands
  const networkSet = new Set();
  const brandCounts = {};
  data.forEach(r => {
    r.networks.split(",").forEach(n => { const net = n.trim(); if (net) networkSet.add(net); });
    brandCounts[r.keyword] = (brandCounts[r.keyword] || 0) + 1;
  });

  const networks = [...networkSet].sort();
  const topBrands = Object.entries(brandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([b]) => b);

  if (networks.length === 0 || topBrands.length === 0) {
    wrapper.innerHTML = '<p style="color:#666;padding:16px;">No data available.</p>';
    return;
  }

  // Build matrix: matrix[brand][network] = count
  const matrix = {};
  topBrands.forEach(b => { matrix[b] = {}; networks.forEach(n => { matrix[b][n] = 0; }); });
  data.forEach(r => {
    if (!matrix[r.keyword]) return;
    r.networks.split(",").forEach(n => {
      const net = n.trim();
      if (net && matrix[r.keyword][net] !== undefined) matrix[r.keyword][net]++;
    });
  });

  // Find max for colour scale
  let maxVal = 0;
  topBrands.forEach(b => networks.forEach(n => { if (matrix[b][n] > maxVal) maxVal = matrix[b][n]; }));

  const cellColor = (v) => {
    if (v === 0) return "#0f0f23";
    const intensity = Math.min(v / (maxVal || 1), 1);
    const r = Math.round(102 + (255 - 102) * intensity);
    const g = Math.round(126 + (75 - 126) * intensity);
    const b = Math.round(234 + (92 - 234) * intensity);
    return `rgb(${r},${g},${b})`;
  };
  const textColor = (v) => v === 0 ? "#333" : v / (maxVal || 1) > 0.5 ? "#fff" : "#e0e0e0";

  let html = '<div class="matrix-scroll"><table class="matrix-table"><thead><tr><th class="matrix-corner">Brand \ Network</th>';
  networks.forEach(n => { html += `<th class="matrix-net">${esc(n)}</th>`; });
  html += '</tr></thead><tbody>';
  topBrands.forEach(b => {
    const rowTotal = networks.reduce((s, n) => s + matrix[b][n], 0);
    html += `<tr><td class="matrix-brand">${esc(b)}</td>`;
    networks.forEach(n => {
      const v = matrix[b][n];
      html += `<td class="matrix-cell" style="background:${cellColor(v)};color:${textColor(v)};" title="${esc(b)} × ${esc(n)}: ${v}">${v > 0 ? v : ""}</td>`;
    });
    html += `<td class="matrix-total">${rowTotal}</td></tr>`;
  });
  html += '</tbody></table></div>';
  wrapper.innerHTML = html;
}

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

  // Only rows where redirectionURL and redirectionURLFLP both exist and differ
  const swaps = data.filter(r => r.redirectionURL && r.redirectionURLFLP && r.redirectionURL !== r.redirectionURLFLP);

  if (swaps.length === 0) {
    setTableMessage("#affiliateSwapTable tbody", "No affiliate swap evidence found in current filter.", 5);
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  swaps.forEach(r => {
    const origId = extractAffiliateId(r.redirectionURL) || extractAffiliateParam(r.redirectionURL, "utm_content") || "—";
    const injId  = extractAffiliateId(r.redirectionURLFLP) || extractAffiliateParam(r.redirectionURLFLP, "utm_content") || "—";
    const sameId = origId === injId;
    const tr = document.createElement("tr");

    const incTd = document.createElement("td");
    incTd.innerHTML = `<b>${esc(r.incidenceId || "-")}</b><div style="font-size:11px;color:#666;">${esc(fmtDate(r.automationStart))}</div>`;
    const extTd = document.createElement("td");
    extTd.innerHTML = `${esc(r.extensionName)}<br><span style="font-size:11px;color:#555;">${esc(r.extensionId)}</span>`;
    const brandTd = document.createElement("td"); brandTd.textContent = r.keyword;
    const netTd = document.createElement("td"); netTd.textContent = r.networks;
    const swapTd = document.createElement("td");

    if (sameId) {
      swapTd.innerHTML = `<span style="color:#666;font-size:12px;">Same ID — URL params differ</span>`;
    } else {
      swapTd.innerHTML = `
        <div class="swap-row">
          <span class="swap-orig" title="Original: ${esc(r.redirectionURL)}">
            <span class="swap-label">Original</span>
            <code class="swap-id">${esc(origId)}</code>
          </span>
          <span class="swap-arrow">→</span>
          <span class="swap-inj" title="Injected: ${esc(r.redirectionURLFLP)}">
            <span class="swap-label">Injected</span>
            <code class="swap-id injected">${esc(injId)}</code>
          </span>
        </div>`;
    }
    tr.append(incTd, extTd, brandTd, netTd, swapTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  // Update count badge
  const badge = document.getElementById("swapCount");
  if (badge) badge.textContent = swaps.length;
}

// ── NEW: Affiliate Fingerprint (injected ID clusters) ─────
function renderAffiliateFingerprintTable(data) {
  const tbody = document.querySelector("#affiliateFingerprintTable tbody");
  if (!tbody) return;

  // Group by injected affiliate ID across records
  const fingerprintMap = {};
  data.forEach(r => {
    if (!r.redirectionURLFLP) return;
    const injId = extractAffiliateId(r.redirectionURLFLP) || extractAffiliateParam(r.redirectionURLFLP, "utm_content");
    if (!injId || injId === "—") return;
    if (!fingerprintMap[injId]) fingerprintMap[injId] = { id: injId, extensions: new Set(), brands: new Set(), networks: new Set(), count: 0 };
    fingerprintMap[injId].extensions.add(r.extensionId);
    fingerprintMap[injId].brands.add(r.keyword);
    fingerprintMap[injId].networks.add(r.networks);
    fingerprintMap[injId].count++;
  });

  const sorted = Object.values(fingerprintMap).sort((a, b) => b.extensions.size - a.extensions.size || b.count - a.count);

  if (sorted.length === 0) {
    setTableMessage("#affiliateFingerprintTable tbody", "No affiliate fingerprint data in current filter.", 5);
    return;
  }

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  sorted.forEach((fp, idx) => {
    const tr = document.createElement("tr");
    const isSuspect = fp.extensions.size > 1; // same affiliate ID used by multiple extensions = coordinated fraud signal

    const rankTd = document.createElement("td"); rankTd.innerHTML = `<span class="rank-num">#${idx + 1}</span>`;
    const idTd = document.createElement("td");
    idTd.innerHTML = `<code class="aff-id-code ${isSuspect ? "aff-suspect" : ""}">${esc(fp.id)}</code>${isSuspect ? ' <span class="fraud-badge">⚠️ Multi-ext</span>' : ''}`;
    const extTd = document.createElement("td"); extTd.textContent = fp.extensions.size;
    const brandTd = document.createElement("td"); brandTd.textContent = fp.brands.size;
    const countTd = document.createElement("td"); countTd.textContent = fp.count;
    const netTd = document.createElement("td");
    netTd.innerHTML = [...fp.networks].map(n => `<span class="net-tag">${esc(n)}</span>`).join(" ");
    tr.append(rankTd, idTd, extTd, brandTd, countTd, netTd);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  const badge = document.getElementById("fingerprintCount");
  if (badge) badge.textContent = sorted.length;
  const suspectBadge = document.getElementById("suspectCount");
  if (suspectBadge) suspectBadge.textContent = sorted.filter(f => f.extensions.size > 1).length;
}

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
  if (riskData.length === 0) { setTableMessage("#extensionRiskTable tbody", "No data available.", 5); return; }
  const maxScore = riskData[0].score || 1;
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  riskData.forEach((ext, idx) => {
    const tr = document.createElement("tr");
    const lvl = ext.score >= maxScore * 0.7 ? "risk-high" : ext.score >= maxScore * 0.35 ? "risk-med" : "risk-low";
    const lbl = ext.score >= maxScore * 0.7 ? "HIGH" : ext.score >= maxScore * 0.35 ? "MED" : "LOW";
    const pct = Math.round((ext.score / maxScore) * 100);
    const rankTd = document.createElement("td"); rankTd.innerHTML = `<span class="rank-num">#${idx + 1}</span>`;
    const nameTd = document.createElement("td"); nameTd.innerHTML = `<b>${esc(ext.name)}</b><br><span style="font-size:11px;color:#666;">${esc(ext.id)}</span>`;
    const fTd = document.createElement("td"); fTd.textContent = ext.findings;
    const bTd = document.createElement("td"); bTd.textContent = ext.uniqueBrands;
    const sTd = document.createElement("td");
    sTd.innerHTML = `
      <div class="risk-score-wrap">
        <span class="risk-badge ${lvl}">${lbl}</span>
        <div class="risk-bar-bg"><div class="risk-bar-fill ${lvl}" style="width:${pct}%"></div></div>
        <span class="risk-num">${ext.score}</span>
      </div>`;
    tr.append(rankTd, nameTd, fTd, bTd, sTd);
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

// Top 15 Brands Chart
function renderTopBrandsChart(data) {
  destroyChart("topBrands");
  const ctx = document.getElementById("topBrandsChart");
  if (!ctx) return;
  const top = data.slice(0, 15);
  const opts = baseOpts();
  opts.indexAxis = "y";
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.stepSize = 1;
  charts.topBrands = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map(b => b.brand),
      datasets: [{
        label: "Findings",
        data: top.map(b => b.totalFindings),
        backgroundColor: top.map(b => b.trend.diff > 0 ? "rgba(255,107,107,0.8)" : b.trend.diff < 0 ? "rgba(67,233,123,0.8)" : "rgba(102,126,234,0.8)"),
        borderRadius: 4,
      }],
    },
    options: opts,
  });
}

// Brand Detail — show/close
function showBrandDetails(brandItem) {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");
  const summaryChart = document.getElementById("topBrandsChartSection");
  if (detailSection) { detailSection.style.display = "block"; detailSection.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (summaryTable) summaryTable.style.display = "none";
  if (summaryChart) summaryChart.style.display = "none";
  updateBrandDetailsTable(brandItem.brand, brandItem.findings);
  renderBrandNetworkMiniChart(brandItem.findings, brandItem.brand);
}

function closeBrandDetails() {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");
  const summaryChart = document.getElementById("topBrandsChartSection");
  if (detailSection) detailSection.style.display = "none";
  if (summaryTable) summaryTable.style.display = "";
  if (summaryChart) summaryChart.style.display = "";
}

function updateBrandDetailsTable(brandName, findings) {
  state.filteredBrandDetails = findings;
  const tbody = document.querySelector("#brandDetailsTable tbody");
  if (!tbody) return;
  const uniqueExts = new Set(findings.map(f => f.extensionId)).size;
  const infoEl = document.getElementById("brandDetailInfo");
  if (infoEl) infoEl.textContent = `${brandName}: ${findings.length} findings across ${uniqueExts} extension(s)`;
  if (findings.length === 0) { setTableMessage("#brandDetailsTable tbody", "No findings found.", 6); return; }
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  findings.forEach(r => {
    const tr = document.createElement("tr");
    const videoLink = r.videoFilePath ? `<a href="${esc(r.videoFilePath)}" target="_blank" rel="noopener">View</a>` : "-";
    const logLink = r.networkLogFilePath ? `<a href="https://app2app.io/sazviewer/?url=${esc(r.networkLogFilePath)}" target="_blank" rel="noopener">View</a>` : "-";
    const iTd = document.createElement("td"); iTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div><div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>`;
    const eTd = document.createElement("td"); eTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;
    const vTd = document.createElement("td"); vTd.textContent = r.voilationTypeFLP || "-";
    const nTd = document.createElement("td"); nTd.textContent = r.networks || "-";
    const viTd = document.createElement("td"); viTd.innerHTML = videoLink;
    const lTd = document.createElement("td"); lTd.innerHTML = logLink;
    tr.append(iTd, eTd, vTd, nTd, viTd, lTd);
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
    const vmName = r.vmName || "Unknown";
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
  destroyChart("vmAdware");
  const ctx = document.getElementById("vmAdwareChart");
  if (!ctx) return;
  const vmCounts = {};
  data.forEach(r => { const vm = r.vmName || "Unknown"; vmCounts[vm] = (vmCounts[vm] || 0) + 1; });
  const sorted = Object.entries(vmCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return;
  const opts = baseOpts();
  opts.plugins.legend.display = false;
  opts.scales.x.ticks.maxRotation = 40;
  charts.vmAdware = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ label: "Adware Count", data: sorted.map(([, v]) => v), backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }],
    },
    options: opts,
  });
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
  document.getElementById("searchBox")?.addEventListener("input", applyFilters);
  document.getElementById("extensionIdNameBox")?.addEventListener("input", applyFilters);
  document.getElementById("brandSearchBox")?.addEventListener("input", applyBrandFilters);
  document.getElementById("vmFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareExtensionFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareSearchBox")?.addEventListener("input", applyVmAdwareFilters);

  document.getElementById("downloadExcelBtn")?.addEventListener("click", () => {
    exportToExcel(state.filtered.length ? state.filtered : state.raw, [
      ["Incidence Id","incidenceId"],["Extension Id","extensionId"],["Extension Name","extensionName"],
      ["Brand","keyword"],["Violation","voilationTypeFLP"],["Video File Path","videoFilePath"],
      ["Screen Shot Path","screenShotPath"],["Network Log File Path","networkLogFilePath"],
      ["Landing Url","landingUrl"],["Type","type"],["Landing Screenshot","landingScreenshot"],
      ["Brand Url","brandUrl"],["Final Landing Url","finalLandingUrl"],
      ["Redirection URL","redirectionURL"],["Redirection URL FLP","redirectionURLFLP"],
      ["Networks","networks"],["Started Date","automationStart"],
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
      const vmName = r.vmName || "Unknown";
      const loc = state.vmRackInfo[vmName.toLowerCase()] || "";
      return { "Extension ID": r.extensionId || "-", "Extension Name": r.extensionName || "-", "VM Name": vmName, Location: loc, Browser: r.browser || "-", "Created Date": r.createddate || "-" };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VM Adware Data");
    XLSX.writeFile(wb, "vm_adware_report.xlsx");
  });
});