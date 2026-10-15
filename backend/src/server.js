const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const app = require("./app");
const { config } = require("./config/env");
const logger = require("./utils/logger");
const connectDatabase = require("./config/db");

async function bootstrap() {
  // Validate only non-DB required envs (skip GROQ_API_KEY / MONGO_URI if missing)
  const missing = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter(k => !process.env[k]);
  if (missing.length) {
    logger.info("server.env_warning", { missing, note: "Using fallback values for development" });
    // Set fallback values so the server can still start
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "vetroai_dev_secret_fallback_2024";
    if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = "vetroai_dev_refresh_fallback_2024";
  }

  // MongoDB is optional — without MONGO_URI the app still runs in offline/in-memory
  // auth mode, but billing/credits/plans require a real DB to persist.
  let dbConnected = false;
  if (config.mongoUri) {
    try {
      await connectDatabase();
      dbConnected = true;
    } catch (err) {
      logger.info("server.db_skipped", { message: err.message, note: "Running without MongoDB — offline auth mode active" });
    }
  } else {
    logger.info("server.db_skipped", { note: "MONGO_URI not set — running in offline mode (billing/persistent accounts disabled)" });
  }

  app.listen(config.port, "0.0.0.0", () => {
    logger.info("server.started", {
      port: config.port,
      env: config.nodeEnv,
      groqKey: process.env.GROQ_API_KEY ? "✅ configured" : "⚠️ missing",
      stripeKey: process.env.STRIPE_SECRET_KEY ? "✅ configured" : "⚠️ missing",
      mongodb: dbConnected ? "connected" : "offline mode",
    });
  });
}

bootstrap().catch((err) => {
  logger.error("server.bootstrap_failed", { message: err.message });
  process.exit(1);
});
