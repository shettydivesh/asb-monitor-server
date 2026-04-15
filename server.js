const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 API KEY (put new one here)
const resend = new Resend("re_BqeKwGUu_FzugKgoRGbEChGwRq368DWdj");

// 🧠 Store alerts per device
const alerts = {};

// ⏱ Reset alerts every 30 mins
setInterval(() => {
  console.log("🔄 Resetting alert flags");
  for (let device in alerts) {
    alerts[device] = {};
  }
}, 30 * 60 * 1000);

// 📧 Send email helper (RESEND)
async function sendEmail(subject, text) {
  try {
    await resend.emails.send({
      from: "ASB Monitor <onboarding@resend.dev>", // temporary sender
      to: ["shettyd@asbindia.org"],
      subject,
      text
    });

    console.log("✅ Email sent via Resend");
  } catch (err) {
    console.error("❌ Email error:", err);
  }
}

// 🏠 Health check
app.get("/", (req, res) => {
  res.send("ASB Monitor Server Running ✅");
});

// ❤️ Heartbeat endpoint
app.post("/heartbeat", (req, res) => {
  try {
    const {
      deviceId = "unknown",
      battery = {},
      ip = "unknown",
      isSchool = true
    } = req.body;

    console.log("📡 Heartbeat:", deviceId, battery.level, ip, isSchool);

    // 🔋 LOW BATTERY ALERT
    if (battery.level !== undefined && battery.level < 9 && !battery.charging) {
      if (!alerts[deviceId]?.lowBattery) {
        sendEmail(
          "⚠️ Low Battery",
          `Device: ${deviceId}\nBattery: ${battery.level}%\nCharging: ${battery.charging}`
        );

        alerts[deviceId] = { ...alerts[deviceId], lowBattery: true };
      }
    }

    // 🚨 LEFT NETWORK ALERT
    if (!isSchool) {
      if (!alerts[deviceId]?.network) {
        sendEmail(
          "🚨 Left ASB Network",
          `Device: ${deviceId}\nIP: ${ip}\nStatus: Outside School Network`
        );

        alerts[deviceId] = { ...alerts[deviceId], network: true };
      }
    }

    res.send({ ok: true });

  } catch (err) {
    console.error("❌ Error in /heartbeat:", err);
    res.status(500).send("Error");
  }
});

// 🚀 Render PORT fix
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
