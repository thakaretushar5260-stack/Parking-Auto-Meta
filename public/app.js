// Smart Parking Auto-meta - Client Application Logic

// Configurable Render URL placeholder (blank as requested, uses current origin)
const RENDER_URL = ""; 
const API_BASE = RENDER_URL ? RENDER_URL.replace(/\/$/, '') : window.location.origin;

// Application State
const state = {
  isLoggedIn: false, // User must log in first!
  currentUser: {
    id: "USR-001",
    name: "Vaibhav",
    rfidId: "83A14F9B",
    vehicleNo: "MH-31-EQ-4092",
    contact: "+91 98230 11223"
  },
  currentView: "dashboard",
  theme: localStorage.getItem("parking_theme") || "dark",
  userLocation: { lat: 21.2335, lng: 78.9667 }, // Default: SB Jain Campus, Nagpur
  stations: [],
  selectedStationId: "STN-SBJAIN",
  slots: [],
  activeSession: null,
  hardwareState: {
    gateStatus: "CLOSED",
    barrierAngle: 0,
    lcdData: { r1: "Smart Parking", r2: "Auto - Meta" }
  },
  historyPage: 1
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initEventListeners();
  loadSavedUser();

  // Check login state: show login screen first unless actively authenticated in session
  const sessionAuth = sessionStorage.getItem("parking_logged_in");
  if (sessionAuth === "true") {
    state.isLoggedIn = true;
    showMainApp();
    fetchDashboardData();
  } else {
    state.isLoggedIn = false;
    showLoginView();
  }

  // Periodic Real-Time Sync (every 3 seconds when logged in)
  setInterval(() => {
    pollHardware();
    if (state.isLoggedIn) {
      fetchDashboardData(false); // silent update
    }
  }, 3000);

  // Live Clock
  setInterval(updateLiveClock, 1000);
  updateLiveClock();
});

// ==========================================
// THEME MANAGEMENT
// ==========================================
function initTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  updateThemeIcon();
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("parking_theme", state.theme);
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.getElementById("theme-toggle-icon");
  if (!icon) return;
  if (state.theme === "dark") {
    icon.className = "fa-solid fa-sun text-amber-400 text-lg";
  } else {
    icon.className = "fa-solid fa-moon text-slate-700 text-lg";
  }
}

// ==========================================
// AUTHENTICATION & LOGIN FLOW (PAGE 1)
// ==========================================
function showLoginView() {
  const loginView = document.getElementById("view-login");
  const mainApp = document.getElementById("main-app-container");
  const navTabs = document.getElementById("header-nav-tabs");
  const userSection = document.getElementById("header-user-section");
  const mobileNav = document.getElementById("mobile-nav-bar");

  if (loginView) loginView.classList.remove("hidden");
  if (mainApp) mainApp.classList.add("hidden");
  if (navTabs) navTabs.classList.add("hidden");
  if (userSection) userSection.classList.add("hidden");
  if (mobileNav) mobileNav.classList.add("hidden");

  loadScreenProfiles();
}

function showMainApp() {
  const loginView = document.getElementById("view-login");
  const mainApp = document.getElementById("main-app-container");
  const navTabs = document.getElementById("header-nav-tabs");
  const userSection = document.getElementById("header-user-section");
  const mobileNav = document.getElementById("mobile-nav-bar");

  if (loginView) loginView.classList.add("hidden");
  if (mainApp) mainApp.classList.remove("hidden");
  if (navTabs) navTabs.classList.remove("hidden");
  if (userSection) userSection.classList.remove("hidden");
  if (mobileNav) mobileNav.classList.remove("hidden");

  updateUserUI();
  switchView("dashboard");
}

function showDashboardIfLoggedIn() {
  if (state.isLoggedIn) {
    switchView("dashboard");
  } else {
    showLoginView();
  }
}

function loadSavedUser() {
  const saved = localStorage.getItem("parking_user");
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
}

function updateUserUI() {
  const greetingEl = document.getElementById("user-greeting");
  const avatarEl = document.getElementById("user-avatar");
  const rfidEl = document.getElementById("user-rfid-preview");

  if (greetingEl) greetingEl.textContent = `Welcome ${state.currentUser.name}`;
  if (avatarEl) avatarEl.textContent = state.currentUser.name.charAt(0).toUpperCase();
  if (rfidEl) rfidEl.textContent = `RFID: ${state.currentUser.rfidId}`;
}

