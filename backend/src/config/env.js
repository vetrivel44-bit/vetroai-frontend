const requiredEnv = [
  "MONGO_URI",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
];

function getEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateEnv() {
  requiredEnv.forEach((name) => {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  });
}

module.exports = {
  validateEnv,
  config: {
    nodeEnv: getEnv("NODE_ENV", "development"),
    port: Number(getEnv("PORT", "3000")),
    mongoUri: getEnv("MONGO_URI"),
    jwtSecret: getEnv("JWT_SECRET"),
    jwtRefreshSecret: getEnv("JWT_REFRESH_SECRET"),
    jwtAccessExpiresIn: getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
    jwtRefreshExpiresIn: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),
    bcryptSaltRounds: Number(getEnv("BCRYPT_SALT_ROUNDS", "12")),
    corsOrigin: getEnv("CORS_ORIGIN", "http://localhost:5173"),
  },
};
