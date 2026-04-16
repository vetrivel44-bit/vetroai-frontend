const mongoose = require("mongoose");
const { config } = require("./env");
const logger = require("../utils/logger");

async function connectDatabase() {
  await mongoose.connect(config.mongoUri, {
    autoIndex: true,
  });
  logger.info("database.connected", { host: mongoose.connection.host });
}

module.exports = connectDatabase;