async function loadScreenProfiles() {
  const container = document.getElementById("login-quick-profiles");
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/api/users`);
    const data = await res.json();
    if (data.success && data.users.length > 0) {
      container.innerHTML = data.users.map(u => `
        <button type="button" onclick='loginWithUser(${JSON.stringify(u)})' class="p-3 rounded-xl bg-[var(--bg-card)] hover:border-red-500 border border-[var(--border-subtle)] text-left transition flex items-center justify-between group">
          <div>
            <span class="font-bold text-xs text-[var(--text-primary)] block group-hover:text-red-500 transition">${u.name}</span>
            <span class="text-[10px] text-[var(--text-muted)]">${u.vehicleNo}</span>
          </div>
          <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20">${u.rfidId}</span>
        </button>
      `).join('');
    }
  } catch (err) {
    console.error("Error loading profiles:", err);
  }
}

function loginWithUser(user) {
  state.currentUser = user;
  state.isLoggedIn = true;
  sessionStorage.setItem("parking_logged_in", "true");
  localStorage.setItem("parking_user", JSON.stringify(user));

  showMainApp();
  fetchDashboardData();
  loadHistory(1);
  showToast(`Welcome ${user.name}! Authenticated via RFID [${user.rfidId}]`, "success");
}

function handleLogout() {
  state.isLoggedIn = false;
  sessionStorage.removeItem("parking_logged_in");
  showLoginView();
  showToast("Logged out successfully");
}

function switchLoginTab(tab) {
  const quickTab = document.getElementById("btn-login-tab-quick");
  const regTab = document.getElementById("btn-login-tab-register");
  const quickContent = document.getElementById("tab-content-quick");
  const regContent = document.getElementById("tab-content-register");

  if (tab === "quick") {
    if (quickTab) quickTab.className = "py-2.5 rounded-lg text-xs font-bold transition btn-red shadow-none";
    if (regTab) regTab.className = "py-2.5 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:text-white transition";
    if (quickContent) quickContent.classList.remove("hidden");
    if (regContent) regContent.classList.add("hidden");
  } else {
    if (regTab) regTab.className = "py-2.5 rounded-lg text-xs font-bold transition btn-red shadow-none";
    if (quickTab) quickTab.className = "py-2.5 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:text-white transition";
    if (regContent) regContent.classList.remove("hidden");
    if (quickContent) quickContent.classList.add("hidden");
  }
}

async function handleScreenRfidLogin() {
  const input = document.getElementById("login-screen-rfid");
  const rfidId = input ? input.value.trim().toUpperCase() : "";
  if (!rfidId) {
    showToast("Please enter an RFID Unique ID to login", "error");
    return;
  }

  showToast(`Scanning RFID Tag [${rfidId}]...`);
  try {
    const res = await fetch(`${API_BASE}/api/auth/rfid-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfidId })
    });
    const data = await res.json();

    if (data.success) {
      if (input) input.value = "";
      loginWithUser(data.user);
    } else {
      showToast(data.message || "Login failed", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Server connection error", "error");
  }
}

async function handleScreenRegister(e) {
  e.preventDefault();
  const name = document.getElementById("screen-reg-name").value.trim();
  const email = document.getElementById("screen-reg-email").value.trim();
  const vehicleNo = document.getElementById("screen-reg-vehicle").value.trim();
  const rfidId = document.getElementById("screen-reg-rfid").value.trim();
  const contact = document.getElementById("screen-reg-contact").value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, vehicleNo, rfidId, contact })
    });
    const data = await res.json();

    if (data.success) {
      loginWithUser(data.user);
    } else {
      showToast(data.message || "Registration failed", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Registration failed", "error");
  }
}

// ==========================================
// NAVIGATION & VIEWS
// ==========================================
function switchView(viewName) {
  if (!state.isLoggedIn) {
    showLoginView();
    return;
  }

  state.currentView = viewName;
  const views = ["dashboard", "live", "simulator", "history", "tables"];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const tabEl = document.getElementById(`tab-${v}`);
    const mTabEl = document.getElementById(`m-tab-${v}`);

    if (el) {
      if (v === viewName) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    }

    if (tabEl) {
      if (v === viewName) {
        tabEl.classList.add("active");
      } else {
        tabEl.classList.remove("active");
      }
    }

    if (mTabEl) {
      if (v === viewName) {
        mTabEl.classList.remove("text-[var(--text-muted)]");
        mTabEl.classList.add("text-red-500");
      } else {
        mTabEl.classList.add("text-[var(--text-muted)]");
        mTabEl.classList.remove("text-red-500");
      }
    }
  });

  if (viewName === "history") {
    loadHistory(state.historyPage);
  } else if (viewName === "tables") {
    loadDbTables();
  }
}

// ==========================================
// GEOLOCATION & STATION RECOMMENDATION
// ==========================================
function detectGeolocation() {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        if (state.isLoggedIn) fetchDashboardData();
      },
      (err) => {
        console.warn("Geolocation fallback to Nagpur.", err);
      },
      { timeout: 5000 }
    );
  }
}

function refreshGeolocation() {
  const icon = document.getElementById("geo-refresh-icon");
  if (icon) icon.classList.add("fa-spin");

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        fetchDashboardData();
        if (icon) icon.classList.remove("fa-spin");
        showToast("GPS Location updated!");
      },
      () => {
        if (icon) icon.classList.remove("fa-spin");
        showToast("Using default Nagpur / SB Jain coordinates");
        fetchDashboardData();
      }
    );
  }
}

