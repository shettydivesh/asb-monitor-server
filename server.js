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

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

if (SERVICE_ACCOUNT.private_key.includes("\\n")) {
  SERVICE_ACCOUNT.private_key = SERVICE_ACCOUNT.private_key.replace(/\\n/g, "\n");
}

const auth = new google.auth.JWT(
  SERVICE_ACCOUNT.client_email,
  null,
  SERVICE_ACCOUNT.private_key,
  ["https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly"],
  process.env.ADMIN_EMAIL
);

const directory = google.admin({ version: "directory_v1", auth });

// 🧠 Device cache (email → device info)
let deviceMap = {};

// 🧠 Cache last AP before disconnect
let lastSeenMap = {};

// 🔄 Sync Chromebooks (with pagination)
async function syncDevices() {
  try {
    console.log("🔄 Syncing devices...");

    let pageToken;
    const map = {};
    let total = 0;

    do {
      const res = await directory.chromeosdevices.list({
        customerId: "my_customer",
        maxResults: 500,
        pageToken
      });

      const devices = res.data.chromeosdevices || [];
      total += devices.length;

      for (const d of devices) {
        const user =
          d.recentUsers?.[0]?.email ||
          d.annotatedUser ||
          null;

        if (!user) continue;

        map[user] = {
          serial: d.serialNumber,
          mac: d.macAddress
        };
      }

      pageToken = res.data.nextPageToken;

    } while (pageToken);

    deviceMap = map;

    console.log(`✅ Synced ${total} devices`);

  } catch (err) {
    console.error("❌ Google API error:", err.message);
  }
}

// Run sync
syncDevices();
setInterval(syncDevices, 5 * 60 * 1000);

// 📡 Get Meraki client by MAC
async function getMerakiClient(mac) {
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
          timespan: 900 // 15 mins
        }
      }
    );

    return res.data.find(
      c => c.mac?.toLowerCase() === mac?.toLowerCase()
    );

  } catch (err) {
    console.error("❌ Meraki error:", err.message);
    return null;
  }
}

// 📧 Email
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

// ❤️ Heartbeat
app.post("/heartbeat", async (req, res) => {
  try {
    const {
      deviceId,
      battery = {},
      isSchool,
      networkChanged,
      campus
    } = req.body;

    console.log("📡", deviceId, isSchool, networkChanged);

    const deviceInfo = deviceMap[deviceId];

    const serial = deviceInfo?.serial || "Unknown";
    const mac = deviceInfo?.mac;

    let meraki = null;

    // 🔥 ALWAYS capture last AP while inside school
    if (isSchool && mac) {
      const current = await getMerakiClient(mac);

      if (current) {
        lastSeenMap[deviceId] = current;
      }
    }

    // 🔥 On disconnect → use cached AP
    if (!isSchool && networkChanged) {
      meraki = lastSeenMap[deviceId] || null;
    }

    const apName = meraki?.recentDeviceName || "Unknown";
    const lastSeen = meraki?.lastSeen || "Unknown";

    const now = Date.now();

    // 🚨 LEFT NETWORK ALERT (cooldown 30 mins)
    if (!isSchool && networkChanged) {
      const lastSent = alerts[deviceId]?.networkTime || 0;

      if (now - lastSent > 30 * 60 * 1000) {
        await sendEmail(
          "🚨 Left ASB Network",
          `Campus: ${campus}

User: ${deviceId}
Device Serial: ${serial}

Last AP: ${apName}
Last Seen: ${lastSeen}

Status: Device left school network`
        );

        alerts[deviceId] = {
          ...alerts[deviceId],
          networkTime: now
        };
      }
    }

    // 🔋 LOW BATTERY
    if (battery?.level !== undefined && battery.level <= 5) {
      if (!alerts[deviceId]?.lowBattery) {
        await sendEmail(
          "⚠️ Low Battery",
          `User: ${deviceId}
Device Serial: ${serial}

Battery: ${battery.level}%
Charging: ${battery.charging}

Last AP: ${apName}`
        );

        alerts[deviceId] = {
          ...alerts[deviceId],
          lowBattery: true
        };
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
