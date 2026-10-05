/*
 * =========================================================================================
 * Project: Smart Parking Auto-meta (IoT Entry Kiosk & Slot Barrier System)
 * Designed & Developed by: Team AKOP, Department of ETC, SB Jain, Nagpur
 * Target Microcontroller: ESP8266 (NodeMCU / Wemos D1 Mini)
 * =========================================================================================
 *
 * Hardware Pin Connections:
 * -----------------------------------------------------------------------------------------
 * 1. 16x2 I2C LCD Display (@0x27):
 *    - SCL -> D1 (GPIO 5)
 *    - SDA -> D2 (GPIO 4)
 *    - VCC -> 5V (VIN)
 *    - GND -> GND
 *
 * 2. MFRC522 RFID Reader:
 *    - RST -> D3 (GPIO 0)
 *    - SDA/SS -> D4 (GPIO 2)
 *    - SCK -> D5 (GPIO 14)
 *    - MISO -> D6 (GPIO 12)
 *    - MOSI -> D7 (GPIO 13)
 *    - 3.3V -> 3V3
 *    - GND -> GND
 *
 * 3. Barrier Servo Motor (SG90 / MG996R):
 *    - PWM Signal -> D8 (GPIO 15)
 *    - VCC -> 5V (VIN or External 5V Power Supply)
 *    - GND -> GND (Common Ground)
 *
 * 4. Slot IR Sensor (Individual Slot Detection):
 *    - OUT -> D0 (GPIO 16)
 *    - VCC -> 3.3V / 5V
 *    - GND -> GND
 *
 * 5. Ultrasonic Sensor (Vehicle Entry Detection):
 *    - TRIG -> GPIO 1 (TX)
 *    - ECHO -> GPIO 3 (RX)
 *    - VCC -> 5V
 *    - GND -> GND
 *
 * Required Arduino Libraries (Install via Arduino Library Manager):
 * - ESP8266WiFi
 * - ESP8266HTTPClient
 * - WiFiClient
 * - LiquidCrystal_I2C by Frank de Brabander
 * - MFRC522 by GithubCommunity / miguelbalboa
 * - Servo by Michael Margolis
 * - ArduinoJson by Benoit Blanchon (v6 or v7)
 * =========================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>
#include <ArduinoJson.h>

// ==========================================
// 1. CONFIGURATION & CREDENTIALS
// ==========================================
// WiFi Credentials from prompt.txt
const char* ssid     = "ESP8266";
const char* password = "12345678";

// Cloud / Local Backend Server URL
// Keep renderUrl blank as requested; fill with your deployed Render URL after deployment:
// e.g., "https://parking-auto-meta.onrender.com"
const char* renderUrl = ""; 

// Local fallback URL when testing on home/lab router (change to your PC LAN IP):
const char* localServerUrl = "http://192.168.4.1:3000";

// Parking Station ID for this physical kiosk
const char* stationId = "STN-SBJAIN";

// ==========================================
// 2. PIN DEFINITIONS
// ==========================================
// RFID RC522 Pins
#define RFID_RST_PIN  0   // D3 (GPIO 0)
#define RFID_SS_PIN   2   // D4 (GPIO 2)

// Servo Motor Pin
#define SERVO_PIN     15  // D8 (GPIO 15)

// Slot IR Sensor Pin
#define IR_SENSOR_PIN 16  // D0 (GPIO 16)

// Ultrasonic Sensor Pins
#define US_TRIG_PIN   1   // GPIO 1 (TX)
#define US_ECHO_PIN   3   // GPIO 3 (RX)

// ==========================================
// 3. HARDWARE OBJECT INSTANCES
// ==========================================
// 16x2 I2C LCD @ 0x27 address, 16 columns, 2 rows (SCL=D1, SDA=D2)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// RFID RC522 Reader
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// Barrier Servo
Servo barrierServo;

// Tracking Variables
int barrierAngle = 0;              // 0 = Closed, 90 = Open
bool lastIrState = HIGH;
unsigned long lastServerPoll = 0;
const unsigned long POLL_INTERVAL = 3000; // Poll server every 3s
unsigned long welcomeAnimationTimer = 0;
int welcomeStep = 0;

// Helper to determine the active server endpoint
String getBaseUrl() {
  if (strlen(renderUrl) > 0) {
    return String(renderUrl);
  }
  return String(localServerUrl);
}

// Helper to print exact 16-character strings to LCD R1 and R2
void printLcd(String r1, String r2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(r1);
  lcd.setCursor(0, 1);
  lcd.print(r2);
}

// Servo gate actuation helper
void setGate(int angle) {
  barrierAngle = angle;
  barrierServo.write(angle);
  delay(15);
}

// ==========================================
// SETUP FUNCTION
// ==========================================
void setup() {
  // Initialize Serial (Note: GPIO 1 & 3 are used by Ultrasonic; disable Serial if Ultrasonic in active use)
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[IoT] Smart Parking Auto-meta Initializing...");

  // Initialize I2C LCD (SDA on D2, SCL on D1)
  Wire.begin(4, 5); // SDA=GPIO 4 (D2), SCL=GPIO 5 (D1)
  lcd.init();
  lcd.backlight();

  // Initialize Servo Motor on D8
  barrierServo.attach(SERVO_PIN);
  setGate(0); // Start closed (0 degrees)

  // Initialize IR Sensor on D0
  pinMode(IR_SENSOR_PIN, INPUT);

  // Initialize Ultrasonic Pins
  pinMode(US_TRIG_PIN, OUTPUT);
  pinMode(US_ECHO_PIN, INPUT);
  digitalWrite(US_TRIG_PIN, LOW);

  // Initialize SPI & RFID RC522
  SPI.begin();
  rfid.PCD_Init();
  delay(50);
  Serial.println("[IoT] RFID RC522 Initialized on D3/D4");

  // -------------------------------------------------------------
  // EXACT LCD SEQUENCE IN SETUP (As specified in prompt.txt)
  // -------------------------------------------------------------
  // R1: MyProject
  // R2: WELCOME
  // delay(3S)
  printLcd("MyProject", "WELCOME");
  delay(3000);

  // R1: CONNECTING TO
  // R2: WiFi.........
  printLcd("CONNECTING TO", "WiFi.........");
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int wifiRetries = 0;
  while (WiFi.status() != WL_CONNECTED && wifiRetries < 25) {
    delay(500);
    Serial.print(".");
    wifiRetries++;
  }

  // R1: CONNECTED TO
  // R2: WiFi...SUCCESS
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
    printLcd("CONNECTED TO", "WiFi...SUCCESS");
  } else {
    Serial.println("\n[WiFi] Connection timeout. Operating in Standalone/AP mode.");
    printLcd("WiFi Status:", "OFFLINE / LOCAL");
  }
  delay(2000);
}

// ==========================================
// LOOP FUNCTION
// ==========================================
void loop() {
  // 1. Idle Welcome Screen Carousel on 16x2 LCD
  handleWelcomeAnimation();

  // 2. Check for RFID Card Scan
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    handleRfidScan();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 3. Check Slot IR Sensor (Pin D0)
  handleIrSensor();

  // 4. Periodically Poll Server for Gate Overrides & Remote LCD Data
  if (millis() - lastServerPoll >= POLL_INTERVAL) {
    lastServerPoll = millis();
    pollServerDetails();
  }
}

// ==========================================
// WELCOME MESSAGE CAROUSEL ON LCD
// ==========================================
void handleWelcomeAnimation() {
  // Rotate idle welcome message every 3.5 seconds
  if (millis() - welcomeAnimationTimer > 3500) {
    welcomeAnimationTimer = millis();
    welcomeStep = (welcomeStep + 1) % 3;

    switch (welcomeStep) {
      case 0:
        // R1: Welcome To
        // R2: System
        printLcd("Welcome To", "System");
        break;
      case 1:
        // R1: Smart Parking
        // R2: Auto - Meta
        printLcd("Smart Parking", "Auto - Meta");
        break;
      case 2:
        // R1: Please Scan
        // R2: Scanning.....
        printLcd("Please Scan", "Scanning.....");
        break;
    }
  }
}

// ==========================================
// RFID SCAN HANDLER (Entry & Exit)
// ==========================================
void handleRfidScan() {
  // Read Tag UID into a Hex String
  String tagId = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) tagId += "0";
    tagId += String(rfid.uid.uidByte[i], HEX);
  }
  tagId.toUpperCase();

  Serial.println("\n[RFID] Scanned Tag ID: " + tagId);

  // Send Tag ID to Server
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    String endpoint = getBaseUrl() + "/api/hardware/rfid-scan";

    http.begin(client, endpoint);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["rfidId"] = tagId;
    doc["stationId"] = stationId;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = http.POST(requestBody);
    Serial.printf("[HTTP] POST %s -> Code: %d\n", endpoint.c_str(), httpCode);

    if (httpCode > 0) {
      String response = http.getString();
      StaticJsonDocument<512> resDoc;
      DeserializationError err = deserializeJson(resDoc, response);

      if (!err && resDoc["success"]) {
        String action = resDoc["action"] | "CHECK_IN";

        if (action == "CHECK_IN") {
          // -------------------------------------------------------------
          // EXACT ENTRY LCD SEQUENCE (From prompt.txt)
          // -------------------------------------------------------------
          // R1: Scanning 
          // R2: Successed !!!!
          printLcd("Scanning ", "Successed !!!!");
          delay(1500);

          // R1: Your ID :
          // R2: (Display Unique Id Generated when rfid Scanned)
          printLcd("Your ID :", tagId);
          delay(2000);

          // R1: Show parking block no. ( like no. 3)
          // R2: You can Go...
          int blockNo = resDoc["assignedSlot"]["blockNumber"] | 3;
          printLcd("Show park block", "no. " + String(blockNo));
          delay(2000);

          printLcd("You can Go...", "GATE OPENING");
          
          // Open Servo Barrier Gate (90 degrees)
          setGate(90);
          delay(3000);

          // R1: thank You !!
          // R2: For Visiting !!
          printLcd("thank You !!", "For Visiting !!");
          delay(2500);

          // Close Gate (0 degrees)
          setGate(0);

        } else if (action == "CHECK_OUT") {
          // -------------------------------------------------------------
          // EXACT CHECK-OUT LCD SEQUENCE (From prompt.txt)
          // -------------------------------------------------------------
          // R1: Welcome To
          // R2: System
          printLcd("Welcome To", "System");
          delay(1200);

          // R1: Smart Parking
          // R2: Auto - Meta
          printLcd("Smart Parking", "Auto - Meta");
          delay(1200);

          // R1: Please Enter Id: 
          // R2: Scanning.....
          printLcd("Please Enter Id:", "Scanning.....");
          delay(1200);

          // R1: Scanning 
          // R2: Successed !!!!
          printLcd("Scanning ", "Successed !!!!");
          delay(1500);

          // Open Servo Barrier Gate (90 degrees)
          setGate(90);

          // R1: thank You !!
          // R2: For Visiting !!
          printLcd("thank You !!", "For Visiting !!");
          delay(3000);

          // Close Gate (0 degrees)
          setGate(0);
        }
      } else {
        // Station Full or Error
        printLcd("Access Denied", "STATION FULL!");
        delay(2000);
      }
    } else {
      Serial.printf("[HTTP] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
      printLcd("Server Offline", "Tag: " + tagId);
      delay(2000);
    }
    http.end();
  } else {
    // Offline simulation mode
    printLcd("Scanning ", "Successed !!!!");
    delay(1500);
    printLcd("Your ID :", tagId);
    delay(1500);
    printLcd("Show park block", "no. 1");
    setGate(90);
    delay(3000);
    setGate(0);
  }
}

// ==========================================
// SLOT IR SENSOR (Pin D0)
// ==========================================
void handleIrSensor() {
  bool currentIrState = digitalRead(IR_SENSOR_PIN);

  // If status changed (Active LOW: LOW = Car detected, HIGH = Empty)
  if (currentIrState != lastIrState) {
    lastIrState = currentIrState;
    bool isOccupied = (currentIrState == LOW);

    Serial.printf("[Sensor] IR Pin D0 Status Changed: %s\n", isOccupied ? "CAR DETECTED" : "SLOT EMPTY");

    if (WiFi.status() == WL_CONNECTED) {
      WiFiClient client;
      HTTPClient http;
      String endpoint = getBaseUrl() + "/api/hardware/slot-status";

      http.begin(client, endpoint);
      http.addHeader("Content-Type", "application/json");

      StaticJsonDocument<128> doc;
      doc["slotId"] = "SLOT-SBJ-01"; // Slot mapped to physical sensor
      doc["isOccupied"] = isOccupied;

      String requestBody;
      serializeJson(doc, requestBody);
      http.POST(requestBody);
      http.end();
    }
  }
}

// ==========================================
// POLL DETAILS FROM SERVER (LCD Data & Gate)
// ==========================================
void pollServerDetails() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  HTTPClient http;
  String endpoint = getBaseUrl() + "/api/hardware/poll";

  http.begin(client, endpoint);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (!err && doc["success"]) {
      int targetAngle = doc["barrierAngle"] | 0;

      // Remote override gate position if needed
      if (targetAngle != barrierAngle) {
        setGate(targetAngle);
        Serial.printf("[Poll] Remote Gate Override: %d deg\n", targetAngle);
      }
    }
  }
  http.end();
}
