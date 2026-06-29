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
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);
dotenv.config();

const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/two-person-chat";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const USER_A = process.env.USER_A || "Alice";
const USER_B = process.env.USER_B || "Bob";
const ALLOWED_USERS = [USER_A, USER_B];

console.log("===== STARTUP CONFIG =====");
console.log("PORT:", PORT);
console.log("FRONTEND_URL:", FRONTEND_URL);
console.log("ALLOWED_USERS:", ALLOWED_USERS);
console.log("===========================");

const app = express();
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function kindFromMime(mimeType: string): MessageKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

app.post(
  "/api/upload",
  upload.single("file"),
  (req: Request, res: Response) => {
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
  }
);

app.get("/api/messages", async (req: Request, res: Response) => {
  const { user1, user2 } = req.query as { user1?: string; user2?: string };
  console.log(`[HTTP] GET /api/messages user1=${user1} user2=${user2}`);
  if (!user1 || !user2) {
    return res.status(400).json({ error: "user1 and user2 are required" });
  }
  const messages = await Message.find({
    $or: [
      { sender: user1, receiver: user2 },
      { sender: user2, receiver: user1 },
    ],
  }).sort({ createdAt: 1 });
  console.log(`[HTTP] returning ${messages.length} messages`);
  res.json(messages);
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, allowedUsers: ALLOWED_USERS });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

// username -> socketId
const onlineUsers = new Map<string, string>();

io.engine.on("connection_error", (err) => {
  console.error(
    "[ENGINE] connection_error:",
    err.req?.url,
    err.code,
    err.message,
    err.context
  );
});

io.on("connection", (socket: Socket) => {
  console.log(
    `[SOCKET] new connection: ${socket.id} from ${socket.handshake.address} via ${socket.conn.transport.name}`
  );

  socket.conn.on("upgrade", (transport) => {
    console.log(
      `[SOCKET] ${socket.id} upgraded to transport: ${transport.name}`
    );
  });

  // ── JOIN ──────────────────────────────────────────────────────────────────
  socket.on("join", async (username: string) => {
    console.log(`[SOCKET] join event: ${username} (socket ${socket.id})`);
    if (!ALLOWED_USERS.includes(username)) {
      console.warn(`[SOCKET] rejected unknown user: ${username}`);
      socket.emit("error_message", "Unknown user");
      return;
    }

    onlineUsers.set(username, socket.id);
    socket.data.username = username;
    socket.join(username);
    console.log(
      `[SOCKET] ${username} joined room. Online users:`,
      Array.from(onlineUsers.keys())
    );

    io.emit("presence", Array.from(onlineUsers.keys()));

    // Mark all "sent" messages addressed to this user as "delivered"
    // and notify the original senders.
    try {
      const pending = await Message.find({
        receiver: username,
        status: "sent",
      }).select("_id sender");

      if (pending.length > 0) {
        const pendingIds = pending.map((m) => String(m._id));

        await Message.updateMany(
          { _id: { $in: pendingIds } },
          { $set: { status: "delivered" } }
        );

        // Group IDs by sender so we emit once per sender
        const bySender = new Map<string, string[]>();
        pending.forEach((msg) => {
          const ids = bySender.get(msg.sender) || [];
          ids.push(String(msg._id));
          bySender.set(msg.sender, ids);
        });

        for (const [sender, ids] of bySender.entries()) {
          io.to(sender).emit("message_status_update", {
            messageIds: ids,
            status: "delivered",
          });
        }

        console.log(
          `[SOCKET] marked ${pendingIds.length} messages as delivered for ${username}`
        );
      }
    } catch (err) {
      console.error("[SOCKET] Failed to mark pending messages as delivered", err);
    }
  });

  // ── TYPING ────────────────────────────────────────────────────────────────
  socket.on("typing", (payload: { sender: string; receiver: string }) => {
    io.to(payload.receiver).emit("typing", payload.sender);
  });

  socket.on(
    "stop_typing",
    (payload: { sender: string; receiver: string }) => {
      io.to(payload.receiver).emit("stop_typing", payload.sender);
    }
  );

  // ── SEND MESSAGE ──────────────────────────────────────────────────────────
  socket.on("message", async (data: ChatMessageInput) => {
    console.log("[SOCKET] message event received:", JSON.stringify(data));
    try {
      if (
        !ALLOWED_USERS.includes(data.sender) ||
        !ALLOWED_USERS.includes(data.receiver)
      ) {
        console.warn(
          "[SOCKET] rejected message - unknown sender/receiver",
          data.sender,
          data.receiver
        );
        socket.emit("error_message", "Unknown sender/receiver");
        return;
      }

      // If receiver is currently online the message is delivered the moment
      // it hits their socket, so we can skip straight to "delivered".
      const receiverOnline = onlineUsers.has(data.receiver);
      const initialStatus = receiverOnline ? "delivered" : "sent";

      const saved = await Message.create({
        sender: data.sender,
        receiver: data.receiver,
        kind: data.kind,
        text: data.text,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        mimeType: data.mimeType,
        status: initialStatus,
      });

      console.log(
        `[SOCKET] message saved id=${saved._id} status=${initialStatus}, emitting to: ${data.receiver}, ${data.sender}`
      );

      io.to(data.receiver).emit("message", saved);
      io.to(data.sender).emit("message", saved);
    } catch (err) {
      console.error("[SOCKET] Failed to save message", err);
      socket.emit("error_message", "Failed to send message");
    }
  });

  // ── MARK SEEN ─────────────────────────────────────────────────────────────
  // Emitted by the receiver (viewer) when they are actively viewing the chat.
  // Payload: { viewer: string (me), sender: string (them) }
  socket.on(
    "mark_seen",
    async ({ viewer, sender }: { viewer: string; sender: string }) => {
      // Basic guards
      if (
        !ALLOWED_USERS.includes(viewer) ||
        !ALLOWED_USERS.includes(sender) ||
        socket.data.username !== viewer
      ) {
        return;
      }

      try {
        // Find all unseen messages from `sender` to `viewer`
        const msgs = await Message.find({
          sender,
          receiver: viewer,
          status: { $in: ["sent", "delivered"] },
        }).select("_id");

        const messageIds = msgs.map((m) => String(m._id));

        if (messageIds.length === 0) return;

        await Message.updateMany(
          { _id: { $in: messageIds } },
          { $set: { status: "seen" } }
        );

        // Tell the original sender that their messages have been seen
        io.to(sender).emit("message_status_update", {
          messageIds,
          status: "seen",
        });

        console.log(
          `[SOCKET] ${viewer} saw ${messageIds.length} messages from ${sender}`
        );
      } catch (err) {
        console.error("[SOCKET] mark_seen error", err);
      }
    }
  );

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET] disconnect: ${socket.id} reason=${reason}`);
    const username = socket.data.username as string | undefined;
    if (username && onlineUsers.get(username) === socket.id) {
      onlineUsers.delete(username);
      io.emit("presence", Array.from(onlineUsers.keys()));
      console.log(`[SOCKET] ${username} removed from online users`);
    }
  });

  socket.on("error", (err) => {
    console.error(`[SOCKET] socket error on ${socket.id}:`, err);
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
