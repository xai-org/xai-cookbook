/**
 * XAI Voice Web Backend - Node.js
 *
 * Express server that provides ephemeral tokens for direct client-to-XAI connections.
 * The client connects directly to XAI's realtime API using the ephemeral token.
 */

import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";

const app = express();

// CORS Configuration - Configure for your specific domain in production
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173,http://localhost:8080").split(",");

// Enable CORS for web clients - restricted to specific origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

const sessionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many session creation requests, please try again later.'
});

app.use(limiter);

// Configuration
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const PORT = process.env.PORT || "8000";
const INSTRUCTIONS = process.env.INSTRUCTIONS || "You are a helpful voice assistant. You are speaking to a user in real-time over audio. Keep your responses conversational and concise since they will be spoken aloud.";
const VOICE = process.env.VOICE || "ara";

// ========================================
// REST API Endpoints
// ========================================

app.get("/", (req, res) => {
  res.json({
    service: "XAI Voice Web Backend (Node.js)",
    provider: "XAI",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/health",
      session: "/session",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    provider: "XAI",
    timestamp: new Date().toISOString(),
  });
});

// Ephemeral token endpoint for direct client connection to XAI API
app.post("/session", sessionLimiter, async (req, res) => {
  try {
    console.log("📝 Creating ephemeral session...");

    const SESSION_REQUEST_URL = "https://api.x.ai/v1/realtime/client_secrets";
    const response = await fetch(SESSION_REQUEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to get ephemeral token: ${response.status} ${errorText}`);
      return res.status(response.status).json({ 
        error: "Failed to create session",
        details: errorText 
      });
    }

    const data = await response.json() as { value: string; expires_at: number };
    console.log("✅ Ephemeral session created");

    // Transform to match client's expected format (OpenAI-compatible)
    res.json({
      client_secret: {
        value: data.value,
        expires_at: data.expires_at,
      },
      voice: VOICE,
      instructions: INSTRUCTIONS,
    });
  } catch (error) {
    console.error("❌ Error creating session:", error);
    res.status(500).json({ 
      error: "Failed to create session",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// ========================================
// Start Server
// ========================================

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("🚀 XAI Voice Web Backend (Node.js) Starting");
  console.log("=".repeat(60));
  console.log(`🔑 API Key: ${XAI_API_KEY ? "Configured" : "❌ Missing"}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🎙️  Voice: ${VOICE}`);
  console.log(`📝 Instructions: ${INSTRUCTIONS.substring(0, 50)}...`);
  console.log(`🔒 CORS Origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log("=".repeat(60));
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log("=".repeat(60));

  if (!XAI_API_KEY) {
    console.log("⚠️  WARNING: XAI_API_KEY not configured!");
  }
});
