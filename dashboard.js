// Update Data Button Handler
document.addEventListener("DOMContentLoaded", function () {
  const updateBtn = document.getElementById("updateDataBtn");
  if (updateBtn) {
    updateBtn.addEventListener("click", function () {
      const status = document.getElementById("updateStatus");
      status.textContent = "Updating...";
      fetch("http://localhost:5000/run-dashboard-bat", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          status.textContent = data.success
            ? "Data updated!"
            : "Update failed.";
          setTimeout(() => (status.textContent = ""), 3000);
        })
        .catch(() => {
          status.textContent = "Error updating data.";
          setTimeout(() => (status.textContent = ""), 3000);
        });
    });
  }
});

let vmRackInfo = {};

function loadRackInfo() {
  return fetch("vm_rack_info.json?t=" + new Date().getTime())
    .then((res) => res.json())
    .then((data) => {
      Object.keys(data).forEach((key) => {
        vmRackInfo[key.toLowerCase()] = data[key];
      });
    })
    .catch((err) => console.error("Error loading rack info:", err));
}

function fetchServerStatus() {
  fetch("https://app2app.io/vptapi/Api/Task/GetRunningVm?VmId=0&TaskMasterId=0")
    .then((res) => res.json())
    .then((data) => {
      const list =
        data.data && data.data.vmMasterList ? data.data.vmMasterList : [];

      const renderVm = (vm) => {
        const name = vm.vmName || vm.vmId || "Unknown";
        const loc = vmRackInfo[name.toLowerCase()] || "";
        const locHtml = loc
          ? `<div style="font-size:14px;font-weight:medium;opacity:1.0;margin-top:2px;color:#0000b3;">${loc}</div>`
          : "";
        return `<span class="${vm.vmStatus === 1 ? "busy-server" : "free-server"}">${name}${locHtml}</span>`;
      };

      const busyServers = list.filter((vm) => vm.vmStatus === 1);
      const busyDiv = document.getElementById("busyServerStatus");
      busyDiv.innerHTML =
        busyServers.length === 0
          ? "No busy servers."
          : busyServers.map(renderVm).join(" ");

      const freeServers = list.filter((vm) => vm.vmStatus === 0);
      const freeDiv = document.getElementById("freeServerStatus");
      freeDiv.innerHTML =
        freeServers.length === 0
          ? "No free servers."
          : freeServers.map(renderVm).join(" ");
    })
    .catch(() => {
      document.getElementById("busyServerStatus").innerHTML =
        "Error loading busy server status.";
      document.getElementById("freeServerStatus").innerHTML =
        "Error loading free server status.";
    });
}

let rawData = [];
let brandData = [];

fetch("data.json?t=" + new Date().getTime())
  .then((res) => res.json())
  .then((data) => {
    rawData = data;
    rawData.sort(
      (a, b) => new Date(b.automationStart) - new Date(a.automationStart),
    );

    populateExtensionFilter(rawData);
    populateNetworkFilter(rawData);
    initializeDatePickers();
    updateDashboard(rawData);
    initializeBrandData(rawData);
  })
  .catch((err) => console.error("Error loading data:", err));

function populateExtensionFilter(data) {
  const select = document.getElementById("extensionFilter");
  const extSet = new Set();
  data.forEach((d) => extSet.add(d.extensionName));
  [...extSet].forEach((ext) => {
    const opt = document.createElement("option");
    opt.value = ext;
    opt.textContent = ext;
    select.appendChild(opt);
  });
}

function populateNetworkFilter(data) {
  const select = document.getElementById("networkFilter");
  const networks = new Set();
  data.forEach((d) => {
    if (d.networks) {
      d.networks.split(",").forEach((network) => networks.add(network.trim()));
    }
  });
  [...networks].sort().forEach((network) => {
    const opt = document.createElement("option");
    opt.value = network;
    opt.textContent = network;
    select.appendChild(opt);
  });
}