// ==========================================
// DATA FETCHING & RENDERING (DASHBOARD)
// ==========================================
async function fetchDashboardData(showLoading = true) {
  if (!state.isLoggedIn) return;

  try {
    // 1. Fetch Station recommendation with Haversine distance
    const recRes = await fetch(`${API_BASE}/api/stations/nearest?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`);
    const recData = await recRes.json();

    if (recData.success) {
      renderRecommendation(recData);
      renderStationsSummary(recData.allStations);
      state.stations = recData.allStations;
    }

    // 2. Fetch Slots for currently selected station tab
    const slotsRes = await fetch(`${API_BASE}/api/slots?stationId=${state.selectedStationId}`);
    const slotsData = await slotsRes.json();

    if (slotsData.success) {
      state.slots = slotsData.slots;
      renderSlotGrid(slotsData.slots);
    }

    // 3. Fetch active session for current user
    const sessionRes = await fetch(`${API_BASE}/api/session/active?userId=${state.currentUser.id}&rfidId=${state.currentUser.rfidId}`);
    const sessionData = await sessionRes.json();

    if (sessionData.success && sessionData.hasActiveSession) {
      state.activeSession = sessionData.session;
      renderActiveSession(sessionData.session);
    } else {
      state.activeSession = null;
      renderNoActiveSession();
    }

    // 4. Check if current user has any active pre-booked slot
    const userPrebookedSlot = state.slots.find(
      s => s.isReserved && !s.isOccupied && (s.occupiedByUserId === state.currentUser.id || s.currentRfid === state.currentUser.rfidId)
    );
    const prebookedBanner = document.getElementById("prebooked-session-banner");
    if (userPrebookedSlot) {
      state.activePrebookedSlot = userPrebookedSlot;
      if (prebookedBanner) {
        prebookedBanner.classList.remove("hidden");
        const titleEl = document.getElementById("prebooked-banner-title");
        const detEl = document.getElementById("prebooked-banner-details");
        const stn = state.stations.find(st => st.id === userPrebookedSlot.stationId);
        if (titleEl) titleEl.textContent = `Reserved: Slot ${userPrebookedSlot.slotNumber}`;
        if (detEl) detEl.textContent = `Held exclusively for ${state.currentUser.name} • ${stn ? stn.name : 'Parking Hub'} (Block ${userPrebookedSlot.blockNumber || 1})`;
      }
    } else {
      state.activePrebookedSlot = null;
      if (prebookedBanner) prebookedBanner.classList.add("hidden");
    }
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
  }
}

