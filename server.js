const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 ENV
const resend = new Resend(process.env.RESEND_API_KEY);
const MERAKI_API_KEY = process.env.MERAKI_API_KEY;
const NETWORK_ID = "L_602356450160822442";

// 🔐 Google Auth
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

const auth = new google.auth.JWT(
  SERVICE_ACCOUNT.client_email,
  null,
  SERVICE_ACCOUNT.private_key,
  ["https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly"],
  process.env.ADMIN_EMAIL // impersonation
);

const directory = google.admin({ version: "directory_v1", auth });

// 🧠 Cache mapping
let deviceMap = {}; // email → { mac, serial }

// 🔄 Refresh Chromebook mapping every 5 mins
async function syncDevices() {
  try {
    console.log("🔄 Syncing Chromebook devices...");

    const res = await directory.chromeosdevices.list({
      customerId: "my_customer",
      maxResults: 300
    });

    const devices = res.data.chromeosdevices || [];

    const map = {};

    for (const d of devices) {
      if (d.annotatedUser && d.macAddress) {
        map[d.annotatedUser] = {
          mac: d.macAddress,
          serial: d.serialNumber
        };
      }
    }

    deviceMap = map;

    console.log(`✅ Synced ${devices.length} devices`);

  } catch (err) {
    console.error("❌ Google API error:", err.message);
  }
}

// Run immediately + every 5 min
syncDevices();
setInterval(syncDevices, 5 * 60 * 1000);

// 📡 Get Meraki by MAC
async function getMerakiByMAC(mac) {
  try {
    if (!mac) return null;

    const res = await axios.get(
      `https://api.meraki.com/api/v1/networks/${NETWORK_ID}/clients`,
      {
        headers: {
          "X-Cisco-Meraki-API-Key": MERAKI_API_KEY
        },
        params: {
          perPage: 1000,
          timespan: 300
        }
      }
    );

    return res.data.find(c => c.mac === mac);

  } catch (err) {
    console.error("❌ Meraki error:", err.message);
    return null;
  }
}

// 📧 Send email
async function sendEmail(subject, text) {
  try {
    await resend.emails.send({
      from: "ASB Monitor <onboarding@resend.dev>",
      to: ["shettyd@asbindia.org"],
      subject,
      text
    });

    console.log("✅ Email sent");
  } catch (err) {
    console.error("❌ Email error:", err);
  }
}

// 🧠 Alert memory
const alerts = {};

// ❤️ Endpoint
app.post("/heartbeat", async (req, res) => {
  try {
    const {
      deviceId = "unknown",
      battery = {},
      isSchool = true,
      networkChanged = false,
      campus = "Unknown",
      ssid = "Unknown"
    } = req.body;

    console.log("📡 Heartbeat:", deviceId, isSchool, networkChanged);

    // 🔥 GET REAL DEVICE DATA
    const deviceInfo = deviceMap[deviceId];

    const mac = deviceInfo?.mac;
    const serial = deviceInfo?.serial;

    let meraki = null;

    if (!isSchool && networkChanged && mac) {
      meraki = await getMerakiByMAC(mac);
    }

    const apName = meraki?.recentDeviceName || "Unknown";
    const lastSeen = meraki?.lastSeen || "Unknown";

    // 🚨 LEFT NETWORK ALERT
    if (!isSchool && networkChanged) {
      if (!alerts[deviceId]?.network) {
        await sendEmail(
          "🚨 Left ASB Network",
          `Campus: ${campus}

User: ${deviceId}
Device Serial: ${serial || "Unknown"}

Last AP: ${apName}
Last Seen: ${lastSeen}

Status: Device left school network`
        );

        alerts[deviceId] = { ...alerts[deviceId], network: true };
      }
    }

    // 🔋 LOW BATTERY
    if (battery.level !== undefined && battery.level < 9 && !battery.charging) {
      if (!alerts[deviceId]?.lowBattery) {
        await sendEmail(
          "⚠️ Low Battery",
          `User: ${deviceId}
Device Serial: ${serial || "Unknown"}

Battery: ${battery.level}%
Charging: ${battery.charging}

Last AP: ${apName}`
        );

        alerts[deviceId] = { ...alerts[deviceId], lowBattery: true };
      }
    }

    res.send({ ok: true });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error");
  }
});

// 🏠 Health
app.get("/", (req, res) => {
  res.send("ASB Monitor Running 🚀");
});

// 🚀 Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
