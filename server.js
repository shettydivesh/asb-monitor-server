const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const alerts = {};

function sendEmail(subject, text) {
  transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "shettyd@asbindia.org",
    subject,
    text
  });
}

app.post("/heartbeat", (req, res) => {
  const { deviceId, battery, ip, isSchool } = req.body;

  console.log(deviceId, battery?.level, ip);

  if (battery?.level < 9 && !battery?.charging) {
    if (!alerts[deviceId]?.lowBattery) {
      sendEmail("⚠️ Low Battery", `Device ${deviceId} at ${battery.level}%`);
      alerts[deviceId] = { ...alerts[deviceId], lowBattery: true };
    }
  }

  if (!isSchool) {
    if (!alerts[deviceId]?.network) {
      sendEmail("🚨 Left ASB Network", `Device ${deviceId} IP: ${ip}`);
      alerts[deviceId] = { ...alerts[deviceId], network: true };
    }
  }

  res.send({ ok: true });
});

app.listen(3000, () => console.log("Server running"));
