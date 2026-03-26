from flask import Flask, request, jsonify
import smtplib
from email.mime.text import MIMEText

app = Flask(__name__)

EMAIL_FROM = "asbtest@asbindia.org"
EMAIL_PASSWORD = "Welcome2526%"   
EMAIL_TO = "shettyd@asbindia.org"

SMTP_SERVER = "smtp.office365.com"
SMTP_PORT = 587

def send_email(subject, body):
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = EMAIL_FROM
    msg["To"] = EMAIL_TO

    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
        server.starttls()
        server.login(EMAIL_FROM, EMAIL_PASSWORD)
        server.send_message(msg)

@app.route("/alert", methods=["POST"])
def alert():
    data = request.json
    alert_type = data.get("type")
    details = data.get("data")
    device = data.get("deviceId")

    if alert_type == "LOW_BATTERY":
        send_email(
            "⚠️ Chromebook Low Battery",
            f"Device: {device}\nBattery: {details}"
        )

    elif alert_type == "LEFT_NETWORK":
        send_email(
            "🚨 Device Left ASB Network",
            f"Device: {device}\nIP: {details}"
        )

    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(port=5000)