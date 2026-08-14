const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const app = require("./app");
const { config, validateEnv } = require("./config/env");
const logger = require("./utils/logger");
const connectDatabase = require("./config/db");

async function bootstrap() {
  // Production must have real authentication secrets. Development may run
  // without them, but token creation will fail until they are configured.
  try {
    validateEnv();
  } catch (err) {
    logger.error("server.env_validation_failed", { message: err.message });
    process.exit(1);
  }

  const missingAuthSecrets = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter(
    (key) => !process.env[key]
  );
  if (missingAuthSecrets.length) {
    logger.info("server.env_warning", {
      missing: missingAuthSecrets,
      note: "Authentication secrets are not configured; auth token operations will be unavailable.",
    });
  }

  // MongoDB is optional — without MONGO_URI the app still runs in offline/in-memory
  // auth mode, but billing/credits/plans require a real DB to persist.
  let dbConnected = false;
  if (config.mongoUri) {
    try {
      await connectDatabase();
      dbConnected = true;
    } catch (err) {
      logger.info("server.db_skipped", {
        message: err.message,
        note: "Running without MongoDB — offline auth mode active",
      });
    }
  } else {
    logger.info("server.db_skipped", {
      note: "MONGO_URI not set — running in offline mode (billing/persistent accounts disabled)",
    });
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
