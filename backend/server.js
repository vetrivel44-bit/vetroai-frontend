import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend running - VetroAI");
});

// Multiple health check endpoints for robustness
app.get("/health", (req, res) => res.json({ success: true, status: "ok" }));
app.get("/api/health", (req, res) => res.json({ success: true, status: "ok" }));
app.get("/api/chat/health", (req, res) => res.json({ success: true, status: "ok" }));

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
