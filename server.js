const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 ENV
const resend = new Resend(process.env.RESEND_API_KEY);
const MERAKI_API_KEY = process.env.MERAKI_API_KEY;
const NETWORK_ID = "L_602356450160822442";

// 🧠 Alert memory
const alerts = {};

// ⏱ Reset alerts every 30 mins
setInterval(() => {
  console.log("🔄 Resetting alert flags");
  for (let device in alerts) {
    alerts[device] = {};
  }
}, 30 * 60 * 1000);

// 📡 Get Meraki client info (SAFE)
async function getMerakiClient(ip) {
  try {
    if (!MERAKI_API_KEY) {
      console.log("⚠️ Meraki key missing");
      return null;
    }

    // Skip fake / placeholder IP
    if (!ip || ip === "unknown" || ip.includes("x")) {
      return null;
    }

    const res = await axios.get(
      `https://api.meraki.com/api/v1/networks/${NETWORK_ID}/clients`,
      {
        headers: {
          "X-Cisco-Meraki-API-Key": MERAKI_API_KEY
        },
        params: {
          perPage: 1000,
          timespan: 300 // last 5 mins (IMPORTANT)
        }
      }
    );

    const client = res.data.find(c => c.ip === ip);

    if (!client) return null;

    return {
      ssid: client.ssid,
      apName: client.recentDeviceName,
      lastSeen: client.lastSeen
    };

  } catch (err) {
    console.error("❌ Meraki API error:", err.response?.status || err.message);
    return null;
  }
}

// 📧 Send email
async function sendEmail(subject, text) {
  try {
    console.log("📧 Sending email...");

    await resend.emails.send({
      from: "ASB Monitor <onboarding@resend.dev>", // change after domain verify
      to: ["shettyd@asbindia.org"],
      subject,
      text
    });

    console.log("✅ Email sent");
  } catch (err) {
    console.error("❌ Email error:", err);
  }
}

// ❤️ Endpoint
app.post("/heartbeat", async (req, res) => {
  try {
    const {
      deviceId = "unknown",
      battery = {},
      ip = "unknown",
      isSchool = true,
      campus = "Unknown",
      ssid = "Unknown"
    } = req.body;

    console.log("📡 Heartbeat:", deviceId, battery.level, isSchool, campus);

    let merakiData = null;

    // Only try Meraki if IP is usable
    if (ip !== "unknown" && !ip.includes("x")) {
      merakiData = await getMerakiClient(ip);
    }

    const apName = merakiData?.apName || "Unknown";
    const finalSSID = merakiData?.ssid || ssid;
    const lastSeen = merakiData?.lastSeen || "Unknown";

    // 🔋 LOW BATTERY
    if (battery.level !== undefined && battery.level < 9 && !battery.charging) {
      if (!alerts[deviceId]?.lowBattery) {
        sendEmail(
          "⚠️ Low Battery",
          `Campus: ${campus}
SSID: ${finalSSID}

Device: ${deviceId}
Battery: ${battery.level}%
Charging: ${battery.charging}

Last AP: ${apName}`
        );

        alerts[deviceId] = { ...alerts[deviceId], lowBattery: true };
      }
    }

    // 🚨 LEFT NETWORK
    if (!isSchool) {
      if (!alerts[deviceId]?.network) {
        sendEmail(
          "🚨 Left ASB Network",
          `Campus: ${campus}
Last SSID: ${finalSSID}

Device: ${deviceId}

Last AP: ${apName}
Last Seen: ${lastSeen}

Status: Device left school network`
        );

        alerts[deviceId] = { ...alerts[deviceId], network: true };
      }
    }

    res.send({ ok: true });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error");
  }
});

// 🏠 Health check
app.get("/", (req, res) => {
  res.send("ASB Monitor Running 🚀");
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