function renderRecommendation(data) {
  const stn = data.recommendedStation || data.nearestStation;
  const isFull = data.nearestIsFull;

  const badge = document.getElementById("full-warning-badge");
  if (badge) {
    if (isFull) {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  const nameEl = document.getElementById("rec-station-name");
  const addrEl = document.getElementById("rec-station-address");
  const distEl = document.getElementById("rec-station-distance");
  const availEl = document.getElementById("rec-station-available");
  const occEl = document.getElementById("rec-station-occupancy");
  const mapBtn = document.getElementById("rec-google-maps-btn");
  const pillsEl = document.getElementById("rec-available-slots-pills");

  if (nameEl) nameEl.textContent = stn.name;
  if (addrEl) addrEl.innerHTML = `<i class="fa-solid fa-location-dot text-red-500"></i> ${stn.address}`;
  if (distEl) distEl.textContent = `${stn.distanceKm || 0.4} km`;
  if (availEl) availEl.textContent = `${stn.availableSlotsCount} / ${stn.totalSlots}`;
  
  const occPercent = Math.round(((stn.totalSlots - stn.availableSlotsCount) / stn.totalSlots) * 100);
  if (occEl) occEl.textContent = `${occPercent}%`;

  if (mapBtn) {
    mapBtn.href = stn.googleMapsUrl || `https://www.google.com/maps/dir/?api=1&destination=${stn.latitude},${stn.longitude}`;
  }

  if (pillsEl) {
    if (stn.availableSlotNumbers && stn.availableSlotNumbers.length > 0) {
      pillsEl.innerHTML = stn.availableSlotNumbers.map(s => 
        `<span class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">Slot ${s}</span>`
      ).join('');
    } else {
      pillsEl.innerHTML = `<span class="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-red-500/10 text-red-400 border border-red-500/30">Station 100% Full</span>`;
    }
  }
}

function renderStationsSummary(stations) {
  const container = document.getElementById("stations-summary-list");
  const selectorContainer = document.getElementById("slot-station-selector");
  if (!container) return;

  container.innerHTML = stations.map(stn => {
    const isSelected = stn.id === state.selectedStationId;
    const occPct = Math.round(((stn.totalSlots - stn.availableSlotsCount) / stn.totalSlots) * 100);
    const badgeColor = stn.isFull ? "text-red-500" : "text-emerald-500";
    const statusText = stn.isFull ? "100% Full" : `${stn.availableSlotsCount} Free`;

    return `
      <div onclick="selectStation('${stn.id}')" class="p-3 rounded-xl bg-[var(--bg-secondary)] border ${isSelected ? 'border-red-500 shadow-sm' : 'border-[var(--border-subtle)]'} cursor-pointer hover:border-red-500 transition">
        <div class="flex items-center justify-between text-xs font-bold mb-1">
          <span class="truncate max-w-[180px]">${stn.name}</span>
          <span class="${badgeColor}">${statusText}</span>
        </div>
        <div class="w-full bg-slate-700/30 h-1.5 rounded-full overflow-hidden">
          <div class="bg-red-500 h-full rounded-full transition-all duration-500" style="width: ${occPct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  if (selectorContainer) {
    selectorContainer.innerHTML = stations.map(stn => {
      const activeClass = stn.id === state.selectedStationId ? "btn-red" : "btn-outline-red !border-[var(--border-subtle)] text-[var(--text-secondary)]";
      return `
        <button onclick="selectStation('${stn.id}')" class="${activeClass} text-xs py-2 px-3.5 rounded-xl font-bold">
          ${stn.name.split(' ')[0]} Hub (${stn.availableSlotsCount} Free)
        </button>
      `;
    }).join('');
  }
}

function selectStation(stationId) {
  state.selectedStationId = stationId;
  fetchDashboardData();
}

function renderSlotGrid(slots) {
  const container = document.getElementById("slots-grid-container");
  if (!container) return;

  if (slots.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-[var(--text-muted)] text-sm">No slots found for this station.</div>`;
    return;
  }

  container.innerHTML = slots.map(slot => {
    let statusClass = "status-available";
    let statusBadge = `<span class="slot-badge-available px-2 py-0.5 rounded text-[10px] font-bold">Available</span>`;
    let icon = `<i class="fa-solid fa-square-check text-2xl text-emerald-500"></i>`;
    let detailText = `Block ${slot.blockNumber || ''}`;

    if (slot.isOccupied) {
      statusClass = "status-occupied";
      statusBadge = `<span class="slot-badge-occupied px-2 py-0.5 rounded text-[10px] font-bold">Occupied</span>`;
      icon = `<i class="fa-solid fa-car text-2xl text-red-500 animate-pulse"></i>`;
      detailText = slot.vehicleNo || 'Occupied';
    } else if (slot.isReserved) {
      statusClass = "status-reserved";
      statusBadge = `<span class="slot-badge-reserved px-2 py-0.5 rounded text-[10px] font-bold">Pre-booked</span>`;
      icon = `<i class="fa-solid fa-clock text-2xl text-amber-500"></i>`;
      detailText = 'Reserved';
    }

    return `
      <div onclick="handleSlotClick('${slot.slotId}', ${slot.isOccupied}, ${slot.isReserved})" class="parking-slot-card ${statusClass}">
        <span class="text-xs font-mono font-bold text-[var(--text-muted)]">Slot ${slot.slotNumber}</span>
        ${icon}
        <span class="text-xs font-bold text-[var(--text-primary)] truncate max-w-full">${detailText}</span>
        ${statusBadge}
      </div>
    `;
  }).join('');
}

function handleSlotClick(slotId, isOccupied, isReserved) {
  if (isOccupied || isReserved) {
    openSlotDetailsModal(slotId);
    return;
  }
  openPrebookModal(slotId);
}

// ==========================================
// ACTIVE SESSION RENDERING
// ==========================================
function renderActiveSession(session) {
  const banner = document.getElementById("active-session-banner");
  const bannerTitle = document.getElementById("banner-slot-title");
  const bannerDetails = document.getElementById("banner-session-details");

  if (banner) banner.classList.remove("hidden");
  if (bannerTitle) bannerTitle.textContent = `Parked at Slot ${session.slotNumber} - Parking Successful`;
  if (bannerDetails) {
    const timeStr = new Date(session.checkInTime || session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bannerDetails.textContent = `Check-in at ${timeStr} • ${session.stationName} (Block No. ${session.blockNumber || '1'})`;
  }

  const liveTitle = document.getElementById("live-session-status-title");
  const liveSub = document.getElementById("live-session-subtitle");
  const liveVehicle = document.getElementById("live-session-vehicle");
  const liveId = document.getElementById("live-session-id");
  const liveBtn = document.getElementById("live-checkout-btn");

  if (liveTitle) liveTitle.innerHTML = `<span class="text-emerald-400">Parked at Slot ${session.slotNumber}</span><br><span class="text-xs font-bold uppercase tracking-wider text-emerald-500">Parking Successful</span>`;
  if (liveSub) liveSub.textContent = `Vehicle parked in ${session.stationName}. Your slot is safely locked.`;
  if (liveVehicle) liveVehicle.textContent = session.vehicleNo;
  if (liveId) liveId.textContent = `Booking: ${session.bookingId}`;
  if (liveBtn) liveBtn.classList.remove("hidden");
}

function renderNoActiveSession() {
  const banner = document.getElementById("active-session-banner");
  if (banner) banner.classList.add("hidden");

  const liveTitle = document.getElementById("live-session-status-title");
  const liveSub = document.getElementById("live-session-subtitle");
  const liveId = document.getElementById("live-session-id");
  const liveBtn = document.getElementById("live-checkout-btn");

  if (liveTitle) liveTitle.textContent = "No Active Vehicle Parked";
  if (liveSub) liveSub.textContent = "Scan your RFID tag at the entry kiosk to automatically park and open the barrier gate.";
  if (liveId) liveId.textContent = "ID: None";
  if (liveBtn) liveBtn.classList.add("hidden");
}

// ==========================================
// HARDWARE POLLING & SIMULATOR
// ==========================================
async function pollHardware() {
  try {
    const res = await fetch(`${API_BASE}/api/hardware/poll`);
    const data = await res.json();

    if (data.success) {
      state.hardwareState = data;

      const headerGateBadge = document.getElementById("header-gate-badge");
      const headerGateText = document.getElementById("header-gate-text");
      const isOpen = data.gateStatus === "OPEN";

      if (headerGateText) headerGateText.textContent = `Gate: ${data.gateStatus}`;
      if (headerGateBadge) {
        if (isOpen) {
          headerGateBadge.className = "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30";
        } else {
          headerGateBadge.className = "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
        }
      }

      updateBarrierArms(isOpen);

      if (data.lcdData) {
        updateLcdDisplay(data.lcdData.r1, data.lcdData.r2);
      }
    }
  } catch (err) {
    console.error("Hardware poll failed:", err);
  }
}

function updateBarrierArms(isOpen) {
  const simArm = document.getElementById("sim-barrier-arm");
  const remoteArm = document.getElementById("remote-barrier-arm");
  const simDeg = document.getElementById("sim-barrier-degree");
  const remoteDeg = document.getElementById("barrier-arm-degree");
  const remoteStatus = document.getElementById("remote-gate-status");

  const degreeText = isOpen ? "Servo: 90° (OPEN)" : "Servo: 0° (CLOSED)";

  if (simArm) simArm.className = `barrier-arm ${isOpen ? 'open' : 'closed'}`;
  if (remoteArm) remoteArm.className = `barrier-arm ${isOpen ? 'open' : 'closed'}`;
  if (simDeg) simDeg.textContent = degreeText;
  if (remoteDeg) remoteDeg.textContent = degreeText;
  if (remoteStatus) {
    remoteStatus.textContent = isOpen ? "Angle: 90° (OPEN)" : "Angle: 0° (CLOSED)";
    remoteStatus.className = isOpen ? "text-xs font-bold text-red-500" : "text-xs font-bold text-emerald-400";
  }
}

function updateLcdDisplay(r1, r2) {
  const line1 = document.getElementById("virtual-lcd-r1");
  const line2 = document.getElementById("virtual-lcd-r2");

  const format16 = (str) => (str || "").padEnd(16, " ").slice(0, 16);

  if (line1) line1.textContent = format16(r1);
  if (line2) line2.textContent = format16(r2);
}

function playLcdSequence(sequence) {
  if (!sequence || sequence.length === 0) return;
  sequence.forEach((step, idx) => {
    setTimeout(() => {
      updateLcdDisplay(step.r1, step.r2);
    }, idx * 1400);
  });
}

// ==========================================
// HARDWARE SIMULATOR TRIGGERS
// ==========================================
async function simulateRfidScan(rfidId, userName) {
  showToast(`Scanning RFID Tag [${rfidId}] for ${userName}...`);
  updateLcdDisplay("Please Scan", "Scanning.....");

  try {
    const res = await fetch(`${API_BASE}/api/hardware/rfid-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfidId, stationId: state.selectedStationId })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, "success");
      updateBarrierArms(true);

      if (data.lcd && data.lcd.sequence) {
        playLcdSequence(data.lcd.sequence);
      }

      fetchDashboardData();
    } else {
      showToast(data.message || "RFID Scan failed", "error");
      if (data.lcd) {
        updateLcdDisplay(data.lcd.r1, data.lcd.r2);
      }
    }
  } catch (err) {
    console.error(err);
    showToast("Server connection error", "error");
  }
}

function simulateCustomRfidScan() {
  const input = document.getElementById("custom-rfid-input");
  const val = input ? input.value.trim() : "";
  if (!val) {
    showToast("Please enter an RFID Tag ID", "error");
    return;
  }
  simulateRfidScan(val, "User");
  if (input) input.value = "";
}

async function toggleIrSensor(isOccupied) {
  try {
    const res = await fetch(`${API_BASE}/api/hardware/slot-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId: "SLOT-SBJ-01", isOccupied })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Slot A-01 IR sensor: ${isOccupied ? 'Car Parked' : 'Slot Clear'}`);
      fetchDashboardData();
    }
  } catch (err) {
    console.error(err);
  }
}

async function overrideGate(command) {
  try {
    const res = await fetch(`${API_BASE}/api/hardware/gate-override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Gate Override executed: ${data.gateStatus}`);
      pollHardware();
    }
  } catch (err) {
    console.error(err);
  }
}

async function triggerQuickCheckout() {
  if (!state.activeSession) {
    showToast("No active session to check out", "warning");
    return;
  }

  showToast("Processing check-out and releasing slot...");

  const checkoutSeq = [
    { r1: "Welcome To", r2: "System" },
    { r1: "Smart Parking", r2: "Auto - Meta" },
    { r1: "Please Enter Id:", r2: "Scanning....." },
    { r1: "Scanning ", r2: "Successed !!!!" },
    { r1: "thank You !!", r2: "For Visiting !!" }
  ];
  playLcdSequence(checkoutSeq);

  try {
    const res = await fetch(`${API_BASE}/api/bookings/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: state.activeSession.bookingId,
        userId: state.currentUser.id,
        rfidId: state.currentUser.rfidId
      })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, "success");
      updateBarrierArms(true);
      fetchDashboardData();
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    console.error(err);
  }
}

