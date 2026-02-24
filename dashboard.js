// Update Data Button Handler
document.addEventListener("DOMContentLoaded", function() {
  const updateBtn = document.getElementById("updateDataBtn");
  if (updateBtn) {
    updateBtn.addEventListener("click", function() {
      const status = document.getElementById("updateStatus");
      status.textContent = "Updating...";
      fetch("http://localhost:5000/run-dashboard-bat", { method: "POST" })
        .then(res => res.json())   
        .then(data => {
          status.textContent = data.success ? "Data updated!" : "Update failed.";
          setTimeout(() => status.textContent = "", 3000);
        })
        .catch(() => {
          status.textContent = "Error updating data.";
          setTimeout(() => status.textContent = "", 3000);
        });
    });
  }
});

let vmRackInfo = {};

function loadRackInfo() {
  return fetch("vm_rack_info.json?t=" + new Date().getTime())
    .then(res => res.json())
    .then(data => {
      // Normalize keys to lowercase for case-insensitive lookup
      Object.keys(data).forEach(key => {
        vmRackInfo[key.toLowerCase()] = data[key];
      });
    })
    .catch(err => console.error("Error loading rack info:", err));
}

// Fetch and display busy and free servers
function fetchServerStatus() {
  fetch("https://app2app.io/vptapi/Api/Task/GetRunningVm?VmId=0&TaskMasterId=0")
    .then(res => res.json())
    .then(data => {
      const list = (data.data && data.data.vmMasterList ? data.data.vmMasterList : []);
      
      const renderVm = (vm) => {
        const name = vm.vmName || vm.vmId || "Unknown";
        const loc = vmRackInfo[name.toLowerCase()] || "";
        const locHtml = loc ? `<div style="font-size:14px;font-weight:medium;opacity:1.0;margin-top:2px;color:#0000b3;">${loc}</div>` : "";
        return `<span class="${vm.vmStatus === 1 ? 'busy-server' : 'free-server'}">${name}${locHtml}</span>`;
      };

      // Busy
      const busyServers = list.filter(vm => vm.vmStatus === 1);
      const busyDiv = document.getElementById("busyServerStatus");
      if (busyServers.length === 0) {
        busyDiv.innerHTML = "No busy servers.";
      } else {
        busyDiv.innerHTML = busyServers.map(renderVm).join(" ");
      }
      // Free
      const freeServers = list.filter(vm => vm.vmStatus === 0);
      const freeDiv = document.getElementById("freeServerStatus");
      if (freeServers.length === 0) {
        freeDiv.innerHTML = "No free servers.";
      } else {
        freeDiv.innerHTML = freeServers.map(renderVm).join(" ");
      }
    })
    .catch(() => {
      document.getElementById("busyServerStatus").innerHTML = "Error loading busy server status.";
      document.getElementById("freeServerStatus").innerHTML = "Error loading free server status.";
    });
}

let rawData = [];

fetch("data.json?t=" + new Date().getTime())
  .then(res => res.json())
  .then(data => {
    rawData = data;

    // newest first
    rawData.sort((a, b) =>
      new Date(b.automationStart) - new Date(a.automationStart)
    );

    populateExtensionFilter(rawData);
    populateNetworkFilter(rawData);
    initializeDatePickers();
    updateDashboard(rawData);
  })
  .catch(err => {
    console.error("Error loading data:", err);
    // For demo purposes, you can add sample data here if needed
  });

function populateExtensionFilter(data) {
  const select = document.getElementById("extensionFilter");
  // Add both extension names and IDs to filter
  const extSet = new Set();
  data.forEach(d => {
    extSet.add(d.extensionName);
  });
  [...extSet].forEach(ext => {
    const opt = document.createElement("option");
    opt.value = ext;
    opt.textContent = ext;
    select.appendChild(opt);
  });
}

function populateNetworkFilter(data) {
  const select = document.getElementById("networkFilter");
  const networks = new Set();
  
  data.forEach(d => {
    if (d.networks) {
      // Split by comma if multiple networks
      d.networks.split(',').forEach(network => {
        networks.add(network.trim());
      });
    }
  });
  
  [...networks].sort().forEach(network => {
    const opt = document.createElement("option");
    opt.value = network;
    opt.textContent = network;
    select.appendChild(opt);
  });
}

