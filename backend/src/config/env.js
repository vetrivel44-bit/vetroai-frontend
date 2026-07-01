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
    mongoUri:            getEnv("MONGO_URI",             ""),
    frontendUrl:         getEnv("FRONTEND_URL",          "http://localhost:5174"),
    jwtSecret:           getEnv("JWT_SECRET",            "vetroai_dev_secret_fallback_2024"),
    jwtRefreshSecret:    getEnv("JWT_REFRESH_SECRET",    "vetroai_dev_refresh_fallback_2024"),
    jwtAccessExpiresIn:  getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
    jwtRefreshExpiresIn: getEnv("JWT_REFRESH_EXPIRES_IN","7d"),
    bcryptSaltRounds:    Number(getEnv("BCRYPT_SALT_ROUNDS", "12")),
    corsOrigin:          getEnv("CORS_ORIGIN",           "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"),
    groqApiKey:          getEnv("GROQ_API_KEY",          ""),
    groqModel:           getEnv("GROQ_MODEL",            "llama-3.3-70b-versatile"),
    groqTemperature:     Number(getEnv("GROQ_TEMPERATURE", "0.7")),
    groqMaxTokens:       Number(getEnv("GROQ_MAX_TOKENS",  "16384")),
    mistralApiKey:       getEnv("MISTRAL_API_KEY",       ""),
    mistralModel:        getEnv("MISTRAL_MODEL",        "mistral-small-latest"),
    mistralTemperature:  Number(getEnv("MISTRAL_TEMPERATURE", "0.7")),
    mistralMaxTokens:    Number(getEnv("MISTRAL_MAX_TOKENS",  "8192")),
    chatgptApiKey:       getEnv("CHATGPT_API_KEY",       ""),
    geminiApiKey:        getEnv("GEMINI_API_KEY",        ""),
    sambanovaApiKey:     getEnv("SAMBANOVA_API_KEY",     ""),
    agnesApiKey:         getEnv("AGNES_API_KEY",         ""),
    agnesModel:          getEnv("AGNES_MODEL",           "agnes-2.0-flash"),
    googleMapsApiKey:    getEnv("GOOGLE_MAPS_API_KEY", ""),
    googleClientId:      getEnv("VITE_GOOGLE_CLIENT_ID", "592184427551-7hs7t358m2k3vn60amdv8vnm8b26oprt.apps.googleusercontent.com"),
    enableCloudSessions: getEnv("ENABLE_CLOUD_SESSIONS", "false") === "true",
    twilioAccountSid:    getEnv("TWILIO_ACCOUNT_SID",    ""),
    twilioAuthToken:     getEnv("TWILIO_AUTH_TOKEN",     ""),
    twilioFromNumber:    getEnv("TWILIO_FROM_NUMBER",    ""),
    bookingNotificationPhones: getEnv("BOOKING_NOTIFICATION_PHONES", "8778508652,9994777865"),
    tavilyApiKey:        getEnv("TAVILY_API_KEY",         ""),
    stripeSecretKey:        getEnv("STRIPE_SECRET_KEY",        ""),
    stripePublishableKey:   getEnv("STRIPE_PUBLISHABLE_KEY",   ""),
    stripeWebhookSecret:    getEnv("STRIPE_WEBHOOK_SECRET",    ""),
    stripePriceProMonthly:  getEnv("STRIPE_PRICE_PRO_MONTHLY", ""),
    stripePriceTeamMonthly: getEnv("STRIPE_PRICE_TEAM_MONTHLY",""),
  },
};