// ==========================================
// PRE-BOOKING MODAL
// ==========================================
function openPrebookModal(preselectedSlotId = null) {
  const modal = document.getElementById("prebook-modal");
  const stationSelect = document.getElementById("modal-station-select");
  const dateInput = document.getElementById("modal-date");

  if (stationSelect && state.stations) {
    stationSelect.innerHTML = state.stations.map(stn => 
      `<option value="${stn.id}" ${stn.id === state.selectedStationId ? 'selected' : ''}>${stn.name}</option>`
    ).join('');
  }

  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  updateModalSlotOptions(preselectedSlotId);

  if (modal) modal.classList.add("open");
}

function closePrebookModal() {
  const modal = document.getElementById("prebook-modal");
  if (modal) modal.classList.remove("open");
}

async function updateModalSlotOptions(preselectedSlotId = null) {
  const stationSelect = document.getElementById("modal-station-select");
  const slotSelect = document.getElementById("modal-slot-select");
  if (!stationSelect || !slotSelect) return;

  const stnId = stationSelect.value;
  try {
    const res = await fetch(`${API_BASE}/api/slots?stationId=${stnId}`);
    const data = await res.json();
    if (data.success) {
      const avail = data.slots.filter(s => !s.isOccupied && !s.isReserved);
      if (avail.length === 0) {
        slotSelect.innerHTML = `<option value="">No available slots at this station</option>`;
      } else {
        slotSelect.innerHTML = avail.map(s => 
          `<option value="${s.slotId}" ${s.slotId === preselectedSlotId ? 'selected' : ''}>Slot ${s.slotNumber} (Block ${s.blockNumber || ''})</option>`
        ).join('');
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function handlePrebookSubmit(e) {
  e.preventDefault();
  const stationId = document.getElementById("modal-station-select").value;
  const slotId = document.getElementById("modal-slot-select").value;
  const date = document.getElementById("modal-date").value;
  const time = document.getElementById("modal-time").value;

  if (!slotId) {
    showToast("Please choose an available slot", "error");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/bookings/prebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.currentUser.id,
        stationId,
        slotId,
        date,
        startTime: time
      })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, "success");
      closePrebookModal();
      fetchDashboardData();
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Pre-booking failed", "error");
  }
}

// ==========================================
// HISTORY & PAGINATION
// ==========================================
async function loadHistory(page = 1) {
  state.historyPage = page;
  const tbody = document.getElementById("history-table-body");
  const curPageEl = document.getElementById("history-current-page");
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/bookings/history?page=${page}&limit=10`);
    const data = await res.json();

    if (data.success) {
      if (curPageEl) curPageEl.textContent = `${data.page} of ${data.totalPages || 1}`;

      if (data.bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-[var(--text-muted)]">No parking records found.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.bookings.map(b => {
        let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-slate-400">Completed</span>`;
        if (b.status === "active") {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 animate-pulse">Active Parked</span>`;
        } else if (b.status === "pre-booked") {
          statusBadge = `
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400">Pre-Booked</span>
              <button onclick="cancelBookingById('${b.bookingId}')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/40 transition">Cancel</button>
            </div>
          `;
        } else if (b.status === "cancelled") {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400">Cancelled</span>`;
        }

        const inTime = b.checkInTime ? new Date(b.checkInTime).toLocaleString() : (b.startTime ? new Date(b.startTime).toLocaleString() : '-');
        const outTime = b.checkOutTime ? new Date(b.checkOutTime).toLocaleString() : (b.status === 'active' ? 'Currently Parked' : (b.status === 'cancelled' ? 'Cancelled' : '-'));

        return `
          <tr class="hover:bg-[var(--bg-secondary)] transition">
            <td class="py-3 px-4 font-bold text-red-500">${b.bookingId}</td>
            <td class="py-3 px-4 font-sans font-semibold">${b.userName}</td>
            <td class="py-3 px-4">${b.vehicleNo}</td>
            <td class="py-3 px-4 font-sans">${b.stationName} - <strong>Slot ${b.slotNumber}</strong></td>
            <td class="py-3 px-4">${statusBadge}</td>
            <td class="py-3 px-4 text-[var(--text-muted)]">${inTime}</td>
            <td class="py-3 px-4 text-[var(--text-muted)]">${outTime}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

function navigateHistory(delta) {
  const newPage = Math.max(1, state.historyPage + delta);
  loadHistory(newPage);
}

// ==========================================
// SLOT DETAILS & CANCEL MODAL
// ==========================================
let currentSelectedSlotId = null;

function openSlotDetailsModal(slotId) {
  const slot = state.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  currentSelectedSlotId = slotId;

  const modal = document.getElementById("slot-details-modal");
  const numEl = document.getElementById("modal-slot-number");
  const stnEl = document.getElementById("modal-slot-station");
  const badgeEl = document.getElementById("modal-slot-status-badge");
  const occLabel = document.getElementById("modal-slot-occupant-label");
  const occEl = document.getElementById("modal-slot-occupant");
  const actionDiv = document.getElementById("modal-slot-cancel-action");

  const stn = state.stations.find(s => s.id === slot.stationId);

  if (numEl) numEl.textContent = `Slot ${slot.slotNumber} (Block ${slot.blockNumber || 1})`;
  if (stnEl) stnEl.textContent = stn ? stn.name : "Parking Hub";

  if (slot.isOccupied) {
    if (badgeEl) badgeEl.innerHTML = `<span class="slot-badge-occupied px-2.5 py-1 rounded-full text-xs font-bold">Occupied</span>`;
    if (occLabel) occLabel.textContent = "Vehicle Parked:";
    if (occEl) occEl.textContent = slot.vehicleNo || "Active Vehicle";
    if (actionDiv) actionDiv.innerHTML = `<p class="text-xs text-[var(--text-muted)] text-center py-2">Vehicle is currently parked in this slot. Use Check-Out to release.</p>`;
  } else if (slot.isReserved) {
    if (badgeEl) badgeEl.innerHTML = `<span class="slot-badge-reserved px-2.5 py-1 rounded-full text-xs font-bold">Pre-Booked</span>`;
    if (occLabel) occLabel.textContent = "Reserved For:";
    if (occEl) occEl.textContent = slot.occupantName || (slot.currentRfid ? `RFID: ${slot.currentRfid}` : "Reserved User");
    if (actionDiv) {
      actionDiv.innerHTML = `
        <button type="button" onclick="confirmCancelSlotModal()" class="w-full btn-red py-2.5 text-xs flex items-center justify-center gap-2">
          <i class="fa-solid fa-ban"></i> Cancel Slot Reservation (Release Slot)
        </button>
      `;
    }
  }

  if (modal) modal.classList.add("open");
}

function closeSlotDetailsModal() {
  const modal = document.getElementById("slot-details-modal");
  if (modal) modal.classList.remove("open");
  currentSelectedSlotId = null;
}

async function confirmCancelSlotModal() {
  if (!currentSelectedSlotId) return;
  const targetId = currentSelectedSlotId;
  closeSlotDetailsModal();
  await cancelSlotReservation(targetId);
}

async function handleCancelPrebookedSlot() {
  if (!state.activePrebookedSlot) {
    showToast("No active pre-booked slot found", "warning");
    return;
  }
  await cancelSlotReservation(state.activePrebookedSlot.slotId);
}

async function cancelBookingById(bookingId) {
  if (!confirm("Are you sure you want to cancel this pre-booked parking slot?")) return;
  showToast("Cancelling reservation...");
  try {
    const res = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      fetchDashboardData();
      loadHistory(state.historyPage);
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to cancel booking", "error");
  }
}

async function cancelSlotReservation(slotId) {
  if (!confirm("Are you sure you want to cancel this slot reservation and make it available?")) return;
  showToast("Releasing reserved slot...");
  try {
    const res = await fetch(`${API_BASE}/api/bookings/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId, userId: state.currentUser.id })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      fetchDashboardData();
      loadHistory(state.historyPage);
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to cancel slot reservation", "error");
  }
}

