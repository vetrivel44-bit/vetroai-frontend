const express = require("express");
const mongoose = require("mongoose");
// The production entry point (index.js at the repo root) never connects to
// MongoDB. Mongoose's default is to hold every query until a connection
// arrives and give up after 10 s — which made every signed-in request (the
// account lookup in authMiddleware) wait 10 s before anything else ran.
// Without a connection a query now fails at once, and its caller's existing
// fallback takes over.
mongoose.set("bufferCommands", false);
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
// Render (like most hosts) puts one proxy in front of the app. Trusting that
// one hop makes req.ip the visitor's address, taken from the X-Forwarded-For
// entry Render appends — without it every request came from the proxy, so
// per-IP rate limits and visitor usage limits lumped all users together.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

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
    providers: require("./services/ProviderManager").getStats(),
    // Which outside services are set up (never their keys), so a deploy can be
    // checked from a browser: is astrology on ProKerala, what does DeepSearch use?
    integrations: {
      prokerala: require("./services/prokeralaService").isConfigured() ? "configured" : "not configured",
      webSearch: require("./controllers/searchController").resolveSearchProvider() === "parallel" ? "parallel (Search MCP)"
        : require("./controllers/searchController").resolveSearchProvider() === "none" ? "disabled"
        : config.tavilyApiKey ? "tavily" : "keyless fallback (DuckDuckGo, Bing, Google News)",
      researchModel: config.groqApiKey ? `groq (${config.researchModel})` : config.mistralApiKey ? "mistral" : "none (DeepSearch runs without planning)",
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/sessions", chatSessionRoutes);
app.use("/api/billing", require("./routes/billingRoutes"));
app.use("/api/usage", require("./routes/usageRoutes"));
app.use("/api/schedules", require("./routes/scheduleRoutes"));
app.use("/api/maps", mapsRoutes);
app.use("/api/debug", require("./routes/debugRoutes"));
app.use("/api/code", require("./routes/codeRoutes"));
app.use("/api/cricket", require("./routes/cricketRoutes"));
app.use("/api/voice-cover", require("./routes/voiceCoverRoutes"));
app.use("/api/call-assistant", require("./routes/callAssistantRoutes"));
app.use("/api/chess", require("./routes/chessRoutes"));
app.use("/api/web-search", require("./routes/webSearchRoutes"));
app.use("/api/time", require("./routes/timeRoutes"));
app.use("/api/site-image", require("./routes/siteImageRoutes"));
app.use("/api", require("./routes/externalDataRoutes"));
app.use("/api/mock/buses", require("./routes/busMockRoutes"));
app.use("/api", chatRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
