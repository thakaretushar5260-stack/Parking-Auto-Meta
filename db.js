// SQLite Relational Database Engine for Smart Parking Auto-meta
// Preserves real relational tabular structure: Users, ParkingStations, Slots, Bookings, SystemStatus

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'data', 'parking.db');
const JSON_BACKUP = path.join(__dirname, 'data', 'database.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('[SQLite] Connected to tabular database:', DB_FILE);
  }
});

// Helper for Promisified Queries
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

// Initialize Relational Tables
async function initTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      rfid_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      vehicle_no TEXT NOT NULL,
      contact TEXT,
      created_at TEXT
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS parking_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      total_slots INTEGER NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS slots (
      slot_id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL,
      slot_number TEXT NOT NULL,
      block_number INTEGER,
      is_occupied INTEGER DEFAULT 0,
      is_reserved INTEGER DEFAULT 0,
      occupied_by_user_id TEXT,
      current_rfid TEXT,
      last_updated TEXT,
      FOREIGN KEY (station_id) REFERENCES parking_stations(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      booking_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rfid_id TEXT NOT NULL,
      station_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      slot_number TEXT NOT NULL,
      block_number INTEGER,
      status TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      check_in_time TEXT,
      check_out_time TEXT,
      created_at TEXT,
      cancelled_at TEXT
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS system_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      gate_status TEXT DEFAULT 'CLOSED',
      barrier_angle INTEGER DEFAULT 0,
      gate_override INTEGER DEFAULT 0,
      last_action TEXT,
      last_rfid TEXT,
      lcd_r1 TEXT,
      lcd_r2 TEXT,
      esp_connected INTEGER DEFAULT 1,
      last_hardware_heartbeat TEXT
    );
  `);

  // Migrate initial records from database.json if sqlite tables are empty
  await seedFromJSON();
}

async function seedFromJSON() {
  const userCountRow = await get(`SELECT COUNT(*) as count FROM users;`);
  if (userCountRow && userCountRow.count > 0) {
    return; // Already populated
  }

  if (!fs.existsSync(JSON_BACKUP)) return;

  try {
    const raw = fs.readFileSync(JSON_BACKUP, 'utf-8');
    const data = JSON.parse(raw);

    // 1. Users
    if (data.users && data.users.length > 0) {
      for (const u of data.users) {
        await run(
          `INSERT OR IGNORE INTO users (id, rfid_id, name, email, vehicle_no, contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [u.id, u.rfidId, u.name, u.email, u.vehicleNo, u.contact, u.createdAt]
        );
      }
    }

    // 2. Parking Stations
    if (data.parkingStations && data.parkingStations.length > 0) {
      for (const s of data.parkingStations) {
        await run(
          `INSERT OR IGNORE INTO parking_stations (id, name, address, latitude, longitude, total_slots) VALUES (?, ?, ?, ?, ?, ?);`,
          [s.id, s.name, s.address, s.latitude, s.longitude, s.totalSlots]
        );
      }
    }

    // 3. Slots
    if (data.slots && data.slots.length > 0) {
      for (const sl of data.slots) {
        await run(
          `INSERT OR IGNORE INTO slots (slot_id, station_id, slot_number, block_number, is_occupied, is_reserved, occupied_by_user_id, current_rfid, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            sl.slotId,
            sl.stationId,
            sl.slotNumber,
            sl.blockNumber,
            sl.isOccupied ? 1 : 0,
            sl.isReserved ? 1 : 0,
            sl.occupiedByUserId,
            sl.currentRfid,
            sl.lastUpdated
          ]
        );
      }
    }

    // 4. Bookings
    if (data.bookings && data.bookings.length > 0) {
      for (const b of data.bookings) {
        await run(
          `INSERT OR IGNORE INTO bookings (booking_id, user_id, rfid_id, station_id, slot_id, slot_number, block_number, status, start_time, end_time, check_in_time, check_out_time, created_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            b.bookingId,
            b.userId,
            b.rfidId,
            b.stationId,
            b.slotId,
            b.slotNumber,
            b.blockNumber,
            b.status,
            b.startTime,
            b.endTime,
            b.checkInTime,
            b.checkOutTime,
            b.createdAt,
            b.cancelledAt || null
          ]
        );
      }
    }

    // 5. System Status
    const sys = data.systemStatus || {};
    await run(
      `INSERT OR REPLACE INTO system_status (id, gate_status, barrier_angle, gate_override, last_action, last_rfid, lcd_r1, lcd_r2, esp_connected, last_hardware_heartbeat) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
      [
        sys.gateStatus || 'CLOSED',
        sys.barrierAngle || 0,
        sys.gateOverride ? 1 : 0,
        sys.lastAction || 'SYSTEM_IDLE',
        sys.lastRfid || '',
        (sys.lcdData && sys.lcdData.r1) || 'Smart Parking',
        (sys.lcdData && sys.lcdData.r2) || 'Auto - Meta',
        new Date().toISOString()
      ]
    );

    console.log('[SQLite] Seeded tables successfully from JSON file.');
  } catch (err) {
    console.error('Error seeding SQLite from JSON:', err);
  }
}

// Sync back to JSON so data/database.json always reflects the relational database state
async function exportToJSON() {
  try {
    const users = await all(`SELECT id, rfid_id as rfidId, name, email, vehicle_no as vehicleNo, contact, created_at as createdAt FROM users;`);
    const stations = await all(`SELECT id, name, address, latitude, longitude, total_slots as totalSlots FROM parking_stations;`);
    const slots = await all(`SELECT slot_id as slotId, station_id as stationId, slot_number as slotNumber, block_number as blockNumber, is_occupied = 1 as isOccupied, is_reserved = 1 as isReserved, occupied_by_user_id as occupiedByUserId, current_rfid as currentRfid, last_updated as lastUpdated FROM slots;`);
    const bookings = await all(`SELECT booking_id as bookingId, user_id as userId, rfid_id as rfidId, station_id as stationId, slot_id as slotId, slot_number as slotNumber, block_number as blockNumber, status, start_time as startTime, end_time as endTime, check_in_time as checkInTime, check_out_time as checkOutTime, created_at as createdAt, cancelled_at as cancelledAt FROM bookings ORDER BY created_at DESC;`);
    const sys = await get(`SELECT * FROM system_status WHERE id = 1;`) || {};

    const payload = {
      users,
      parkingStations: stations,
      slots,
      bookings,
      systemStatus: {
        gateStatus: sys.gate_status || 'CLOSED',
        barrierAngle: sys.barrier_angle || 0,
        gateOverride: sys.gate_override === 1,
        lastAction: sys.last_action || 'SYSTEM_IDLE',
        lastRfid: sys.last_rfid || '',
        lcdData: {
          r1: sys.lcd_r1 || 'Smart Parking',
          r2: sys.lcd_r2 || 'Auto - Meta'
        },
        espConnected: true,
        lastHardwareHeartbeat: sys.last_hardware_heartbeat || new Date().toISOString()
      }
    };

    fs.writeFileSync(JSON_BACKUP, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error exporting SQLite to JSON:', err);
  }
}

module.exports = {
  db,
  run,
  all,
  get,
  initTables,
  exportToJSON
};
