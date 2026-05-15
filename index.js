const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "backend", ".env") });

const app = require("./backend/src/app");
const { config } = require("./backend/src/config/env");
const logger = require("./backend/src/utils/logger");

const PORT = process.env.PORT || config.port || 3000;

app.listen(PORT, "0.0.0.0", () => {
  logger.info("server.started.production", {
    port: PORT,
    env: config.nodeEnv,
    groqKey: process.env.GROQ_API_KEY ? "✅ configured" : "⚠️ missing",
    mongodb: "removed (offline mode)",
  });
});
