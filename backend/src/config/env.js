function getEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    return ""; // return empty instead of crashing
  }
  return value;
}

// No-op validateEnv — validation is now handled gracefully in server.js
function validateEnv() {}

module.exports = {
  validateEnv,
  config: {
    nodeEnv:             getEnv("NODE_ENV",              "development"),
    port:                Number(getEnv("PORT",           "3000")),
    // mongoUri:            getEnv("MONGO_URI",             "mongodb://127.0.0.1:27017/vetroai_auth"),
    // jwtSecret:           getEnv("JWT_SECRET",            "vetroai_dev_secret_fallback_2024"),
    // jwtRefreshSecret:    getEnv("JWT_REFRESH_SECRET",    "vetroai_dev_refresh_fallback_2024"),
    jwtAccessExpiresIn:  getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
    jwtRefreshExpiresIn: getEnv("JWT_REFRESH_EXPIRES_IN","7d"),
    bcryptSaltRounds:    Number(getEnv("BCRYPT_SALT_ROUNDS", "12")),
    corsOrigin:          getEnv("CORS_ORIGIN",           "http://localhost:5173,http://localhost:5174"),
    groqApiKey:          getEnv("GROQ_API_KEY",          ""),   // optional — Pollinations.ai fallback used if empty
    groqModel:           getEnv("GROQ_MODEL",            "llama-3.3-70b-versatile"),
    groqTemperature:     Number(getEnv("GROQ_TEMPERATURE", "0.7")),
    groqMaxTokens:       Number(getEnv("GROQ_MAX_TOKENS",  "16384")),
    enableCloudSessions: getEnv("ENABLE_CLOUD_SESSIONS", "false") === "true",
  },
};
