const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqliteEngine = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'database.json');

// Initialize SQLite Tabular Relational Database
sqliteEngine.initTables().catch(err => console.error('SQLite init error:', err));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Safe DB Read/Write Helpers
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database:', err);
    return {
      users: [],
      parkingStations: [],
      slots: [],
      bookings: [],
      systemStatus: {
        gateStatus: 'CLOSED',
        barrierAngle: 0,
        gateOverride: false,
        lastAction: 'SYSTEM_IDLE',
        lastRfid: '',
        lcdData: { r1: 'Smart Parking', r2: 'Auto - Meta' },
        espConnected: true,
        lastHardwareHeartbeat: new Date().toISOString()
      }
    };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    syncJsonToSqlite(data).catch(err => console.error('SQLite sync error:', err));
  } catch (err) {
    console.error('Error writing database:', err);
  }
}

async function syncJsonToSqlite(data) {
  if (!data) return;
  try {
    if (data.users) {
      for (const u of data.users) {
        await sqliteEngine.run(
          `INSERT OR REPLACE INTO users (id, rfid_id, name, email, vehicle_no, contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [u.id, u.rfidId, u.name, u.email, u.vehicleNo, u.contact, u.createdAt]
        );
      }
    }
    if (data.slots) {
      for (const s of data.slots) {
        await sqliteEngine.run(
          `INSERT OR REPLACE INTO slots (slot_id, station_id, slot_number, block_number, is_occupied, is_reserved, occupied_by_user_id, current_rfid, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [s.slotId, s.stationId, s.slotNumber, s.blockNumber, s.isOccupied ? 1 : 0, s.isReserved ? 1 : 0, s.occupiedByUserId, s.currentRfid, s.lastUpdated]
        );
      }
    }
    if (data.bookings) {
      for (const b of data.bookings) {
        await sqliteEngine.run(
          `INSERT OR REPLACE INTO bookings (booking_id, user_id, rfid_id, station_id, slot_id, slot_number, block_number, status, start_time, end_time, check_in_time, check_out_time, created_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [b.bookingId, b.userId, b.rfidId, b.stationId, b.slotId, b.slotNumber, b.blockNumber, b.status, b.startTime, b.endTime, b.checkInTime, b.checkOutTime, b.createdAt, b.cancelledAt || null]
        );
      }
    }
    if (data.systemStatus) {
      const sys = data.systemStatus;
      await sqliteEngine.run(
        `INSERT OR REPLACE INTO system_status (id, gate_status, barrier_angle, gate_override, last_action, last_rfid, lcd_r1, lcd_r2, esp_connected, last_hardware_heartbeat) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
        [sys.gateStatus, sys.barrierAngle, sys.gateOverride ? 1 : 0, sys.lastAction, sys.lastRfid, (sys.lcdData && sys.lcdData.r1) || '', (sys.lcdData && sys.lcdData.r2) || '', sys.lastHardwareHeartbeat]
      );
    }
  } catch (err) {
    console.error('Error syncing JSON to SQLite:', err);
  }
}

// Distance Calculation (Haversine formula in KM)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

// Timer for automatic barrier gate closing
let gateCloseTimer = null;
function scheduleGateClose(durationMs = 5000) {
  if (gateCloseTimer) clearTimeout(gateCloseTimer);
  gateCloseTimer = setTimeout(() => {
    const db = readDB();
    if (!db.systemStatus.gateOverride) {
      db.systemStatus.gateStatus = 'CLOSED';
      db.systemStatus.barrierAngle = 0;
      db.systemStatus.lastAction = 'GATE_AUTO_CLOSED';
      db.systemStatus.lcdData = {
        r1: 'Welcome To',
        r2: 'Smart Parking'
      };
      writeDB(db);
      console.log('[Hardware] Barrier gate auto-closed to 0 deg');
    }
  }, durationMs);
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// 1. GET /api/stations - List all stations with occupancy counts
app.get('/api/stations', (req, res) => {
  const db = readDB();
  const stationsWithStats = db.parkingStations.map(stn => {
    const stationSlots = db.slots.filter(s => s.stationId === stn.id);
    const occupiedCount = stationSlots.filter(s => s.isOccupied).length;
    const reservedCount = stationSlots.filter(s => s.isReserved && !s.isOccupied).length;
    const availableSlots = stationSlots.filter(s => !s.isOccupied && !s.isReserved);
    const availableCount = availableSlots.length;
    const isFull = availableCount === 0;

    return {
      ...stn,
      occupiedSlots: occupiedCount,
      reservedSlots: reservedCount,
      availableSlotsCount: availableCount,
      isFull,
      availableSlotNumbers: availableSlots.map(s => s.slotNumber),
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${stn.latitude},${stn.longitude}`
    };
  });

  res.json({ success: true, stations: stationsWithStats });
});

// 2. GET /api/stations/nearest - Smart Recommendation Engine
app.get('/api/stations/nearest', (req, res) => {
  const userLat = parseFloat(req.query.lat) || 21.2335; // Default: SB Jain Campus, Nagpur
  const userLng = parseFloat(req.query.lng) || 78.9667;

  const db = readDB();
  const stationsWithDistance = db.parkingStations.map(stn => {
    const distance = calculateDistance(userLat, userLng, stn.latitude, stn.longitude);
    const stationSlots = db.slots.filter(s => s.stationId === stn.id);
    const occupiedCount = stationSlots.filter(s => s.isOccupied).length;
    const reservedCount = stationSlots.filter(s => s.isReserved && !s.isOccupied).length;
    const availableSlots = stationSlots.filter(s => !s.isOccupied && !s.isReserved);
    const availableCount = availableSlots.length;
    const isFull = availableCount === 0;

    return {
      ...stn,
      distanceKm: distance,
      occupiedSlots: occupiedCount,
      reservedSlots: reservedCount,
      availableSlotsCount: availableCount,
      isFull,
      availableSlotNumbers: availableSlots.map(s => s.slotNumber),
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${stn.latitude},${stn.longitude}`
    };
  });

  // Sort by distance ascending
  stationsWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);

  const nearestStation = stationsWithDistance[0];
  let recommendedStation = nearestStation;
  let nearestIsFull = false;

  // Smart Recommendation: If nearest is 100% full, find next nearest with available slots!
  if (nearestStation && nearestStation.isFull) {
    nearestIsFull = true;
    const availableAlternative = stationsWithDistance.find(stn => !stn.isFull);
    if (availableAlternative) {
      recommendedStation = availableAlternative;
    }
  }

  res.json({
    success: true,
    userLocation: { lat: userLat, lng: userLng },
    nearestStation,
    recommendedStation,
    nearestIsFull,
    allStations: stationsWithDistance
  });
});

// 3. GET /api/slots - Get slots for a specific station or all slots
app.get('/api/slots', (req, res) => {
  const { stationId } = req.query;
  const db = readDB();
  let filteredSlots = db.slots;

  if (stationId) {
    filteredSlots = filteredSlots.filter(s => s.stationId === stationId);
  }

  // Enrich with user info if occupied
  const enrichedSlots = filteredSlots.map(slot => {
    let occupant = null;
    if (slot.occupiedByUserId) {
      occupant = db.users.find(u => u.id === slot.occupiedByUserId);
    }
    return {
      ...slot,
      occupantName: occupant ? occupant.name : null,
      vehicleNo: occupant ? occupant.vehicleNo : null
    };
  });

  res.json({ success: true, slots: enrichedSlots });
});

// 4. POST /api/auth/rfid-login - Login via RFID Tag or Unique ID
app.post('/api/auth/rfid-login', (req, res) => {
  const { rfidId } = req.body;
  if (!rfidId) {
    return res.status(400).json({ success: false, message: 'RFID ID is required' });
  }

  const db = readDB();
  const cleanRfid = rfidId.trim().toUpperCase();
  let user = db.users.find(u => u.rfidId.toUpperCase() === cleanRfid);

  if (!user) {
    // If not registered, create a guest profile for smooth demo/kiosk testing
    user = {
      id: `USR-${Date.now().toString().slice(-4)}`,
      rfidId: cleanRfid,
      name: `Guest (${cleanRfid.slice(-4)})`,
      email: `guest-${cleanRfid.toLowerCase()}@smartparking.io`,
      vehicleNo: `MH-31-TEMP-${cleanRfid.slice(-4)}`,
      contact: '+91 99999 00000',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDB(db);
  }

  // Find active booking for user
  const activeBooking = db.bookings.find(b => (b.userId === user.id || b.rfidId === cleanRfid) && b.status === 'active');

  res.json({
    success: true,
    message: 'Login successful',
    user,
    activeBooking: activeBooking || null
  });
});

// 5. POST /api/auth/register - Register new user bound to RFID Tag
app.post('/api/auth/register', (req, res) => {
  const { name, email, vehicleNo, rfidId, contact } = req.body;
  if (!name || !vehicleNo || !rfidId) {
    return res.status(400).json({ success: false, message: 'Name, Vehicle No, and RFID ID are required' });
  }

  const db = readDB();
  const cleanRfid = rfidId.trim().toUpperCase();
  const existing = db.users.find(u => u.rfidId.toUpperCase() === cleanRfid);
  if (existing) {
    return res.status(400).json({ success: false, message: 'RFID Tag is already registered to ' + existing.name });
  }

  const newUser = {
    id: `USR-${Date.now().toString().slice(-4)}`,
    rfidId: cleanRfid,
    name: name.trim(),
    email: email ? email.trim() : `${name.toLowerCase().replace(/\s+/g, '')}@sbjain.edu.in`,
    vehicleNo: vehicleNo.trim().toUpperCase(),
    contact: contact ? contact.trim() : '+91 98000 00000',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDB(db);

  res.json({ success: true, message: 'User registered successfully', user: newUser });
});

// 6. GET /api/users - Get registered users list
app.get('/api/users', (req, res) => {
  const db = readDB();
  res.json({ success: true, users: db.users });
});

// 7. POST /api/bookings/prebook - Pre-book a slot for future time
app.post('/api/bookings/prebook', (req, res) => {
  const { userId, stationId, slotId, date, startTime, endTime } = req.body;
  if (!stationId || !slotId) {
    return res.status(400).json({ success: false, message: 'Station and Slot are required' });
  }

  const db = readDB();
  const slot = db.slots.find(s => s.slotId === slotId && s.stationId === stationId);
  if (!slot) {
    return res.status(404).json({ success: false, message: 'Slot not found' });
  }

  if (slot.isOccupied) {
    return res.status(400).json({ success: false, message: 'Slot is currently occupied' });
  }

  const user = db.users.find(u => u.id === userId) || db.users[0];

  slot.isReserved = true;
  slot.occupiedByUserId = user.id;
  slot.currentRfid = user.rfidId;
  slot.lastUpdated = new Date().toISOString();

  const newBooking = {
    bookingId: `BKG-PRE-${Date.now().toString().slice(-5)}`,
    userId: user.id,
    rfidId: user.rfidId,
    stationId,
    slotId: slot.slotId,
    slotNumber: slot.slotNumber,
    blockNumber: slot.blockNumber,
    status: 'pre-booked',
    startTime: `${date || new Date().toISOString().split('T')[0]}T${startTime || '10:00'}:00.000Z`,
    endTime: `${date || new Date().toISOString().split('T')[0]}T${endTime || '12:00'}:00.000Z`,
    createdAt: new Date().toISOString()
  };

  db.bookings.unshift(newBooking);
  writeDB(db);

  res.json({
    success: true,
    message: `Slot ${slot.slotNumber} pre-booked successfully!`,
    booking: newBooking,
    slot
  });
});

// 7b. POST /api/bookings/cancel - Cancel a pre-booked slot reservation
app.post('/api/bookings/cancel', (req, res) => {
  const { bookingId, slotId, userId } = req.body;
  const db = readDB();

  let targetBooking = null;
  let targetSlot = null;

  if (bookingId) {
    targetBooking = db.bookings.find(b => b.bookingId === bookingId);
    if (targetBooking) {
      targetSlot = db.slots.find(s => s.slotId === targetBooking.slotId);
    }
  }

  if (!targetSlot && slotId) {
    targetSlot = db.slots.find(s => s.slotId === slotId);
    if (targetSlot) {
      targetBooking = db.bookings.find(b => b.slotId === slotId && b.status === 'pre-booked');
    }
  }

  if (!targetSlot && !targetBooking) {
    return res.status(404).json({ success: false, message: 'Reservation or slot not found' });
  }

  // Release the slot
  if (targetSlot) {
    if (targetSlot.isOccupied) {
      return res.status(400).json({ success: false, message: 'Cannot cancel reservation: vehicle is already parked in this slot! Please check out instead.' });
    }
    targetSlot.isReserved = false;
    targetSlot.occupiedByUserId = null;
    targetSlot.currentRfid = null;
    targetSlot.lastUpdated = new Date().toISOString();
  }

  // Update booking status
  if (targetBooking) {
    targetBooking.status = 'cancelled';
    targetBooking.cancelledAt = new Date().toISOString();
  }

  writeDB(db);

  res.json({
    success: true,
    message: `Reservation for Slot ${targetSlot ? targetSlot.slotNumber : ''} has been cancelled. Slot is now Available!`,
    slot: targetSlot,
    booking: targetBooking
  });
});

// 8. POST /api/hardware/rfid-scan - Entry & Exit Trigger (ESP8266 or Virtual Kiosk)
app.post('/api/hardware/rfid-scan', (req, res) => {
  const { rfidId, stationId = 'STN-SBJAIN' } = req.body;
  if (!rfidId) {
    return res.status(400).json({ success: false, message: 'RFID ID is required' });
  }

  const db = readDB();
  const cleanRfid = rfidId.trim().toUpperCase();

  // Find or auto-register user
  let user = db.users.find(u => u.rfidId.toUpperCase() === cleanRfid);
  if (!user) {
    user = {
      id: `USR-${Date.now().toString().slice(-4)}`,
      rfidId: cleanRfid,
      name: `User-${cleanRfid.slice(-4)}`,
      email: `user-${cleanRfid.toLowerCase()}@sbjain.edu.in`,
      vehicleNo: `MH-31-AUTO-${cleanRfid.slice(-4)}`,
      contact: '+91 98000 11111',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
  }

  // Check if this user/RFID already has an ACTIVE parking session in the system
  const activeBooking = db.bookings.find(
    b => (b.rfidId === cleanRfid || b.userId === user.id) && b.status === 'active'
  );

  // -------------------------------------------------------------
  // CASE B: CHECK-OUT (User is already parked -> Leaving parking)
  // -------------------------------------------------------------
  if (activeBooking) {
    const slot = db.slots.find(s => s.slotId === activeBooking.slotId);
    if (slot) {
      slot.isOccupied = false;
      slot.isReserved = false;
      slot.occupiedByUserId = null;
      slot.currentRfid = null;
      slot.lastUpdated = new Date().toISOString();
    }

    activeBooking.status = 'completed';
    activeBooking.checkOutTime = new Date().toISOString();

    // Actuate barrier gate
    db.systemStatus.gateStatus = 'OPEN';
    db.systemStatus.barrierAngle = 90;
    db.systemStatus.lastAction = 'CHECKOUT_SUCCESS';
    db.systemStatus.lastRfid = cleanRfid;

    // Required Checkout LCD text format
    db.systemStatus.lcdData = {
      r1: 'thank You !!',
      r2: 'For Visiting !!',
      sequence: [
        { r1: 'Scanning', r2: 'Successed !!!!' },
        { r1: 'thank You !!', r2: 'For Visiting !!' }
      ]
    };

    writeDB(db);
    scheduleGateClose(6000);

    return res.json({
      success: true,
      action: 'CHECK_OUT',
      message: 'Check-out successful! Gate opened. Thank you for visiting!',
      user,
      releasedSlot: slot ? slot.slotNumber : activeBooking.slotNumber,
      booking: activeBooking,
      lcd: db.systemStatus.lcdData,
      barrierAngle: 90
    });
  }

  // -------------------------------------------------------------
  // CASE A: CHECK-IN (User enters -> Allocate & Park)
  // -------------------------------------------------------------
  // Check if user had a pre-booked slot at this station
  let allocatedSlot = db.slots.find(
    s => s.stationId === stationId && s.isReserved && s.occupiedByUserId === user.id
  );

  // Otherwise, find the first available slot at this station
  if (!allocatedSlot) {
    allocatedSlot = db.slots.find(
      s => s.stationId === stationId && !s.isOccupied && !s.isReserved
    );
  }

  if (!allocatedSlot) {
    // Station is 100% full! Check nearest alternative station
    const stationsWithDistance = db.parkingStations.map(stn => {
      const available = db.slots.filter(s => s.stationId === stn.id && !s.isOccupied && !s.isReserved).length;
      return { ...stn, availableCount: available };
    });
    const alternative = stationsWithDistance.find(s => s.availableCount > 0);

    db.systemStatus.lcdData = {
      r1: 'Station Full!',
      r2: alternative ? `Try: ${alternative.name.slice(0, 16)}` : 'No Slots Near'
    };
    writeDB(db);

    return res.status(409).json({
      success: false,
      message: 'Station is full! No available parking slots.',
      recommendedAlternative: alternative || null,
      lcd: db.systemStatus.lcdData
    });
  }

  // Allocate slot
  allocatedSlot.isOccupied = true;
  allocatedSlot.isReserved = false;
  allocatedSlot.occupiedByUserId = user.id;
  allocatedSlot.currentRfid = cleanRfid;
  allocatedSlot.lastUpdated = new Date().toISOString();

  // Create new active booking
  const newBooking = {
    bookingId: `BKG-ACT-${Date.now().toString().slice(-5)}`,
    userId: user.id,
    rfidId: cleanRfid,
    stationId,
    slotId: allocatedSlot.slotId,
    slotNumber: allocatedSlot.slotNumber,
    blockNumber: allocatedSlot.blockNumber,
    status: 'active',
    startTime: new Date().toISOString(),
    checkInTime: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  db.bookings.unshift(newBooking);

  // Actuate barrier gate
  db.systemStatus.gateStatus = 'OPEN';
  db.systemStatus.barrierAngle = 90;
  db.systemStatus.lastAction = 'CHECKIN_SUCCESS';
  db.systemStatus.lastRfid = cleanRfid;

  // Required Check-in LCD text format
  db.systemStatus.lcdData = {
    r1: `Block No: ${allocatedSlot.blockNumber}`,
    r2: 'You can Go...',
    blockNumber: allocatedSlot.blockNumber,
    rfidId: cleanRfid,
    sequence: [
      { r1: 'Scanning', r2: 'Successed !!!!' },
      { r1: 'Your ID :', r2: cleanRfid.slice(0, 16) },
      { r1: `Block No: ${allocatedSlot.blockNumber}`, r2: 'You can Go...' },
      { r1: 'thank You !!', r2: 'For Visiting !!' }
    ]
  };

  writeDB(db);
  scheduleGateClose(7000);

  return res.json({
    success: true,
    action: 'CHECK_IN',
    message: `Parking Successful! Assigned Slot ${allocatedSlot.slotNumber} (Block No. ${allocatedSlot.blockNumber})`,
    user,
    assignedSlot: allocatedSlot,
    booking: newBooking,
    lcd: db.systemStatus.lcdData,
    barrierAngle: 90
  });
});

// 9. POST /api/bookings/checkout - Manual Web App Check-out
app.post('/api/bookings/checkout', (req, res) => {
  const { bookingId, userId, rfidId } = req.body;
  const db = readDB();

  let booking = null;
  if (bookingId) {
    booking = db.bookings.find(b => b.bookingId === bookingId && b.status === 'active');
  } else if (userId) {
    booking = db.bookings.find(b => b.userId === userId && b.status === 'active');
  } else if (rfidId) {
    booking = db.bookings.find(b => b.rfidId === rfidId && b.status === 'active');
  }

  if (!booking) {
    return res.status(404).json({ success: false, message: 'No active parking session found' });
  }

  const slot = db.slots.find(s => s.slotId === booking.slotId);
  if (slot) {
    slot.isOccupied = false;
    slot.isReserved = false;
    slot.occupiedByUserId = null;
    slot.currentRfid = null;
    slot.lastUpdated = new Date().toISOString();
  }

  booking.status = 'completed';
  booking.checkOutTime = new Date().toISOString();

  // Actuate gate
  db.systemStatus.gateStatus = 'OPEN';
  db.systemStatus.barrierAngle = 90;
  db.systemStatus.lastAction = 'CHECKOUT_SUCCESS';
  db.systemStatus.lcdData = {
    r1: 'thank You !!',
    r2: 'For Visiting !!'
  };

  writeDB(db);
  scheduleGateClose(6000);

  res.json({
    success: true,
    message: `Check-out successful. Slot ${slot ? slot.slotNumber : booking.slotNumber} is now Available!`,
    booking,
    releasedSlot: slot
  });
});

// 10. GET /api/hardware/poll - Polled by ESP8266 & Web Simulator
app.get('/api/hardware/poll', (req, res) => {
  const db = readDB();
  db.systemStatus.lastHardwareHeartbeat = new Date().toISOString();
  db.systemStatus.espConnected = true;

  res.json({
    success: true,
    gateStatus: db.systemStatus.gateStatus,
    barrierAngle: db.systemStatus.barrierAngle,
    lcdData: db.systemStatus.lcdData,
    lastAction: db.systemStatus.lastAction,
    lastRfid: db.systemStatus.lastRfid,
    timestamp: new Date().toISOString()
  });
});

// 11. POST /api/hardware/gate-override - Manual Gate Open/Close Override
app.post('/api/hardware/gate-override', (req, res) => {
  const { command } = req.body; // 'OPEN' or 'CLOSE' or 'TOGGLE'
  const db = readDB();

  if (command === 'OPEN') {
    db.systemStatus.gateStatus = 'OPEN';
    db.systemStatus.barrierAngle = 90;
    db.systemStatus.gateOverride = true;
    db.systemStatus.lastAction = 'MANUAL_GATE_OPENED';
    db.systemStatus.lcdData = { r1: 'Gate Override', r2: 'Gate: OPEN' };
  } else if (command === 'CLOSE') {
    db.systemStatus.gateStatus = 'CLOSED';
    db.systemStatus.barrierAngle = 0;
    db.systemStatus.gateOverride = false;
    db.systemStatus.lastAction = 'MANUAL_GATE_CLOSED';
    db.systemStatus.lcdData = { r1: 'Welcome To', r2: 'Smart Parking' };
  } else {
    // Toggle
    const isOpen = db.systemStatus.gateStatus === 'OPEN';
    db.systemStatus.gateStatus = isOpen ? 'CLOSED' : 'OPEN';
    db.systemStatus.barrierAngle = isOpen ? 0 : 90;
    db.systemStatus.gateOverride = !isOpen;
    db.systemStatus.lastAction = isOpen ? 'MANUAL_GATE_CLOSED' : 'MANUAL_GATE_OPENED';
    db.systemStatus.lcdData = { r1: 'Gate Override', r2: `Gate: ${db.systemStatus.gateStatus}` };
  }

  writeDB(db);

  res.json({
    success: true,
    gateStatus: db.systemStatus.gateStatus,
    barrierAngle: db.systemStatus.barrierAngle,
    gateOverride: db.systemStatus.gateOverride
  });
});

// 12. POST /api/hardware/slot-status - Sync from IR sensor (Pin D0)
app.post('/api/hardware/slot-status', (req, res) => {
  const { slotId = 'SLOT-SBJ-01', isOccupied } = req.body;
  const db = readDB();
  const slot = db.slots.find(s => s.slotId === slotId);

  if (slot) {
    slot.isOccupied = Boolean(isOccupied);
    slot.lastUpdated = new Date().toISOString();
    writeDB(db);
    return res.json({ success: true, slot });
  }

  res.status(404).json({ success: false, message: 'Slot not found' });
});

// 13. GET /api/bookings/history - Paginated History
app.get('/api/bookings/history', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const db = readDB();

  const total = db.bookings.length;
  const start = (page - 1) * limit;
  const paginated = db.bookings.slice(start, start + limit).map(b => {
    const user = db.users.find(u => u.id === b.userId);
    const station = db.parkingStations.find(s => s.id === b.stationId);
    return {
      ...b,
      userName: user ? user.name : 'Unknown User',
      vehicleNo: user ? user.vehicleNo : 'N/A',
      stationName: station ? station.name : b.stationId
    };
  });

  res.json({
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    bookings: paginated
  });
});

// 14. GET /api/session/active - Get current active parking session for user
app.get('/api/session/active', (req, res) => {
  const { userId, rfidId } = req.query;
  const db = readDB();

  let booking = null;
  if (userId) {
    booking = db.bookings.find(b => b.userId === userId && b.status === 'active');
  } else if (rfidId) {
    booking = db.bookings.find(b => b.rfidId === rfidId && b.status === 'active');
  }

  if (!booking) {
    // If none specified, find first active booking in system (helpful for dashboard overview)
    booking = db.bookings.find(b => b.status === 'active');
  }

  if (!booking) {
    return res.json({ success: true, hasActiveSession: false });
  }

  const user = db.users.find(u => u.id === booking.userId);
  const station = db.parkingStations.find(s => s.id === booking.stationId);
  const slot = db.slots.find(s => s.slotId === booking.slotId);

  res.json({
    success: true,
    hasActiveSession: true,
    session: {
      ...booking,
      userName: user ? user.name : 'User',
      vehicleNo: user ? user.vehicleNo : 'N/A',
      stationName: station ? station.name : 'Nagpur Station',
      slotNumber: slot ? slot.slotNumber : booking.slotNumber,
      blockNumber: slot ? slot.blockNumber : booking.blockNumber
    }
  });
});

// 15. GET /api/database/tables - Return real SQLite relational tabular data
app.get('/api/database/tables', async (req, res) => {
  try {
    const users = await sqliteEngine.all('SELECT * FROM users ORDER BY created_at DESC;');
    const stations = await sqliteEngine.all('SELECT * FROM parking_stations ORDER BY id ASC;');
    const slots = await sqliteEngine.all('SELECT * FROM slots ORDER BY station_id ASC, block_number ASC;');
    const bookings = await sqliteEngine.all('SELECT * FROM bookings ORDER BY created_at DESC;');
    const system = await sqliteEngine.get('SELECT * FROM system_status WHERE id = 1;');

    res.json({
      success: true,
      tables: {
        users,
        stations,
        slots,
        bookings,
        system
      }
    });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. GET /api/database/export-csv - Download any table in CSV tabular format
app.get('/api/database/export-csv', async (req, res) => {
  const table = req.query.table || 'slots';
  const allowed = {
    users: 'users',
    stations: 'parking_stations',
    slots: 'slots',
    bookings: 'bookings'
  };

  const targetTable = allowed[table];
  if (!targetTable) {
    return res.status(400).send('Invalid table name');
  }

  try {
    const rows = await sqliteEngine.all(`SELECT * FROM ${targetTable};`);
    if (rows.length === 0) return res.send('No data in table');

    const headers = Object.keys(rows[0]).join(',');
    const lines = rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${table}_tabular_data.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Catch-all route to serve the Single Page Web App
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Smart Parking Auto-meta Server running on port ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`Ready for Render deployment`);
  console.log(`====================================================`);
});
