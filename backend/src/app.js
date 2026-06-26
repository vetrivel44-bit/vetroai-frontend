const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const authRoutes = require("./routes/authRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const chatSessionRoutes = require("./routes/chatSessionRoutes");
const chatRoutes = require("./routes/chatRoutes");
const mapsRoutes = require("./routes/mapsRoutes");
const { config } = require("./config/env");
const logger = require("./utils/logger");
const { successResponse } = require("./utils/response");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // For development, allow all sources for scripts
}));
app.use(
  cors({
    origin: function (origin, callback) {
      callback(null, true);
    },
    credentials: true,
  })
);
// Stripe needs the raw, unparsed body to verify webhook signatures — must be
// registered before the global express.json() parser below.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  require("./controllers/billingController").webhook
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  morgan("combined", {
    stream: {
      write: (message) => logger.info("http.request", { message: message.trim() }),
    },
  })
);

if (config.nodeEnv === "development" && !process.env.RENDER) {
  app.use(require("./middleware/debugMiddleware"));
}

app.get("/", (req, res) => {
  res.send("Backend running - VetroAI (Production)");
});

app.get("/api/health", (req, res) => {
  return res.json({ success: true, status: "ok", mode: "production" });
});

app.get("/health", (_req, res) => {
  logger.info("health.check", { env: config.nodeEnv, render: !!process.env.RENDER });
  return successResponse(res, "Service is healthy", {
    backend: "online",
    uptime: process.uptime(),
    providers: require("./services/ProviderManager").getStats()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/sessions", chatSessionRoutes);
app.use("/api/billing", require("./routes/billingRoutes"));
app.use("/api/maps", mapsRoutes);
app.use("/api/debug", require("./routes/debugRoutes"));
app.use("/api/code", require("./routes/codeRoutes"));
app.use("/api/cricket", require("./routes/cricketRoutes"));
app.use("/api", chatRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
