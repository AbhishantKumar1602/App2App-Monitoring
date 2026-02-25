// ============================================================
// STATE MANAGEMENT - single source of truth
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

// ============================================================
// UTILITY HELPERS
// ============================================================

/** Safe text content — prevents XSS */
function esc(val) {
  if (val == null) return "-";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Parse ISO or "YYYY-MM-DD" date safely */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/** Format date string to YYYY-MM-DD for display */
function fmtDate(str) {
  if (!str) return "-";
  return str.split("T")[0];
}

/** Normalize brand name: keep display version and compare lowercase */
function normalizeBrand(val) {
  return (val || "Unknown").trim();
}

/** Show empty/loading row in a tbody */
function setTableMessage(tbodySelector, msg, cols) {
  const tbody = document.querySelector(tbodySelector);
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:#666;padding:24px;">${esc(msg)}</td></tr>`;
}

/** Build <option> elements into a <select>, deduped and sorted */
function fillSelect(selectId, values, allLabel = "All") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentVal = select.value;
  const sorted = [...new Set(values.filter(Boolean))].sort();
  select.innerHTML = `<option value="">${allLabel}</option>`;
  sorted.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  // restore previous selection if still valid
  if (currentVal && sorted.includes(currentVal)) select.value = currentVal;
}

// ============================================================
// LOADING RACK INFO
// ============================================================
function loadRackInfo() {
  return fetch("vm_rack_info.json?t=" + Date.now())
    .then((res) => res.json())
    .then((data) => {
      Object.keys(data).forEach((key) => {
        state.vmRackInfo[key.toLowerCase()] = data[key];
      });
    })
    .catch((err) => console.warn("Rack info not available:", err));
}

// ============================================================
// SERVER STATUS (with auto-refresh every 60s)
// ============================================================
function fetchServerStatus() {
  fetch("https://app2app.io/vptapi/Api/Task/GetRunningVm?VmId=0&TaskMasterId=0")
    .then((res) => res.json())
    .then((data) => {
      const list =
        data.data && data.data.vmMasterList ? data.data.vmMasterList : [];

      const renderVm = (vm) => {
        const name = esc(vm.vmName || vm.vmId || "Unknown");
        const loc = state.vmRackInfo[name.toLowerCase()] || "";
        const locHtml = loc
          ? `<div style="font-size:13px;font-weight:500;margin-top:3px;color:#0000b3;">${esc(loc)}</div>`
          : "";
        const cls = vm.vmStatus === 1 ? "busy-server" : "free-server";
        return `<span class="${cls}">${name}${locHtml}</span>`;
      };

      const busyServers = list.filter((vm) => vm.vmStatus === 1);
      const freeServers = list.filter((vm) => vm.vmStatus === 0);

      const busyDiv = document.getElementById("busyServerStatus");
      const freeDiv = document.getElementById("freeServerStatus");

      if (busyDiv)
        busyDiv.innerHTML =
          busyServers.length === 0
            ? "No busy servers."
            : busyServers.map(renderVm).join(" ");

      if (freeDiv)
        freeDiv.innerHTML =
          freeServers.length === 0
            ? "No free servers."
            : freeServers.map(renderVm).join(" ");

      // Update "last refreshed" timestamp
      const ts = document.getElementById("serverStatusTimestamp");
      if (ts)
        ts.textContent =
          "Last updated: " + new Date().toLocaleTimeString();
    })
    .catch(() => {
      const busyDiv = document.getElementById("busyServerStatus");
      const freeDiv = document.getElementById("freeServerStatus");
      if (busyDiv) busyDiv.innerHTML = "Error loading server status.";
      if (freeDiv) freeDiv.innerHTML = "Error loading server status.";
    });
}

// ============================================================
// MAIN DATA LOAD
// ============================================================
function loadMainData() {
  setTableMessage("#dataTable tbody", "Loading...", 7);
  fetch("data.json?t=" + Date.now())
    .then((res) => res.json())
    .then((data) => {
      // Validate & normalise on load
      state.raw = data
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
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
        }));

      // Sort newest first
      state.raw.sort(
        (a, b) =>
          (parseDate(b.automationStart) || 0) -
          (parseDate(a.automationStart) || 0)
      );

      fillSelect(
        "extensionFilter",
        state.raw.map((d) => d.extensionName),
        "All Extensions"
      );
      fillSelect(
        "networkFilter",
        state.raw.flatMap((d) =>
          d.networks ? d.networks.split(",").map((n) => n.trim()) : []
        ),
        "All Networks"
      );

      initializeDatePickers();
      applyFilters();
      initializeBrandData(state.raw);
    })
    .catch((err) => {
      console.error("Error loading data:", err);
      setTableMessage("#dataTable tbody", "Failed to load data.", 7);
    });
}