function initializeDatePickers() {
  const fromPicker = flatpickr("#fromDate", {
    dateFormat: "Y-m-d",
    onChange: () => applyFilters(),
  });
  const toPicker = flatpickr("#toDate", {
    dateFormat: "Y-m-d",
    onChange: () => applyFilters(),
  });

  document
    .getElementById("clearFromDate")
    .addEventListener("click", function () {
      document.getElementById("fromDate").value = "";
      fromPicker.clear();
      applyFilters();
    });
  document.getElementById("clearToDate").addEventListener("click", function () {
    document.getElementById("toDate").value = "";
    toPicker.clear();
    applyFilters();
  });

  const brandFromPicker = flatpickr("#brandFromDate", {
    dateFormat: "Y-m-d",
    onChange: () => applyBrandFilters(),
  });
  const brandToPicker = flatpickr("#brandToDate", {
    dateFormat: "Y-m-d",
    onChange: () => applyBrandFilters(),
  });

  document
    .getElementById("clearBrandFromDate")
    .addEventListener("click", function () {
      document.getElementById("brandFromDate").value = "";
      brandFromPicker.clear();
      applyBrandFilters();
    });
  document
    .getElementById("clearBrandToDate")
    .addEventListener("click", function () {
      document.getElementById("brandToDate").value = "";
      brandToPicker.clear();
      applyBrandFilters();
    });
}

function applyFilters() {
  const ext = document.getElementById("extensionFilter").value;
  const extIdName = document
    .getElementById("extensionIdNameBox")
    .value.trim()
    .toLowerCase();
  const network = document.getElementById("networkFilter").value;
  const from = document.getElementById("fromDate").value;
  const to = document.getElementById("toDate").value;
  const search = document.getElementById("searchBox").value.toLowerCase();

  let filtered = rawData;
  if (ext)
    filtered = filtered.filter(
      (d) => d.extensionName === ext || d.extensionId === ext,
    );
  if (extIdName)
    filtered = filtered.filter(
      (d) =>
        d.extensionName.toLowerCase().includes(extIdName) ||
        d.extensionId.toLowerCase().includes(extIdName),
    );
  if (network)
    filtered = filtered.filter((d) =>
      (d.networks || "").toLowerCase().includes(network.toLowerCase()),
    );
  if (from) filtered = filtered.filter((d) => d.automationStart >= from);
  if (to)
    filtered = filtered.filter((d) => d.automationStart <= to + "T23:59:59");
  if (search)
    filtered = filtered.filter(
      (d) =>
        (d.keyword || "").toLowerCase().includes(search) ||
        (d.voilationTypeFLP || "").toLowerCase().includes(search) ||
        (d.networks || "").toLowerCase().includes(search) ||
        (d.incidenceId && d.incidenceId.toString().includes(search)),
    );

  updateDashboard(filtered);
}

