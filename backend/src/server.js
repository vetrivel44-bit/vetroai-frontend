require("dotenv").config();

const app = require("./app");
const connectDatabase = require("./config/db");
const { validateEnv, config } = require("./config/env");
const logger = require("./utils/logger");

async function bootstrap() {
  validateEnv();
  await connectDatabase();

  app.listen(config.port, () => {
    logger.info("server.started", {
      port: config.port,
      env: config.nodeEnv,
    });
  });
}

bootstrap().catch((err) => {
  logger.error("server.bootstrap_failed", { message: err.message });
  process.exit(1);
});