// ============================================================
// DATE PICKERS
// ============================================================
function initializeDatePickers() {
  const fromPicker = flatpickr("#fromDate", {
    dateFormat: "Y-m-d",
    onChange: applyFilters,
  });
  const toPicker = flatpickr("#toDate", {
    dateFormat: "Y-m-d",
    onChange: applyFilters,
  });

  document.getElementById("clearFromDate")?.addEventListener("click", () => {
    fromPicker.clear();
    applyFilters();
  });
  document.getElementById("clearToDate")?.addEventListener("click", () => {
    toPicker.clear();
    applyFilters();
  });

  const brandFromPicker = flatpickr("#brandFromDate", {
    dateFormat: "Y-m-d",
    onChange: applyBrandFilters,
  });
  const brandToPicker = flatpickr("#brandToDate", {
    dateFormat: "Y-m-d",
    onChange: applyBrandFilters,
  });

  document
    .getElementById("clearBrandFromDate")
    ?.addEventListener("click", () => {
      brandFromPicker.clear();
      applyBrandFilters();
    });
  document
    .getElementById("clearBrandToDate")
    ?.addEventListener("click", () => {
      brandToPicker.clear();
      applyBrandFilters();
    });
}

// ============================================================
// REPORTS FILTERS
// ============================================================
function applyFilters() {
  const ext = document.getElementById("extensionFilter")?.value || "";
  const extIdName = (
    document.getElementById("extensionIdNameBox")?.value || ""
  )
    .trim()
    .toLowerCase();
  const network = document.getElementById("networkFilter")?.value || "";
  const from = document.getElementById("fromDate")?.value || "";
  const to = document.getElementById("toDate")?.value || "";
  const search = (
    document.getElementById("searchBox")?.value || ""
  ).toLowerCase();

  let filtered = state.raw;

  if (ext)
    filtered = filtered.filter(
      (d) => d.extensionName === ext || d.extensionId === ext
    );
  if (extIdName)
    filtered = filtered.filter(
      (d) =>
        d.extensionName.toLowerCase().includes(extIdName) ||
        d.extensionId.toLowerCase().includes(extIdName)
    );
  if (network)
    filtered = filtered.filter((d) =>
      d.networks.toLowerCase().includes(network.toLowerCase())
    );
  if (from) {
    const fromDate = parseDate(from);
    if (fromDate)
      filtered = filtered.filter(() => {
        // handled below via string compare (ISO safe)
        return true;
      });
    filtered = filtered.filter((d) => d.automationStart >= from);
  }
  if (to)
    filtered = filtered.filter(
      (d) => d.automationStart <= to + "T23:59:59"
    );
  if (search)
    filtered = filtered.filter(
      (d) =>
        d.keyword.toLowerCase().includes(search) ||
        d.voilationTypeFLP.toLowerCase().includes(search) ||
        d.networks.toLowerCase().includes(search) ||
        d.incidenceId.toString().includes(search) ||
        d.extensionName.toLowerCase().includes(search)
    );

  state.filtered = filtered;
  updateDashboard(filtered);
}

// ============================================================
// DASHBOARD KPI + TABLE
// ============================================================
function updateDashboard(data) {
  document.getElementById("totalRecords").textContent = data.length;
  document.getElementById("uniqueExtensions").textContent = new Set(
    data.map((d) => d.extensionId)
  ).size;
  document.getElementById("uniqueBrands").textContent = new Set(
    data.map((d) => d.keyword.toLowerCase())
  ).size;
  document.getElementById("latestDate").textContent = data.length
    ? fmtDate(data[0].automationStart)
    : "-";

  renderReportsTable(data);
}