function updateDashboard(data) {
  document.getElementById("totalRecords").innerText = data.length;
  document.getElementById("uniqueExtensions").innerText = new Set(
    data.map((d) => d.extensionId),
  ).size;
  document.getElementById("uniqueBrands").innerText = new Set(
    data.map((d) => (d.keyword || "Unknown").toLowerCase()),
  ).size;
  document.getElementById("latestDate").innerText = data.length
    ? data[0].automationStart.split("T")[0]
    : "-";
  window.lastFilteredData = data;

  const tbody = document.querySelector("#dataTable tbody");
  tbody.innerHTML = "";
  data.forEach((r) => {
    const tr = document.createElement("tr");
    let incidentCell = `<div><b>${r.incidenceId || "-"}</b></div>`;
    incidentCell += `<div style='font-size:12px;color:#888;'>${r.automationStart ? r.automationStart.split("T")[0] : "-"}</div>`;
    tr.innerHTML = `
      <td>${incidentCell}</td>
      <td>${renderExtensionName(r.extensionName, r.extensionId)}</td>
      <td>${r.keyword || "-"}</td>
      <td>${r.voilationTypeFLP || "-"}</td>
      <td>${r.networks || "-"}</td>
      <td><a href="${r.videoFilePath}" target="_blank">View</a></td>
      <td><a href="https://app2app.io/sazviewer/?url=${r.networkLogFilePath}" target="_blank">View</a></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderExtensionName(name, id) {
  if (!name) return "";
  return `${name}<br><span style='font-size:12px;color:#888;'>${id || ""}</span>`;
}

["extensionFilter", "networkFilter", "searchBox", "extensionIdNameBox"].forEach(
  (id) => document.getElementById(id).addEventListener("input", applyFilters),
);

window.addEventListener("DOMContentLoaded", function () {
  document
    .getElementById("downloadExcelBtn")
    ?.addEventListener("click", function () {
      const filtered = window.lastFilteredData || rawData;
      const exportData = filtered.map((r) => ({
        "Incidence Id": r.incidenceId || "-",
        "Extension Id": r.extensionId || "-",
        "Extension Name": r.extensionName || "-",
        Brand: r.keyword || "-",
        Violation: r.voilationTypeFLP || "-",
        "Video File Path": r.videoFilePath || "-",
        "Screen Shot Path": r.screenShotPath || "-",
        "Network Log File Path": r.networkLogFilePath || "-",
        "Landing Url": r.landingUrl || "-",
        Type: r.type || "-",
        "Landing Screenshot": r.landingScreenshot || "-",
        "Brand Url": r.brandUrl || "-",
        "Final Landing Url": r.finalLandingUrl || "-",
        "Redirection URL": r.redirectionURL || "-",
        "Redirection URL FLP": r.redirectionURLFLP || "-",
        Networks: r.networks || "-",
        "Started Date": r.automationStart || "-",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Records");
      XLSX.writeFile(wb, "extension_records.xlsx");
    });
});

function switchTab(viewId, tabElement) {
  document
    .querySelectorAll(".view-content")
    .forEach((el) => (el.style.display = "none"));
  document.getElementById("view-" + viewId).style.display = "block";
  document
    .querySelectorAll(".nav-tab")
    .forEach((el) => el.classList.remove("active"));
  tabElement.classList.add("active");
}

// BRAND MANAGEMENT
function initializeBrandData(data) {
  const brandMap = {};
  data.forEach((record) => {
    const brand = (record.keyword || "Unknown").toLowerCase();
    if (!brandMap[brand]) {
      brandMap[brand] = {
        brand: brand,
        findings: [],
        extensionIds: new Set(),
        latestDate: record.automationStart,
      };
    }
    brandMap[brand].findings.push(record);
    brandMap[brand].extensionIds.add(record.extensionId);
    if (record.automationStart > brandMap[brand].latestDate) {
      brandMap[brand].latestDate = record.automationStart;
    }
  });

  brandData = Object.values(brandMap).map((item) => ({
    brand: item.brand,
    totalFindings: item.findings.length,
    uniqueExtensions: item.extensionIds.size,
    latestDate: item.latestDate,
    findings: item.findings,
  }));

  brandData.sort((a, b) => b.totalFindings - a.totalFindings);
  populateBrandFilters(brandData);
  updateBrandKPIs(brandData);
  updateBrandSummaryTable(brandData);
}

function populateBrandFilters(data) {
  const brandSelect = document.getElementById("brandFilter");
  const extensionSelect = document.getElementById("brandExtensionFilter");
  const networkSelect = document.getElementById("brandNetworkFilter");

  if (brandSelect) {
    [...new Set(data.map((d) => d.brand))].sort().forEach((brand) => {
      const opt = document.createElement("option");
      opt.value = brand;
      opt.textContent = brand;
      brandSelect.appendChild(opt);
    });
    brandSelect.addEventListener("change", onBrandSelected);
  }

  if (extensionSelect) {
    const extensions = new Set();
    data.forEach((item) =>
      item.findings.forEach((f) => extensions.add(f.extensionName)),
    );
    [...extensions].sort().forEach((ext) => {
      const opt = document.createElement("option");
      opt.value = ext;
      opt.textContent = ext;
      extensionSelect.appendChild(opt);
    });
  }

  if (networkSelect) {
    const networks = new Set();
    data.forEach((item) => {
      item.findings.forEach((f) => {
        if (f.networks)
          f.networks.split(",").forEach((n) => networks.add(n.trim()));
      });
    });
    [...networks].sort().forEach((network) => {
      const opt = document.createElement("option");
      opt.value = network;
      opt.textContent = network;
      networkSelect.appendChild(opt);
    });
  }

  ["brandExtensionFilter", "brandNetworkFilter", "brandSearchBox"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", applyBrandFilters);
    },
  );
}

function updateBrandKPIs(data) {
  document.getElementById("totalBrands").innerText = data.length;
  const totalFindings = data.reduce((sum, item) => sum + item.totalFindings, 0);
  document.getElementById("totalBrandFindings").innerText = totalFindings;
  const avgFindings =
    data.length > 0 ? (totalFindings / data.length).toFixed(1) : "0";
  document.getElementById("avgFindingsPerBrand").innerText = avgFindings;
}

function updateBrandSummaryTable(data) {
  const tbody = document.querySelector("#brandTable tbody");
  tbody.innerHTML = "";
  window.lastFilteredBrandData = data;
  document.getElementById("brandTableSubtitle").innerText =
    `Showing ${data.length} brands`;

  const brandFilter = document.getElementById("brandFilter");

  data.forEach((item) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    if (brandFilter) {
      tr.onclick = () => {
        document.getElementById("brandFilter").value = item.brand;
        onBrandSelected();
      };
    }
    tr.innerHTML = `
      <td><b>${item.brand}</b></td>
      <td><span class="badge">${item.totalFindings}</span></td>
      <td>${item.uniqueExtensions}</td>
      <td>${item.latestDate.split("T")[0]}</td>
    `;
    tbody.appendChild(tr);
  });
}

function onBrandSelected() {
  const brandFilter = document.getElementById("brandFilter");
  const detailsSection = document.getElementById("brandDetailsSection");
  const summaryTable = document.getElementById("brandTable");
  const searchBox = document.getElementById("brandSearchBox");

  if (!brandFilter) return;

  const selectedBrand = brandFilter.value;
  if (!selectedBrand) {
    if (detailsSection) detailsSection.style.display = "none";
    if (summaryTable) summaryTable.style.display = "";
    applyBrandFilters();
    return;
  }
  if (searchBox) searchBox.value = "";
  if (detailsSection) detailsSection.style.display = "block";
  if (summaryTable) summaryTable.style.display = "none";
  applyBrandFilters();
}

function applyBrandFilters() {
  const brandFilter = document.getElementById("brandFilter");
  const extFilter = document.getElementById("brandExtensionFilter");
  const netFilter = document.getElementById("brandNetworkFilter");
  const fromDate = document.getElementById("brandFromDate");
  const toDate = document.getElementById("brandToDate");
  const searchBox = document.getElementById("brandSearchBox");

  const selectedBrand = brandFilter ? brandFilter.value : "";
  const selectedExt = extFilter ? extFilter.value : "";
  const selectedNetwork = netFilter ? netFilter.value : "";
  const from = fromDate ? fromDate.value : "";
  const to = toDate ? toDate.value : "";
  const search = searchBox ? searchBox.value.toLowerCase() : "";

  let filtered = [...brandData];

  if (!selectedBrand) {
    // Recalculate stats based on filters for Summary View
    filtered = brandData
      .map((item) => {
        let validFindings = item.findings;
        if (selectedExt)
          validFindings = validFindings.filter(
            (f) => f.extensionName === selectedExt,
          );
        if (selectedNetwork)
          validFindings = validFindings.filter((f) =>
            (f.networks || "")
              .toLowerCase()
              .includes(selectedNetwork.toLowerCase()),
          );
        if (from)
          validFindings = validFindings.filter(
            (f) => f.automationStart >= from,
          );
        if (to)
          validFindings = validFindings.filter(
            (f) => f.automationStart <= to + "T23:59:59",
          );

        return {
          brand: item.brand,
          findings: validFindings,
          totalFindings: validFindings.length,
          uniqueExtensions: new Set(validFindings.map((f) => f.extensionId))
            .size,
          latestDate: validFindings.length
            ? validFindings.reduce(
                (max, f) =>
                  (f.automationStart || "") > max
                    ? f.automationStart || ""
                    : max,
                "",
              )
            : "",
        };
      })
      .filter((item) => item.totalFindings > 0);

    if (search)
      filtered = filtered.filter((item) =>
        item.brand.toLowerCase().includes(search),
      );

    filtered.sort((a, b) => b.totalFindings - a.totalFindings);
    updateBrandSummaryTable(filtered);
    updateBrandKPIs(filtered);
    document.getElementById("brandDetailsSection").style.display = "none";
    if (document.getElementById("brandTable")) document.getElementById("brandTable").style.display = "";
  } else {
    const brandItem = brandData.find((item) => item.brand === selectedBrand);
    if (brandItem) {
      let findings = [...brandItem.findings];
      if (selectedExt)
        findings = findings.filter((f) => f.extensionName === selectedExt);
      if (selectedNetwork)
        findings = findings.filter((f) =>
          (f.networks || "")
            .toLowerCase()
            .includes(selectedNetwork.toLowerCase()),
        );
      if (from) findings = findings.filter((f) => f.automationStart >= from);
      if (to)
        findings = findings.filter(
          (f) => f.automationStart <= to + "T23:59:59",
        );
      if (search)
        findings = findings.filter(
          (f) =>
            (f.extensionName || "").toLowerCase().includes(search) ||
            (f.extensionId || "").toLowerCase().includes(search) ||
            (f.voilationTypeFLP || "").toLowerCase().includes(search),
        );
      updateBrandDetailsTable(selectedBrand, findings);
    }
  }
}

function updateBrandDetailsTable(brandName, findings) {
  const tbody = document.querySelector("#brandDetailsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  window.lastFilteredBrandDetails = findings;
  const uniqueExts = new Set(findings.map((f) => f.extensionId)).size;
  const infoEl = document.getElementById("brandDetailInfo");
  if (infoEl)
    infoEl.innerText = `${brandName}: ${findings.length} findings across ${uniqueExts} extensions`;

  findings.forEach((r) => {
    const tr = document.createElement("tr");
    let incidentCell = `<div><b>${r.incidenceId || "-"}</b></div>`;
    incidentCell += `<div style='font-size:12px;color:#888;'>${r.automationStart ? r.automationStart.split("T")[0] : "-"}</div>`;
    tr.innerHTML = `
      <td>${incidentCell}</td>
      <td>${renderExtensionName(r.extensionName, r.extensionId)}</td>
      <td>${r.voilationTypeFLP || "-"}</td>
      <td>${r.networks || "-"}</td>
      <td><a href="${r.videoFilePath}" target="_blank">View</a></td>
      <td><a href="https://app2app.io/sazviewer/?url=${r.networkLogFilePath}" target="_blank">View</a></td>
    `;
    tbody.appendChild(tr);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("downloadBrandExcelBtn")
    ?.addEventListener("click", function () {
      const data = window.lastFilteredBrandData || brandData;
      const exportData = data.map((item) => ({
        Brand: item.brand,
        "Total Findings": item.totalFindings,
        "Unique Extensions": item.uniqueExtensions,
        "Latest Date": item.latestDate.split("T")[0],
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Brand Summary");
      XLSX.writeFile(wb, "brand_summary.xlsx");
    });

  document
    .getElementById("downloadBrandDetailsExcelBtn")
    ?.addEventListener("click", function () {
      const findings = window.lastFilteredBrandDetails || [];
      const exportData = findings.map((r) => ({
        "Incidence Id": r.incidenceId || "-",
        "Extension Id": r.extensionId || "-",
        "Extension Name": r.extensionName || "-",
        Brand: r.keyword || "-",
        Violation: r.voilationTypeFLP || "-",
        Network: r.networks || "-",
        "Video File Path": r.videoFilePath || "-",
        "Network Log File Path": r.networkLogFilePath || "-",
        "Started Date": r.automationStart || "-",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Brand Details");
      XLSX.writeFile(wb, "brand_findings_details.xlsx");
    });
});

let vmAdwareData = [];
function fetchVmWiseAdware() {
  fetch("https://app2app.io/vptapi/Api/Master/GetvmWiseAdware")
    .then((res) => res.json())
    .then((data) => {
      if (data && data.data && data.data.list) {
        vmAdwareData = data.data.list;
        populateVmFilter(vmAdwareData);
        populateVmAdwareExtensionFilter(vmAdwareData);
        updateVmAdwareTable(vmAdwareData);
      }
    })
    .catch((err) => console.error("Error loading VM Adware data:", err));
}

function populateVmAdwareExtensionFilter(data) {
  const select = document.getElementById("vmAdwareExtensionFilter");
  if (!select) return;
  const extSet = new Set();
  data.forEach((item) => {
    if (item.extensionName) extSet.add(item.extensionName);
  });
  select.innerHTML = '<option value="">All Extensions</option>';
  [...extSet].sort().forEach((ext) => {
    const opt = document.createElement("option");
    opt.value = ext;
    opt.textContent = ext;
    select.appendChild(opt);
  });
}

function populateVmFilter(data) {
  const select = document.getElementById("vmFilter");
  if (!select) return;
  const vmSet = new Set();
  data.forEach((item) => {
    if (item.vmName) vmSet.add(item.vmName);
  });
  select.innerHTML = '<option value="">All VMs</option>';
  [...vmSet].sort().forEach((vm) => {
    const opt = document.createElement("option");
    opt.value = vm;
    opt.textContent = vm;
    select.appendChild(opt);
  });
}

function applyVmAdwareFilters() {
  const selectedVm = document.getElementById("vmFilter").value;
  const selectedExt = document.getElementById("vmAdwareExtensionFilter").value;
  const searchTerm = document
    .getElementById("vmAdwareSearchBox")
    .value.trim()
    .toLowerCase();
  let filtered = vmAdwareData;
  if (selectedVm) filtered = filtered.filter((d) => d.vmName === selectedVm);
  if (selectedExt)
    filtered = filtered.filter((d) => d.extensionName === selectedExt);
  if (searchTerm)
    filtered = filtered.filter(
      (d) =>
        (d.extensionName || "").toLowerCase().includes(searchTerm) ||
        (d.extensionId || "").toLowerCase().includes(searchTerm),
    );
  updateVmAdwareTable(filtered);
}

function updateVmAdwareTable(data) {
  window.lastFilteredVmAdwareData = data;
  const tbody = document.querySelector("#vmAdwareTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  data.forEach((r) => {
    const tr = document.createElement("tr");
    const dateStr = r.createddate ? r.createddate.split(" ")[0] : "-";
    const vmName = r.vmName || "Unknown";
    const loc = vmRackInfo[vmName.toLowerCase()] || "";
    const vmDisplay = loc ? `${vmName} - ${loc}` : vmName;
    tr.innerHTML = `
      <td>${r.extensionId || "-"}</td>
      <td>${r.extensionName || "-"}<br><span style='font-size:12px;color:#64ffda;'>${vmDisplay}</span></td>
      <td>${r.browser || "-"}</td>
      <td>${dateStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  loadRackInfo().then(() => {
    fetchServerStatus();
    fetchVmWiseAdware();
  });
  document
    .getElementById("vmFilter")
    ?.addEventListener("change", applyVmAdwareFilters);
  document
    .getElementById("vmAdwareExtensionFilter")
    ?.addEventListener("change", applyVmAdwareFilters);
  document
    .getElementById("vmAdwareSearchBox")
    ?.addEventListener("input", applyVmAdwareFilters);
  document
    .getElementById("downloadVmAdwareExcelBtn")
    ?.addEventListener("click", function () {
      const dataToExport = window.lastFilteredVmAdwareData || vmAdwareData;
      const exportData = dataToExport.map((r) => {
        const vmName = r.vmName || "Unknown";
        const loc = vmRackInfo[vmName.toLowerCase()] || "";
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

["extensionFilter", "networkFilter", "searchBox", "extensionIdNameBox"].forEach(
  (id) => document.getElementById(id).addEventListener("input", applyFilters),
);

["brandFilter", "brandSearchBox"].forEach((id) => {
  const elem = document.getElementById(id);
  if (elem) elem.addEventListener("input", applyBrandFilters);
});

window.addEventListener("DOMContentLoaded", function () {
  const downloadBtn = document.getElementById("downloadExcelBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      let filtered = [];
      if (
        typeof window.lastFilteredData === "object" &&
        Array.isArray(window.lastFilteredData)
      ) {
        filtered = window.lastFilteredData;
      } else {
        filtered = rawData;
      }
      const exportData = filtered.map((r) => ({
        "Incidence Id": r.incidenceId || "-",
        "Extension Id": r.extensionId || "-",
        "Extension Name": r.extensionName || "-",
        Brand: r.keyword || "-",
        Violation: r.voilationTypeFLP || "-",
        "Video File Path": r.videoFilePath || "-",
        "Screen Shot Path": r.screenShotPath || "-",
        "Network Log File Path": r.networkLogFilePath || "-",
        "Landing Url": r.landingUrl || "-",
        Type: r.type || "-",
        "Landing Screenshot": r.landingScreenshot || "-",
        "Brand Url": r.brandUrl || "-",
        "Final Landing Url": r.finalLandingUrl || "-",
        "Redirection URL": r.redirectionURL || "-",
        "Redirection URL FLP": r.redirectionURLFLP || "-",
        Networks: r.networks || "-",
        "Started Date": r.automationStart || "-",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Records");
      XLSX.writeFile(wb, "extension_records.xlsx");
    });
  }

  const downloadBrandBtn = document.getElementById("downloadBrandExcelBtn");
  if (downloadBrandBtn) {
    downloadBrandBtn.addEventListener("click", function () {
      const brandData = window.lastFilteredBrandData || [];

      let exportData;
      if (brandData.length > 0 && brandData[0].incidenceId) {
        exportData = brandData.map((r) => ({
          "Incidence Id": r.incidenceId || "-",
          "Extension Id": r.extensionId || "-",
          "Extension Name": r.extensionName || "-",
          Brand: r.keyword || "-",
          Violation: r.voilationTypeFLP || "-",
          Networks: r.networks || "-",
          "Started Date": r.automationStart || "-",
          "Video File Path": r.videoFilePath || "-",
          "Network Log File Path": r.networkLogFilePath || "-",
        }));
      } else {
        exportData = brandData.map((b) => ({
          Brand: b.brand,
          "Total Findings": b.count,
          "Unique Extensions": b.extensions.size,
          "Latest Finding": b.latestDate.split("T")[0],
        }));
      }

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Brand Data");
      XLSX.writeFile(wb, "brand_findings.xlsx");
    });
  }
});
