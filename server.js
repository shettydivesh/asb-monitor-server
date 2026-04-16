const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(cors({
  origin: ["chrome-extension://*", "https://asb-monitor-server.onrender.com"]
}));

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

async function getBestMerakiMatch(eventTime) {
  try {
    const res = await axios.get(
      `https://api.meraki.com/api/v1/networks/${NETWORK_ID}/clients`,
      {
        headers: {
          "X-Cisco-Meraki-API-Key": MERAKI_API_KEY
        },
        params: {
          perPage: 1000,
          timespan: 180
        }
      }
    );

    const clients = res.data.filter(c => c.ssid === "ASB_Student");

    if (!clients.length) return null;

    const eventTs = new Date(eventTime).getTime();

    let best = null;
    let minDiff = Infinity;

    for (const c of clients) {
      const seen = new Date(c.lastSeen).getTime();
      const diff = Math.abs(eventTs - seen);

      if (diff < minDiff) {
        minDiff = diff;
        best = c;
      }
    }

    return best;

  } catch (err) {
    console.error("❌ Meraki error:", err.message);
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
      isSchool = true,
      networkChanged = false,
      campus = "Unknown",
      ssid = "Unknown"
    } = req.body;

    console.log("📡 Heartbeat:", deviceId, battery.level, isSchool, networkChanged);

    let merakiData = null;

   if (!isSchool && networkChanged) {
  merakiData = await getBestMerakiMatch(req.body.timestamp);
}

    const apName = merakiData?.recentDeviceName || "Unknown";
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

    // 🚨 LEFT NETWORK (ONLY on change)
    if (!isSchool && networkChanged) {
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
