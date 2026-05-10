const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
// const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const { config } = require("./config/env");
const logger = require("./utils/logger");
const { successResponse } = require("./utils/response");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin.split(",").map((origin) => origin.trim()),
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

// app.use("/api/auth", authRoutes);
app.use("/", chatRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
