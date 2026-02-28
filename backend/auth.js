const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs-extra");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET || "vetroai_secret_key_2025";
const USERS_FILE = "./users.json";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ── Helper: load users safely ──────────────────────────────────────────────
async function loadUsers() {
  if (!(await fs.pathExists(USERS_FILE))) return [];
  try { return await fs.readJson(USERS_FILE); } catch { return []; }
}
async function saveUsers(users) {
  await fs.writeJson(USERS_FILE, users, { spaces: 2 });
}

// ── Google OAuth Sign-In ───────────────────────────────────────────────────
async function googleAuth(req, res) {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing Google credential" });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured on server" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const { email, name, picture, sub: googleId } = ticket.getPayload();

    const users = await loadUsers();
    let user = users.find(u => u.email === email);

    if (!user) {
      user = { email, name, picture, googleId, createdAt: new Date().toISOString() };
      users.push(user);
    } else {
      user.name = name;
      user.picture = picture;
    }
    await saveUsers(users);

    const token = jwt.sign({ email, name, picture }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, name, picture, email });
  } catch (err) {
    console.error("Google auth error:", err.message);
    res.status(401).json({ error: "Invalid Google credential" });
  }
}

// ── Email/Password (kept as fallback) ─────────────────────────────────────
async function signup(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });

  const users = await loadUsers();
  if (users.find(u => u.email === email))
    return res.status(400).json({ error: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  users.push({ email, password: hashed, name: email.split("@")[0], createdAt: new Date().toISOString() });
  await saveUsers(users);
  res.json({ message: "Signup successful" });
}

async function login(req, res) {
  const { email, password } = req.body;
  const users = await loadUsers();
  const user = users.find(u => u.email === email);
  if (!user || !user.password) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ email, name: user.name || email }, JWT_SECRET, { expiresIn: "7d" });
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

module.exports = { signup, login, googleAuth, authMiddleware };