// ==========================================
// DATABASE TABULAR VIEWER & CSV EXPORT
// ==========================================
let rawDbTables = { users: [], stations: [], slots: [], bookings: [] };
let currentActiveDbTable = "slots";

async function loadDbTables() {
  const tableHead = document.getElementById("db-table-head");
  const tableBody = document.getElementById("db-table-body");
  const infoEl = document.getElementById("db-table-info");
  
  if (infoEl) infoEl.textContent = "Loading database tables from SQLite...";

  try {
    const res = await fetch(`${API_BASE}/api/database/tables`);
    const data = await res.json();

    if (data.success && data.tables) {
      rawDbTables = data.tables;

      // Update badge counts
      const countSlots = document.getElementById("count-slots");
      const countUsers = document.getElementById("count-users");
      const countStations = document.getElementById("count-stations");
      const countBookings = document.getElementById("count-bookings");

      if (countSlots) countSlots.textContent = (data.tables.slots || []).length;
      if (countUsers) countUsers.textContent = (data.tables.users || []).length;
      if (countStations) countStations.textContent = (data.tables.stations || []).length;
      if (countBookings) countBookings.textContent = (data.tables.bookings || []).length;

      renderActiveDbTable();
    } else {
      if (infoEl) infoEl.textContent = "Failed to load database tables.";
    }
  } catch (err) {
    console.error("Failed to fetch database tables:", err);
    if (infoEl) infoEl.textContent = "Error connecting to SQLite database API.";
  }
}