// Pagination state
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

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = data.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  pageData.forEach((r) => {
    const tr = document.createElement("tr");

    // Safe link building
    const videoLink = r.videoFilePath
      ? `<a href="${esc(r.videoFilePath)}" target="_blank" rel="noopener">View</a>`
      : "-";
    const logLink = r.networkLogFilePath
      ? `<a href="https://app2app.io/sazviewer/?url=${esc(r.networkLogFilePath)}" target="_blank" rel="noopener">View</a>`
      : "-";

    // Use textContent for data cells to prevent XSS
    const incidentTd = document.createElement("td");
    incidentTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div><div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>`;

    const extTd = document.createElement("td");
    extTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;

    const brandTd = document.createElement("td");
    brandTd.textContent = r.keyword || "-";

    const violationTd = document.createElement("td");
    violationTd.textContent = r.voilationTypeFLP || "-";

    const networkTd = document.createElement("td");
    networkTd.textContent = r.networks || "-";

    const videoTd = document.createElement("td");
    videoTd.innerHTML = videoLink;

    const logTd = document.createElement("td");
    logTd.innerHTML = logLink;

    tr.append(incidentTd, extTd, brandTd, violationTd, networkTd, videoTd, logTd);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);

  renderPagination(data.length, "#reportsPagination");
}

function renderPagination(total, containerId) {
  const container = document.querySelector(containerId);
  if (!container) return;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) {
    container.innerHTML = total > 0
      ? `<span class="page-info">Showing ${total} records</span>`
      : "";
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
    </div>
  `;
}

function changePage(dir) {
  const totalPages = Math.ceil(state.filtered.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(totalPages, currentPage + dir));
  renderReportsTable(state.filtered);
}

// ============================================================
// BRAND MANAGEMENT
// ============================================================
function initializeBrandData(data) {
  const brandMap = {};
  data.forEach((record) => {
    const brandKey = record.keyword.toLowerCase();
    const brandDisplay = record.keyword; // preserve original casing

    if (!brandMap[brandKey]) {
      brandMap[brandKey] = {
        brand: brandDisplay,
        brandKey,
        findings: [],
        extensionIds: new Set(),
        latestDate: record.automationStart,
      };
    }
    brandMap[brandKey].findings.push(record);
    brandMap[brandKey].extensionIds.add(record.extensionId);

    const recDate = parseDate(record.automationStart);
    const curDate = parseDate(brandMap[brandKey].latestDate);
    if (recDate && curDate && recDate > curDate) {
      brandMap[brandKey].latestDate = record.automationStart;
    }
  });

  state.brandData = Object.values(brandMap)
    .map((item) => ({
      brand: item.brand,
      brandKey: item.brandKey,
      totalFindings: item.findings.length,
      uniqueExtensions: item.extensionIds.size,
      latestDate: item.latestDate,
      findings: item.findings,
    }))
    .sort((a, b) => b.totalFindings - a.totalFindings);

  updateBrandKPIs(state.brandData);
  updateBrandSummaryTable(state.brandData);
}

function applyBrandFilters() {
  const from = document.getElementById("brandFromDate")?.value || "";
  const to = document.getElementById("brandToDate")?.value || "";
  const search = (
    document.getElementById("brandSearchBox")?.value || ""
  ).toLowerCase();

  let filtered = state.brandData.map((item) => {
    let validFindings = item.findings;

    if (from)
      validFindings = validFindings.filter(
        (f) => f.automationStart >= from
      );
    if (to)
      validFindings = validFindings.filter(
        (f) => f.automationStart <= to + "T23:59:59"
      );

    const latestDate = validFindings.length
      ? validFindings.reduce(
          (max, f) =>
            (parseDate(f.automationStart) || 0) > (parseDate(max) || 0)
              ? f.automationStart
              : max,
          ""
        )
      : "";

    return {
      ...item,
      findings: validFindings,
      totalFindings: validFindings.length,
      uniqueExtensions: new Set(validFindings.map((f) => f.extensionId)).size,
      latestDate,
    };
  }).filter((item) => item.totalFindings > 0);

  if (search)
    filtered = filtered.filter((item) =>
      item.brand.toLowerCase().includes(search)
    );

  filtered.sort((a, b) => b.totalFindings - a.totalFindings);

  state.filteredBrandData = filtered;
  updateBrandSummaryTable(filtered);
  updateBrandKPIs(filtered);
}

function updateBrandKPIs(data) {
  document.getElementById("totalBrands").textContent = data.length;
  const totalFindings = data.reduce((sum, item) => sum + item.totalFindings, 0);
  document.getElementById("totalBrandFindings").textContent = totalFindings;
  const avg = data.length > 0 ? (totalFindings / data.length).toFixed(1) : "0";
  document.getElementById("avgFindingsPerBrand").textContent = avg;
}

function updateBrandSummaryTable(data) {
  state.filteredBrandData = data;
  const tbody = document.querySelector("#brandTable tbody");
  if (!tbody) return;

  document.getElementById("brandTableSubtitle").textContent =
    `Showing ${data.length} brands`;

  if (data.length === 0) {
    setTableMessage("#brandTable tbody", "No brands match your filters.", 4);
    return;
  }

  tbody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  data.forEach((item) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showBrandDetails(item));

    const brandTd = document.createElement("td");
    brandTd.innerHTML = `<b>${esc(item.brand)}</b>`;

    const findingsTd = document.createElement("td");
    findingsTd.innerHTML = `<span class="badge">${item.totalFindings}</span>`;

    const extTd = document.createElement("td");
    extTd.textContent = item.uniqueExtensions;

    const dateTd = document.createElement("td");
    dateTd.textContent = fmtDate(item.latestDate);

    tr.append(brandTd, findingsTd, extTd, dateTd);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

function showBrandDetails(brandItem) {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");

  if (detailSection) {
    detailSection.style.display = "block";
    detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (summaryTable) summaryTable.style.display = "none";

  updateBrandDetailsTable(brandItem.brand, brandItem.findings);
}

function closeBrandDetails() {
  const detailSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable")?.closest(".table-section");

  if (detailSection) detailSection.style.display = "none";
  if (summaryTable) summaryTable.style.display = "";
}

function updateBrandDetailsTable(brandName, findings) {
  state.filteredBrandDetails = findings;
  const tbody = document.querySelector("#brandDetailsTable tbody");
  if (!tbody) return;

  const infoEl = document.getElementById("brandDetailInfo");
  const uniqueExts = new Set(findings.map((f) => f.extensionId)).size;
  if (infoEl)
    infoEl.textContent = `${brandName}: ${findings.length} findings across ${uniqueExts} extension(s)`;

  if (findings.length === 0) {
    setTableMessage("#brandDetailsTable tbody", "No findings found.", 6);
    return;
  }

  tbody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  findings.forEach((r) => {
    const tr = document.createElement("tr");

    const videoLink = r.videoFilePath
      ? `<a href="${esc(r.videoFilePath)}" target="_blank" rel="noopener">View</a>`
      : "-";
    const logLink = r.networkLogFilePath
      ? `<a href="https://app2app.io/sazviewer/?url=${esc(r.networkLogFilePath)}" target="_blank" rel="noopener">View</a>`
      : "-";

    const incidentTd = document.createElement("td");
    incidentTd.innerHTML = `<div><b>${esc(r.incidenceId || "-")}</b></div><div style="font-size:12px;color:#888;">${esc(fmtDate(r.automationStart))}</div>`;

    const extTd = document.createElement("td");
    extTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#888;">${esc(r.extensionId)}</span>`;

    const violTd = document.createElement("td");
    violTd.textContent = r.voilationTypeFLP || "-";

    const netTd = document.createElement("td");
    netTd.textContent = r.networks || "-";

    const videoTd = document.createElement("td");
    videoTd.innerHTML = videoLink;

    const logTd = document.createElement("td");
    logTd.innerHTML = logLink;

    tr.append(incidentTd, extTd, violTd, netTd, videoTd, logTd);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

// ============================================================
// VM ADWARE
// ============================================================
function fetchVmWiseAdware() {
  setTableMessage("#vmAdwareTable tbody", "Loading...", 4);
  fetch("https://app2app.io/vptapi/Api/Master/GetvmWiseAdware")
    .then((res) => res.json())
    .then((data) => {
      if (data && data.data && data.data.list) {
        state.vmAdwareData = data.data.list;
        fillSelect(
          "vmFilter",
          state.vmAdwareData.map((d) => d.vmName),
          "All VMs"
        );
        fillSelect(
          "vmAdwareExtensionFilter",
          state.vmAdwareData.map((d) => d.extensionName),
          "All Extensions"
        );
        applyVmAdwareFilters();
      } else {
        setTableMessage("#vmAdwareTable tbody", "No VM adware data available.", 4);
      }
    })
    .catch((err) => {
      console.error("Error loading VM Adware data:", err);
      setTableMessage("#vmAdwareTable tbody", "Error loading VM adware data.", 4);
    });
}

function applyVmAdwareFilters() {
  const selectedVm = document.getElementById("vmFilter")?.value || "";
  const selectedExt =
    document.getElementById("vmAdwareExtensionFilter")?.value || "";
  const searchTerm = (
    document.getElementById("vmAdwareSearchBox")?.value || ""
  )
    .trim()
    .toLowerCase();

  let filtered = state.vmAdwareData;
  if (selectedVm) filtered = filtered.filter((d) => d.vmName === selectedVm);
  if (selectedExt)
    filtered = filtered.filter((d) => d.extensionName === selectedExt);
  if (searchTerm)
    filtered = filtered.filter(
      (d) =>
        (d.extensionName || "").toLowerCase().includes(searchTerm) ||
        (d.extensionId || "").toLowerCase().includes(searchTerm)
    );

  state.filteredVmAdwareData = filtered;
  updateVmAdwareTable(filtered);
}

function updateVmAdwareTable(data) {
  const tbody = document.querySelector("#vmAdwareTable tbody");
  if (!tbody) return;

  if (data.length === 0) {
    setTableMessage("#vmAdwareTable tbody", "No results found.", 4);
    return;
  }

  tbody.innerHTML = "";
  const fragment = document.createDocumentFragment();
  data.forEach((r) => {
    const tr = document.createElement("tr");
    const dateStr = r.createddate ? r.createddate.split(" ")[0] : "-";
    const vmName = r.vmName || "Unknown";
    const loc = state.vmRackInfo[vmName.toLowerCase()] || "";
    const vmDisplay = loc ? `${vmName} — ${loc}` : vmName;

    const extIdTd = document.createElement("td");
    extIdTd.textContent = r.extensionId || "-";

    const extNameTd = document.createElement("td");
    extNameTd.innerHTML = `${esc(r.extensionName || "-")}<br><span style="font-size:12px;color:#64ffda;">${esc(vmDisplay)}</span>`;

    const browserTd = document.createElement("td");
    browserTd.textContent = r.browser || "-";

    const dateTd = document.createElement("td");
    dateTd.textContent = dateStr;

    tr.append(extIdTd, extNameTd, browserTd, dateTd);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(viewId, tabElement) {
  document
    .querySelectorAll(".view-content")
    .forEach((el) => (el.style.display = "none"));
  const target = document.getElementById("view-" + viewId);
  if (target) target.style.display = "block";
  document
    .querySelectorAll(".nav-tab")
    .forEach((el) => el.classList.remove("active"));
  if (tabElement) tabElement.classList.add("active");

  // Lazy-load server status when switching to that tab
  if (viewId === "server-status") {
    fetchServerStatus();
  }
}

// ============================================================
// EXCEL EXPORTS (consolidated, no duplicates)
// ============================================================
function exportToExcel(dataArray, columns, sheetName, fileName) {
  const exportData = dataArray.map((r) => {
    const row = {};
    columns.forEach(([label, key]) => {
      row[label] =
        key === "__latestDate__"
          ? fmtDate(r.latestDate)
          : r[key] != null
          ? r[key]
          : "-";
    });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

// ============================================================
// UPDATE DATA BUTTON
// ============================================================
function initUpdateBtn() {
  const updateBtn = document.getElementById("updateDataBtn");
  if (!updateBtn) return;
  updateBtn.addEventListener("click", function () {
    const status = document.getElementById("updateStatus");
    if (status) status.textContent = "Updating...";
    fetch("http://localhost:5000/run-dashboard-bat", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (status)
          status.textContent = data.success ? "Data updated!" : "Update failed.";
        setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      })
      .catch(() => {
        if (status) status.textContent = "Error updating data.";
        setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      });
  });
}

// ============================================================
// DOMContentLoaded — single consolidated listener
// ============================================================
document.addEventListener("DOMContentLoaded", function () {
  // Init update button
  initUpdateBtn();

  // Load rack info, then fetch server status & VM adware
  loadRackInfo().then(() => {
    fetchVmWiseAdware();
    // Server status auto-refresh every 60s
    fetchServerStatus();
    setInterval(fetchServerStatus, 60000);
  });

  // Load main data
  loadMainData();

  // Reports filter listeners (change for selects, input for text)
  document.getElementById("extensionFilter")
    ?.addEventListener("change", applyFilters);
  document.getElementById("networkFilter")
    ?.addEventListener("change", applyFilters);
  document.getElementById("searchBox")
    ?.addEventListener("input", applyFilters);
  document.getElementById("extensionIdNameBox")
    ?.addEventListener("input", applyFilters);

  // Brand filter listeners
  document.getElementById("brandSearchBox")
    ?.addEventListener("input", applyBrandFilters);

  // VM Adware listeners
  document.getElementById("vmFilter")
    ?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareExtensionFilter")
    ?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareSearchBox")
    ?.addEventListener("input", applyVmAdwareFilters);

  // ── EXCEL DOWNLOADS ────────────────────────────────────────

  // Reports
  document.getElementById("downloadExcelBtn")
    ?.addEventListener("click", () => {
      exportToExcel(
        state.filtered.length ? state.filtered : state.raw,
        [
          ["Incidence Id", "incidenceId"],
          ["Extension Id", "extensionId"],
          ["Extension Name", "extensionName"],
          ["Brand", "keyword"],
          ["Violation", "voilationTypeFLP"],
          ["Video File Path", "videoFilePath"],
          ["Screen Shot Path", "screenShotPath"],
          ["Network Log File Path", "networkLogFilePath"],
          ["Landing Url", "landingUrl"],
          ["Type", "type"],
          ["Landing Screenshot", "landingScreenshot"],
          ["Brand Url", "brandUrl"],
          ["Final Landing Url", "finalLandingUrl"],
          ["Redirection URL", "redirectionURL"],
          ["Redirection URL FLP", "redirectionURLFLP"],
          ["Networks", "networks"],
          ["Started Date", "automationStart"],
        ],
        "Records",
        "extension_records.xlsx"
      );
    });

  // Brand summary
  document.getElementById("downloadBrandExcelBtn")
    ?.addEventListener("click", () => {
      const data = state.filteredBrandData.length
        ? state.filteredBrandData
        : state.brandData;

      // Check whether we're showing the detail table
      const detailVisible =
        document.getElementById("brandDetailsSection")?.style.display !== "none";

      if (detailVisible && state.filteredBrandDetails.length) {
        exportToExcel(
          state.filteredBrandDetails,
          [
            ["Incidence Id", "incidenceId"],
            ["Extension Id", "extensionId"],
            ["Extension Name", "extensionName"],
            ["Brand", "keyword"],
            ["Violation", "voilationTypeFLP"],
            ["Networks", "networks"],
            ["Started Date", "automationStart"],
            ["Video File Path", "videoFilePath"],
            ["Network Log File Path", "networkLogFilePath"],
          ],
          "Brand Details",
          "brand_findings_details.xlsx"
        );
      } else {
        const ws = XLSX.utils.json_to_sheet(
          data.map((b) => ({
            Brand: b.brand,
            "Total Findings": b.totalFindings,
            "Unique Extensions": b.uniqueExtensions,
            "Latest Finding": fmtDate(b.latestDate),
          }))
        );
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Brand Summary");
        XLSX.writeFile(wb, "brand_summary.xlsx");
      }
    });

  // VM Adware
  document.getElementById("downloadVmAdwareExcelBtn")
    ?.addEventListener("click", () => {
      const dataToExport =
        state.filteredVmAdwareData.length
          ? state.filteredVmAdwareData
          : state.vmAdwareData;

      const exportData = dataToExport.map((r) => {
        const vmName = r.vmName || "Unknown";
        const loc = state.vmRackInfo[vmName.toLowerCase()] || "";
        return {
          "Extension ID": r.extensionId || "-",
          "Extension Name": r.extensionName || "-",
          "VM Name": vmName,
          Location: loc,
          Browser: r.browser || "-",
          "Created Date": r.createddate || "-",
        };
      });
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "VM Adware Data");
      XLSX.writeFile(wb, "vm_adware_report.xlsx");
    });
});