const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs-extra");

const JWT_SECRET = process.env.JWT_SECRET || "vetroai_secret_key_2025";
const USERS_FILE = "./users.json";

// ── Helper: load / save users ──────────────────────────────────────────────
async function loadUsers() {
  if (!(await fs.pathExists(USERS_FILE))) return [];
  try { return await fs.readJson(USERS_FILE); } catch { return []; }
}
async function saveUsers(users) {
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
}

// ── Signup ─────────────────────────────────────────────────────────────────
async function signup(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const users = await loadUsers();
  if (users.find(u => u.email === email))
    return res.status(400).json({ error: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const displayName = name?.trim() || email.split("@")[0];
  users.push({
    email,
    password: hashed,
    name: displayName,
    createdAt: new Date().toISOString(),
  });
  await saveUsers(users);
  res.json({ message: "Signup successful" });
}

// ── Login ──────────────────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const users = await loadUsers();
  const user = users.find(u => u.email === email);
  if (!user || !user.password)
    return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { email, name: user.name || email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token, name: user.name, email });
}

// ── Auth Middleware ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.user = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { signup, login, authMiddleware };