function switchDbTable(tableName) {
  currentActiveDbTable = tableName;

  // Update tabs active state
  const tabs = ["slots", "users", "stations", "bookings"];
  tabs.forEach(t => {
    const btn = document.getElementById(`db-tab-${t}`);
    if (btn) {
      if (t === tableName) {
        btn.className = "btn-red text-xs py-2 px-4 rounded-xl font-bold shadow-none";
      } else {
        btn.className = "btn-outline-red !border-[var(--border-subtle)] text-[var(--text-secondary)] text-xs py-2 px-4 rounded-xl font-bold";
      }
    }
  });

  // Update CSV download link
  const csvBtn = document.getElementById("db-csv-download-btn");
  if (csvBtn) {
    csvBtn.href = `${API_BASE}/api/database/export-csv?table=${tableName}`;
    csvBtn.setAttribute("download", `parking_${tableName}.csv`);
  }

  // Clear search input on tab change
  const searchInput = document.getElementById("db-table-search");
  if (searchInput) searchInput.value = "";

  renderActiveDbTable();
}

function filterActiveTable() {
  const searchInput = document.getElementById("db-table-search");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  renderActiveDbTable(query);
}

function renderActiveDbTable(searchFilter = "") {
  const tableHead = document.getElementById("db-table-head");
  const tableBody = document.getElementById("db-table-body");
  const infoEl = document.getElementById("db-table-info");

  if (!tableHead || !tableBody) return;

  const rows = rawDbTables[currentActiveDbTable] || [];

  // Filter rows if search query is present
  const filteredRows = searchFilter
    ? rows.filter(r => Object.values(r).some(val => String(val || "").toLowerCase().includes(searchFilter)))
    : rows;

  if (infoEl) {
    infoEl.textContent = `Showing ${filteredRows.length} of ${rows.length} rows in table "${currentActiveDbTable}"`;
  }

  if (filteredRows.length === 0) {
    tableHead.innerHTML = `<tr><th class="py-3 px-4">Records</th></tr>`;
    tableBody.innerHTML = `<tr><td class="py-6 px-4 text-center text-[var(--text-muted)]">No records found matching current criteria.</td></tr>`;
    return;
  }

  // Generate columns dynamically from keys
  const keys = Object.keys(filteredRows[0]);
  tableHead.innerHTML = `
    <tr>
      <th class="py-3 px-4 w-12 text-center text-slate-500">#</th>
      ${keys.map(k => `<th class="py-3 px-4 whitespace-nowrap">${formatColumnHeader(k)}</th>`).join('')}
    </tr>
  `;

  // Generate row cells
  tableBody.innerHTML = filteredRows.map((row, idx) => `
    <tr class="hover:bg-[var(--bg-secondary)] transition border-b border-[var(--border-subtle)]">
      <td class="py-2.5 px-4 text-center text-slate-500 font-mono text-[11px]">${idx + 1}</td>
      ${keys.map(k => `<td class="py-2.5 px-4 whitespace-nowrap">${formatCellValue(k, row[k])}</td>`).join('')}
    </tr>
  `).join('');
}

