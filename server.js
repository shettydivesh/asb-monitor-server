const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 ENV validation
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error("❌ Missing EMAIL_USER or EMAIL_PASS");
  process.exit(1);
}

// 📧 Office365 SMTP (fixed config)
const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  },
  tls: {
    ciphers: "SSLv3"
  }
});

// 🧠 Store alerts per device
const alerts = {};

// ⏱ Reset alerts every 30 mins (so you can get alerts again)
setInterval(() => {
  console.log("🔄 Resetting alert flags");
  for (let device in alerts) {
    alerts[device] = {};
  }
}, 30 * 60 * 1000);

// 📧 Send email helper
function sendEmail(subject, text) {
  transporter.sendMail({
    from: EMAIL_USER,
    to: "shettyd@asbindia.org",
    subject,
    text
  }, (err, info) => {
    if (err) {
      console.error("❌ Email error:", err);
    } else {
      console.log("✅ Email sent:", info.response);
    }
  });
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
