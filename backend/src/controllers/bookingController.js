const ApiError = require("../utils/apiError");
const { successResponse } = require("../utils/response");
const { config } = require("../config/env");
const { hasTwilio, sendSms } = require("../utils/twilioClient");

function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;

  const isWhatsapp = raw.toLowerCase().startsWith("whatsapp:");
  const clean = raw.replace(/^whatsapp:/i, "").replace(/[^0-9]/g, "");
  if (!clean) return null;
  const normalized = clean.length === 10 ? `+91${clean}` : `+${clean}`;
  return isWhatsapp ? `whatsapp:${normalized}` : normalized;
}

function buildNotificationPayload(booking, userInfo) {
  const lines = [
    "New booking received:",
    `Service: ${booking.service}`,
    `Date: ${booking.date}`,
    `Time: ${booking.time}`,
    `Duration: ${booking.duration} min`,
    `Priority: ${booking.priority}`,
    `Customer: ${booking.customerName || "N/A"}`,
    `Customer Phone: ${booking.customerPhone || "N/A"}`,
    `Need: ${booking.sessionPurpose || "N/A"}`,
  ];

  if (booking.sessionDetails) {
    lines.push(`Details: ${booking.sessionDetails}`);
  }
  if (booking.notes) {
    lines.push(`Notes: ${booking.notes}`);
  }

  if (userInfo) {
    lines.push(`Booked by: ${userInfo.name || userInfo.email || userInfo.id}`);
  }

  return lines.join("\n");
}

async function bookSession(req, res) {
  const { service, date, time, duration = 60, priority = "normal", notes = "", sessionPurpose = "", sessionDetails = "", customerName = "", customerPhone = "" } = req.body || {};

  if (!service || !date || !time) {
    throw new ApiError(400, "Service, date, and time are required to book a session");
  }
  if (!customerName.trim() || !customerPhone.trim()) {
    throw new ApiError(400, "Customer name and phone are required for booking");
  }
  if (!sessionPurpose.trim()) {
    throw new ApiError(400, "Please describe what you need from this session");
  }

  const validatedDuration = Number(duration);
  if (!Number.isFinite(validatedDuration) || validatedDuration <= 0) {
    throw new ApiError(400, "Duration must be a positive number");
  }

  const booking = {
    id: `BK-${Date.now().toString(36).toUpperCase()}`,
    service,
    date,
    time,
    duration: validatedDuration,
    priority: priority === "urgent" ? "urgent" : "normal",
    notes: String(notes || "").trim(),
    sessionPurpose: String(sessionPurpose || "").trim(),
    sessionDetails: String(sessionDetails || "").trim(),
    customerName: String(customerName || "").trim(),
    customerPhone: String(customerPhone || "").trim(),
    status: "upcoming",
    createdAt: new Date().toISOString(),
  };

  const owner = req.user ? { id: req.user.id || req.user._id, name: req.user.name, email: req.user.email } : null;
  const requiredPhones = ["8778508652", "9994777865"];
  const configuredPhones = String(config.bookingNotificationPhones || "8778508652,9994777865")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const phoneList = Array.from(
    new Set(
      [...configuredPhones, ...requiredPhones]
        .map((p) => normalizePhoneNumber(p))
        .filter(Boolean)
    )
  );

  const notificationBody = buildNotificationPayload(booking, owner);
  const notifications = [];

  if (phoneList.length && hasTwilio) {
    for (const phone of phoneList) {
      try {
        const result = await sendSms(phone, notificationBody);
        notifications.push({ phone, status: "sent", sid: result.sid || null });
      } catch (err) {
        notifications.push({ phone, status: "failed", error: err.message });
      }
    }
  } else {
    for (const phone of phoneList) {
      notifications.push({ phone, status: hasTwilio ? "skipped" : "disabled" });
    }
  }

  return successResponse(res, "Session booked", {
    booking,
    notified: notifications,
    twilioConfigured: hasTwilio,
  });
}

module.exports = {
  bookSession,
};
