const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors());

const resend = new Resend(process.env.RESEND_API_KEY);

// 🔐 Meraki config
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

// 📡 Get Meraki client info
async function getMerakiClient(ip) {
  try {
    const res = await axios.get(
      `https://api.meraki.com/api/v1/networks/${NETWORK_ID}/clients`,
      {
        headers: {
          "X-Cisco-Meraki-API-Key": MERAKI_API_KEY
        },
        params: {
          perPage: 1000
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
    console.error("❌ Meraki API error:", err.message);
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

// ❤️ Endpoint
app.post("/heartbeat", async (req, res) => {
  try {
    const {
      deviceId = "unknown",
      battery = {},
      ip = "unknown",
      isSchool = true
    } = req.body;

    console.log("📡 Heartbeat:", deviceId, battery.level, ip, isSchool);

    let merakiData = null;

    if (ip !== "unknown") {
      merakiData = await getMerakiClient(ip);
    }

    // 🔋 Battery alert
    if (battery.level !== undefined && battery.level < 9 && !battery.charging) {
      if (!alerts[deviceId]?.lowBattery) {
        sendEmail(
          "⚠️ Low Battery",
          `Device: ${deviceId}
Battery: ${battery.level}%
Charging: ${battery.charging}

Last AP: ${merakiData?.apName || "Unknown"}
SSID: ${merakiData?.ssid || "Unknown"}`
        );

        alerts[deviceId] = { ...alerts[deviceId], lowBattery: true };
      }
    }

    // 🚨 Left network alert
    if (!isSchool) {
      if (!alerts[deviceId]?.network) {
        sendEmail(
          "🚨 Left ASB Network",
          `Device: ${deviceId}
IP: ${ip}

Last AP: ${merakiData?.apName || "Unknown"}
SSID: ${merakiData?.ssid || "Unknown"}
Last Seen: ${merakiData?.lastSeen || "Unknown"}`
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

// 🏠 Health
app.get("/", (req, res) => {
  res.send("ASB Monitor Running 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
