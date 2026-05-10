const { config } = require("../config/env");

const twilioAccountSid = config.twilioAccountSid;
const twilioAuthToken = config.twilioAuthToken;
const twilioFromNumber = config.twilioFromNumber;

const hasTwilio = Boolean(twilioAccountSid && twilioAuthToken && twilioFromNumber);

function normalizeTwilioPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const isWhatsapp = raw.toLowerCase().startsWith("whatsapp:");
  const clean = raw.replace(/^whatsapp:/i, "").replace(/[^0-9]/g, "");
  if (!clean) return null;
  const normalized = clean.length === 10 ? `+91${clean}` : `+${clean}`;
  return isWhatsapp ? `whatsapp:${normalized}` : normalized;
}

function makeRecipient(to) {
  const fromIsWhatsapp = String(twilioFromNumber || "").toLowerCase().startsWith("whatsapp:");
  const normalizedTo = normalizeTwilioPhone(to);
  if (!normalizedTo) return null;
  if (fromIsWhatsapp && !normalizedTo.toLowerCase().startsWith("whatsapp:")) {
    return `whatsapp:${normalizedTo}`;
  }
  return normalizedTo;
}

async function sendSms(to, body) {
  if (!hasTwilio) {
    throw new Error("Twilio configuration is missing");
  }
  if (!to || !body) {
    throw new Error("Missing Twilio payload");
  }

  const recipient = makeRecipient(to);
  if (!recipient) {
    throw new Error("Invalid recipient phone number");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: recipient,
    From: twilioFromNumber,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const payload = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${payload}`);
  }

  return res.json();
}

module.exports = {
  hasTwilio,
  sendSms,
};