function initializeDatePickers() {
  // Initialize From Date picker
  const fromPicker = flatpickr("#fromDate", {
    dateFormat: "Y-m-d",
    onChange: function(selectedDates, dateStr, instance) {
      applyFilters();
    }
  });

  // Initialize To Date picker
  const toPicker = flatpickr("#toDate", {
    dateFormat: "Y-m-d",
    onChange: function(selectedDates, dateStr, instance) {
      applyFilters();
    }
  });

  // Add clear/cross icon functionality
  document.getElementById("clearFromDate").addEventListener("click", function() {
    document.getElementById("fromDate").value = "";
    fromPicker.clear();
    applyFilters();
  });
  document.getElementById("clearToDate").addEventListener("click", function() {
    document.getElementById("toDate").value = "";
    toPicker.clear();
    applyFilters();
  });
}

function applyFilters() {
  const ext = document.getElementById("extensionFilter").value;
  const extIdName = document.getElementById("extensionIdNameBox").value.trim().toLowerCase();
  const network = document.getElementById("networkFilter").value;
  const from = document.getElementById("fromDate").value;
  const to = document.getElementById("toDate").value;
  const search = document.getElementById("searchBox").value.toLowerCase();

  let filtered = rawData;

  if (ext)
    filtered = filtered.filter(d => d.extensionName === ext || d.extensionId === ext);

  if (extIdName) {
    filtered = filtered.filter(d =>
      d.extensionName.toLowerCase().includes(extIdName) ||
      d.extensionId.toLowerCase().includes(extIdName)
    );
  }

  if (network)
    filtered = filtered.filter(d => 
      (d.networks || "").toLowerCase().includes(network.toLowerCase())
    );

  if (from)
    filtered = filtered.filter(d => d.automationStart >= from);

  if (to)
    filtered = filtered.filter(d => d.automationStart <= to + "T23:59:59");

  if (search)
    filtered = filtered.filter(d =>
      (d.keyword || "").toLowerCase().includes(search) ||
      (d.voilationTypeFLP || "").toLowerCase().includes(search) ||
      (d.networks || "").toLowerCase().includes(search) ||
      (d.incidenceId && d.incidenceId.toString().includes(search))
    );

  updateDashboard(filtered);
}

function updateDashboard(data) {
  // KPI
  document.getElementById("totalRecords").innerText = data.length;

  document.getElementById("uniqueExtensions").innerText =
    new Set(data.map(d => d.extensionId)).size;

  document.getElementById("latestDate").innerText =
    data.length ? data[0].automationStart.split("T")[0] : "-";

  // Store filtered data for Excel export
  window.lastFilteredData = data;

  // TABLE
  const tbody = document.querySelector("#dataTable tbody");
  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    // Incident cell: ID and Date only
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

  // No show more/less for extension names; always show full name
}

// Helper to render extension name with show more/less
function renderExtensionName(name, id) {
  if (!name) return '';
  // Always show full name and ID
  return `${name}<br><span style='font-size:12px;color:#888;'>${id || ''}</span>`;
}

// FILTER EVENTS
// Add filter events for new extensionId/name box
["extensionFilter", "networkFilter", "searchBox", "extensionIdNameBox"]
  .forEach(id => document.getElementById(id).addEventListener("input", applyFilters));

// Download Excel functionality using SheetJS
window.addEventListener("DOMContentLoaded", function() {
  const downloadBtn = document.getElementById("downloadExcelBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function() {
      // Get the filtered data currently shown in the table
      let filtered = [];
      if (typeof window.lastFilteredData === 'object' && Array.isArray(window.lastFilteredData)) {
        filtered = window.lastFilteredData;
      } else {
        filtered = rawData;
      }
      // Build export array, each value in its own column, no separate date column
      const exportData = filtered.map(r => ({
        "Incidence Id": r.incidenceId || "-",
        "Extension Id": r.extensionId || "-",
        "Extension Name": r.extensionName || "-",
        "Brand": r.keyword || "-",
        "Violation": r.voilationTypeFLP || "-",
        "Video File Path": r.videoFilePath || "-",
        "Screen Shot Path": r.screenShotPath || "-",
        "Network Log File Path": r.networkLogFilePath || "-",
        "Landing Url": r.landingUrl || "-",
        "Type": r.type || "-",
        "Landing Screenshot": r.landingScreenshot || "-",
        "Brand Url": r.brandUrl || "-",
        "Final Landing Url": r.finalLandingUrl || "-",
        "Redirection URL": r.redirectionURL || "-",
        "Redirection URL FLP": r.redirectionURLFLP || "-",
        "Networks": r.networks || "-",
        "Started Date": r.automationStart || "-"
      }));
      // Remove Date column from export (merge with Incident for display, but keep for Excel clarity)
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Records");
      XLSX.writeFile(wb, "extension_records.xlsx");
    });
  }
});

