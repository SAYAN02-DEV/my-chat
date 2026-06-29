import path from "path";
import fs from "fs";
import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import mongoose from "mongoose";
import { Server, Socket } from "socket.io";
import dotenv from "dotenv";

import { Message } from "./models/Message";
import { ChatMessageInput, MessageKind } from "./types";

dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/two-person-chat";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// The only two people allowed to use this chat
const USER_A = process.env.USER_A || "Alice";
const USER_B = process.env.USER_B || "Bob";
const ALLOWED_USERS = [USER_A, USER_B];

const app = express();
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// Make sure uploads folder exists and serve it statically
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOAD_DIR));

// ---------- File upload (photos / videos / any file) ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

// 50MB limit per file, adjust if you need bigger videos
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function kindFromMime(mimeType: string): MessageKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

app.post("/api/upload", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const kind = kindFromMime(req.file.mimetype);
  res.json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    kind,
  });
});

// ---------- Message history ----------
app.get("/api/messages", async (req: Request, res: Response) => {
  const { user1, user2 } = req.query as { user1?: string; user2?: string };
  if (!user1 || !user2) {
    return res.status(400).json({ error: "user1 and user2 are required" });
  }
  const messages = await Message.find({
    $or: [
      { sender: user1, receiver: user2 },
      { sender: user2, receiver: user1 },
    ],
  }).sort({ createdAt: 1 });
  res.json(messages);
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, allowedUsers: ALLOWED_USERS });
});

// ---------- Server + Socket.IO ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
});

// Track which socket belongs to which user (only 2 users, so this stays tiny)
const onlineUsers = new Map<string, string>(); // username -> socketId

io.on("connection", (socket: Socket) => {
  socket.on("join", (username: string) => {
    if (!ALLOWED_USERS.includes(username)) {
      socket.emit("error_message", "Unknown user");
      return;
    }
    onlineUsers.set(username, socket.id);
    socket.data.username = username;
    socket.join(username);

    // Let everyone know who's online
    io.emit("presence", Array.from(onlineUsers.keys()));
  });

  socket.on("typing", (payload: { sender: string; receiver: string }) => {
    io.to(payload.receiver).emit("typing", payload.sender);
  });

  socket.on("stop_typing", (payload: { sender: string; receiver: string }) => {
    io.to(payload.receiver).emit("stop_typing", payload.sender);
  });

  socket.on("message", async (data: ChatMessageInput) => {
    try {
      if (
        !ALLOWED_USERS.includes(data.sender) ||
        !ALLOWED_USERS.includes(data.receiver)
      ) {
        socket.emit("error_message", "Unknown sender/receiver");
        return;
      }

      const saved = await Message.create({
        sender: data.sender,
        receiver: data.receiver,
        kind: data.kind,
        text: data.text,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        mimeType: data.mimeType,
      });

      // Send to receiver's room and back to sender (so sender sees the saved/confirmed message)
      io.to(data.receiver).emit("message", saved);
      io.to(data.sender).emit("message", saved);
    } catch (err) {
      console.error("Failed to save message", err);
      socket.emit("error_message", "Failed to send message");
    }
  });

  socket.on("disconnect", () => {
    const username = socket.data.username as string | undefined;
    if (username && onlineUsers.get(username) === socket.id) {
      onlineUsers.delete(username);
      io.emit("presence", Array.from(onlineUsers.keys()));
    }
  });
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
