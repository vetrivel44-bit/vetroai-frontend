const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "backend", ".env") });

const app = require("./backend/src/app");
const { config } = require("./backend/src/config/env");
const logger = require("./backend/src/utils/logger");

const PORT = process.env.PORT || config.port || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info("server.started.production", {
    port: PORT,
    env: config.nodeEnv,
    groqKey: process.env.GROQ_API_KEY ? "✅ configured" : "⚠️ missing",
    mongodb: "removed (offline mode)",
  });
});

// Keep the Node server's connection timings friendly to Render's proxy and to
// long streaming responses. A chat turn holds one SSE connection open for as
// long as the model takes, and Node's 5s default keep-alive closes it from
// under the proxy, which the browser sees as a truncated answer. headersTimeout
// must stay above keepAliveTimeout, and a streaming request has no meaningful
// overall deadline of its own — the orchestrator enforces its own per-attempt
// timeouts.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0;
