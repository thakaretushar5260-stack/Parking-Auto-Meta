# Smart Parking Auto-meta 🚗⚡
> An End-to-End IoT + Full-Stack Web Application for Smart Parking Recommendation, RFID Access, and Automated Barrier Gate Control.

Designed &amp; Developed by: **Team AKOP. Department of ETC, SB Jain, Nagpur**

---

## 🌟 Key Features

1. **RFID Access & Scanning**:
   - Tap-and-go access via MFRC522 RFID reader.
   - Generates/reads unique tag IDs and maps to user accounts (e.g., Vaibhav, Ankita, Om, Pratik).
2. **Smart Parking Recommendation**:
   - Checks real-time station occupancy using the Haversine distance algorithm.
   - Shows nearest station to the user's location.
   - **Auto-rerouting**: If the nearest parking station is 100% full, automatically recommends the **next nearest available parking station**!
   - Displays exact available slot numbers (e.g., Slot A-02, Slot B-01, Slot B-03).
3. **Turn-by-Turn Google Maps Navigation**:
   - One-click navigation link (`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`).
4. **Pre-Booking Modal**:
   - Pre-book parking slots for a specific date and time before arriving.
5. **Check-In & "Parking Successful" Live Tracking**:
   - Visual slot grid (🟢 Green = Available, 🔴 Red = Occupied, 🟡 Yellow = Pre-booked).
   - Real-time parking duration timer and session monitoring.
6. **Automated Barrier Servo Gate**:
   - SG90/MG996R servo motor lifts to 90° upon valid entry or check-out, then auto-closes to 0°.
   - Remote gate manual override buttons directly from the dashboard.
7. **16x2 I2C Character LCD**:
   - Displays the exact boot and scan message sequences required.
8. **Virtual Kiosk & Hardware Simulator**:
   - Built directly into the web app to test RFID scans, LCD messages, servo gate animations, and slot IR sensors without requiring physical hardware plugged in!
9. **Modern Red Gradient Theme**:
   - Glassmorphic panels, responsive mobile-first layout, and persistent **Light/Dark theme toggle**.
10. **Relational Tabular Database**:
    - Full SQLite relational engine (`data/parking.db`) with structured tables for `users`, `parking_stations`, `slots`, `bookings`, and `system_status`.
    - In-app spreadsheet grid view with search filters and **1-click CSV Table Export**.
11. **Render Cloud Ready**:
    - 1-click deployable to Render.

---

## 📂 Project Architecture

```
Smart-Parking-Auto-Meta/
├── package.json               # Node.js dependencies & Render start scripts
├── server.js                  # Express.js REST API, Haversine routing & SQLite endpoints
├── db.js                      # SQLite relational database engine & JSON sync
├── data/
│   ├── database.json          # JSON database (synced with SQLite)
│   └── parking.db             # SQLite tabular relational database
├── public/
│   ├── index.html             # Login, dashboard, simulator, history & tabular DB viewer
│   ├── style.css              # Red gradient design system & Light/Dark tokens
│   ├── app.js                 # State machine, GPS detection, hardware sync & DB tables viewer
│   └── favicon.svg            # Custom parking & RFID SVG icon
├── firmware/
│   └── firmware.ino           # ESP8266 Arduino C++ firmware
├── prompt.txt                 # Original project requirements specification
└── README.md                  # Complete documentation & wiring guide
```

---

## 🔌 Hardware Circuit & Pinout (ESP8266)

| Component | Pin on ESP8266 | Description / Note |
|---|---|---|
| **16x2 LCD (I2C @0x27)** | **D1** (GPIO 5) | SCL (I2C Clock) |
| | **D2** (GPIO 4) | SDA (I2C Data) |
| | **VIN / 5V & GND** | Power & Ground |
| **RFID Reader (RC522)** | **D3** (GPIO 0) | RST (Reset) |
| | **D4** (GPIO 2) | SDA / SS (Chip Select) |
| | **D5** (GPIO 14) | SCK (SPI Clock) |
| | **D6** (GPIO 12) | MISO (Master In Slave Out) |
| | **D7** (GPIO 13) | MOSI (Master Out Slave In) |
| | **3V3 & GND** | 3.3V Power & Ground |
| **Barrier Servo Motor** | **D8** (GPIO 15) | PWM Signal (0° Closed, 90° Open) |
| | **5V & GND** | Power (Use external 5V if servo jitters) |
| **Slot IR Sensor** | **D0** (GPIO 16) | Digital OUT (Slot occupancy detection) |
| **Ultrasonic Sensor** | **GPIO 1** (TX) | TRIG Pin |
| | **GPIO 3** (RX) | ECHO Pin |

---

## 🚀 Running Locally

### 1. Start Backend & Web Dashboard:
```bash
npm install
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## ☁️ Deploying to Render

This application is configured for deployment on [Render](https://render.com):

1. Push your repository to GitHub.
2. Go to your Render Dashboard and click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Set the following build settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Click **Create Web Service**.
6. Once deployed, Render will provide a live URL (e.g., `https://smart-parking-auto-meta.onrender.com`).
7. Update the `RENDER_URL` constant:
   - In `public/app.js`: update `const RENDER_URL = "https://your-service.onrender.com";` (or leave blank if serving frontend from Express).
   - In `firmware/firmware.ino`: update `const char* renderUrl = "https://your-service.onrender.com";`.

---

## 📟 16x2 LCD Message Sequences

### Setup Sequence:
```
R1: MyProject
R2: WELCOME
[delay 3s]
R1: CONNECTING TO
R2: WiFi.........
[delay]
R1: CONNECTED TO
R2: WiFi...SUCCESS
```

### Loop Idle Sequence:
```
R1: Welcome To
R2: System
[rotates to]
R1: Smart Parking
R2: Auto - Meta
[rotates to]
R1: Please Scan
R2: Scanning.....
```

### Entry Scan Sequence:
```
R1: Scanning 
R2: Successed !!!!
[rotates to]
R1: Your ID :
R2: [RFID Tag ID]
[rotates to]
R1: Show parking block no. ( like no. 3)
R2: You can Go...
[Servo Gate Opens 90°]
R1: thank You !!
R2: For Visiting !!
[Servo Gate Closes 0°]
```

### Check-Out Sequence:
```
R1: Welcome To
R2: System
[rotates to]
R1: Smart Parking
R2: Auto - Meta
[rotates to]
R1: Please Enter Id: 
R2: Scanning.....
[rotates to]
R1: Scanning 
R2: Successed !!!!
[Servo Gate Opens 90°]
R1: thank You !!
R2: For Visiting !!
[Servo Gate Closes 0°]
```

---

## 👥 Credits
**Developed & Designed by Team AKOP**  
*Department of ETC, SB Jain Institute of Technology, Management & Research, Nagpur*
