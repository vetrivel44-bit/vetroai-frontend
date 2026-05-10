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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  morgan("combined", {
    stream: {
      write: (message) => logger.info("http.request", { message: message.trim() }),
    },
  })
);

app.get("/health", (_req, res) =>
  successResponse(res, "Service is healthy", {
    uptime: process.uptime(),
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/sessions", chatSessionRoutes);
app.use("/api/maps", mapsRoutes);
app.use("/", chatRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