function formatColumnHeader(key) {
  const headerMap = {
    id: "ID",
    userId: "User ID",
    rfidId: "RFID Tag",
    vehicleNo: "Vehicle No",
    slotId: "Slot ID",
    stationId: "Station ID",
    slotNumber: "Slot #",
    blockNumber: "Block",
    isOccupied: "Occupied",
    isReserved: "Reserved",
    totalSlots: "Total",
    availableSlotsCount: "Free",
    bookingId: "Booking ID",
    userName: "User Name",
    stationName: "Station Name",
    checkInTime: "Check-In",
    checkOutTime: "Check-Out",
    contact: "Contact"
  };
  return headerMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

function formatCellValue(key, val) {
  if (val === null || val === undefined || val === "") {
    return `<span class="text-slate-500 italic">null</span>`;
  }

  // Boolean flags or 1/0
  if (key === "isOccupied" || key === "isFull") {
    const isTrue = val === true || val === 1 || val === "1";
    return isTrue 
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">Occupied (1)</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Available (0)</span>`;
  }

  if (key === "isReserved") {
    const isTrue = val === true || val === 1 || val === "1";
    return isTrue
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Reserved (1)</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-slate-400">None (0)</span>`;
  }

  if (key === "status") {
    if (val === "active") return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 animate-pulse">active</span>`;
    if (val === "pre-booked") return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400">pre-booked</span>`;
    if (val === "cancelled") return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400">cancelled</span>`;
    return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-slate-400">${val}</span>`;
  }

  // Key IDs
  if (key === "rfidId") {
    return `<span class="font-bold text-red-500 px-1.5 py-0.5 rounded bg-red-500/10 font-mono">${val}</span>`;
  }
  if (key === "slotId" || key === "bookingId" || key === "id") {
    return `<span class="font-bold text-[var(--text-primary)] font-mono">${val}</span>`;
  }

  // ISO Dates
  if (typeof val === "string" && (val.includes("T") || val.includes("Z")) && !isNaN(Date.parse(val))) {
    return `<span class="text-[var(--text-muted)]">${new Date(val).toLocaleString()}</span>`;
  }

  return `<span class="text-[var(--text-primary)]">${val}</span>`;
}

// ==========================================
// TOAST NOTIFICATIONS & CLOCK
// ==========================================
function showToast(message, type = "info") {
  const existing = document.getElementById("smart-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "smart-toast";
  let border = "border-red-500/40";
  if (type === "success") border = "border-emerald-500/50";
  if (type === "error") border = "border-red-600";

  toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow-2xl border ${border} flex items-center gap-3 transition-all duration-300 transform translate-y-2 opacity-0`;
  toast.innerHTML = `<i class="fa-solid fa-bell text-red-500"></i> <span>${message}</span>`;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  }, 10);

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function updateLiveClock() {
  const clockEl = document.getElementById("current-time-clock");
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString();
  }

  if (state.activeSession && state.activeSession.checkInTime) {
    const durEl = document.getElementById("live-session-duration");
    if (durEl) {
      const diffSec = Math.floor((new Date() - new Date(state.activeSession.checkInTime)) / 1000);
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      durEl.textContent = `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    }
  }
}

function initEventListeners() {
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) {
      closePrebookModal();
      closeSlotDetailsModal();
    }
  });
}
