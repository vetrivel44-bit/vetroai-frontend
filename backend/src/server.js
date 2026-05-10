const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const app = require("./app");
const { config } = require("./config/env");
const logger = require("./utils/logger");

// ── No MongoDB ───────────────────────────────────────────────────────────
// Removed MongoDB connection for offline mode

async function bootstrap() {
  // Validate only non-DB required envs (skip GROQ_API_KEY / MONGO_URI if missing)
  const missing = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter(k => !process.env[k]);
  if (missing.length) {
    logger.info("server.env_warning", { missing, note: "Using fallback values for development" });
    // Set fallback values so the server can still start
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "vetroai_dev_secret_fallback_2024";
    if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = "vetroai_dev_refresh_fallback_2024";
  }

  // MongoDB is removed — running in offline mode
  // if (connectDatabase) {
  //   try {
  //     await connectDatabase();
  //     logger.info("server.db_connected");
  //   } catch (err) {
  //     logger.info("server.db_skipped", { message: err.message, note: "Running without MongoDB — offline auth mode active" });
  //   }
  // }

  app.listen(config.port, () => {
    logger.info("server.started", {
      port: config.port,
      env: config.nodeEnv,
      groqKey: process.env.GROQ_API_KEY ? "✅ configured" : "⚠️ missing (using Pollinations.ai fallback)",
      mongodb: "removed (offline mode)",
    });
  });
}

bootstrap().catch((err) => {
  logger.error("server.bootstrap_failed", { message: err.message });
  process.exit(1);
});