// Tab Switching Logic
function switchTab(viewId, tabElement) {
  // Hide all views
  document.querySelectorAll('.view-content').forEach(el => {
    el.style.display = 'none';
  });
  
  // Show selected view
  document.getElementById('view-' + viewId).style.display = 'block';
  
  // Update tab classes
  document.querySelectorAll('.nav-tab').forEach(el => {
    el.classList.remove('active');
  });
  tabElement.classList.add('active');
}

// VM Wise Adware Logic
let vmAdwareData = [];

function fetchVmWiseAdware() {
  fetch("https://app2app.io/vptapi/Api/Master/GetvmWiseAdware")
    .then(res => res.json())
    .then(data => {
      if (data && data.data && data.data.list) {
        vmAdwareData = data.data.list;
        populateVmFilter(vmAdwareData);
        populateVmAdwareExtensionFilter(vmAdwareData);
        updateVmAdwareTable(vmAdwareData);
      } 
    })
    .catch(err => {
      console.error("Error loading VM Adware data:", err);
    });
}

function populateVmAdwareExtensionFilter(data) {
  const select = document.getElementById("vmAdwareExtensionFilter");
  if (!select) return;
  
  const extSet = new Set();
  data.forEach(item => {
    if (item.extensionName) extSet.add(item.extensionName);
  });

  // Clear existing options except the first one
  select.innerHTML = '<option value="">All Extensions</option>';

  [...extSet].sort().forEach(ext => {
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
  data.forEach(item => {
    if (item.vmName) vmSet.add(item.vmName);
  });

  // Clear existing options except the first one
  select.innerHTML = '<option value="">All VMs</option>';

  [...vmSet].sort().forEach(vm => {
    const opt = document.createElement("option");
    opt.value = vm;
    opt.textContent = vm;
    select.appendChild(opt);
  });
}

function applyVmAdwareFilters() {
  const selectedVm = document.getElementById("vmFilter").value;
  const selectedExt = document.getElementById("vmAdwareExtensionFilter").value;
  const searchTerm = document.getElementById("vmAdwareSearchBox").value.trim().toLowerCase();

  let filtered = vmAdwareData;

  if (selectedVm) {
    filtered = filtered.filter(d => d.vmName === selectedVm);
  }

  if (selectedExt) {
    filtered = filtered.filter(d => d.extensionName === selectedExt);
  }

  if (searchTerm) {
    filtered = filtered.filter(d => 
      (d.extensionName || "").toLowerCase().includes(searchTerm) ||
      (d.extensionId || "").toLowerCase().includes(searchTerm)
    );
  }

  updateVmAdwareTable(filtered);
}

function updateVmAdwareTable(data) {
  window.lastFilteredVmAdwareData = data;
  const tbody = document.querySelector("#vmAdwareTable tbody");
  if (!tbody) return;
  
  tbody.innerHTML = "";

  data.forEach(r => {
    const tr = document.createElement("tr");
    // Format date to show only date part if it contains time
    const dateStr = r.createddate ? r.createddate.split(' ')[0] : "-";
    const vmName = r.vmName || 'Unknown';
    const loc = vmRackInfo[vmName.toLowerCase()] || '';
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

  document.getElementById("vmFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareExtensionFilter")?.addEventListener("change", applyVmAdwareFilters);
  document.getElementById("vmAdwareSearchBox")?.addEventListener("input", applyVmAdwareFilters);

  document.getElementById("downloadVmAdwareExcelBtn")?.addEventListener("click", function() {
    const dataToExport = window.lastFilteredVmAdwareData || vmAdwareData;
    
    const exportData = dataToExport.map(r => {
      const vmName = r.vmName || 'Unknown';
      const loc = vmRackInfo[vmName.toLowerCase()] || '';
      
      return {
        "Extension ID": r.extensionId || "-",
        "Extension Name": r.extensionName || "-",
        "VM Name": vmName,
        "Location": loc,
        "Browser": r.browser || "-",
        "Created Date": r.createddate || "-"
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VM Adware Data");
    XLSX.writeFile(wb, "vm_adware_report.xlsx");
  });
});