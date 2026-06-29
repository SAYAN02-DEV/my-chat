"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { ChatMessage, MessageStatus } from "@/types";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";
const USER_A = process.env.NEXT_PUBLIC_USER_A || "Alice";
const USER_B = process.env.NEXT_PUBLIC_USER_B || "Bob";

function otherUser(me: string): string {
  return me === USER_A ? USER_B : USER_A;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Tick icon shown only on messages sent by ME ──────────────────────────────
// undefined status means a legacy message (pre-feature) — we treat it as seen.
function StatusTick({ status }: { status?: MessageStatus }) {
  const resolved = status ?? "seen";

  if (resolved === "sent") {
    return (
      <span className="status-tick status-sent" title="Sent">
        ✓
      </span>
    );
  }
  if (resolved === "delivered") {
    return (
      <span className="status-tick status-delivered" title="Delivered">
        ✓✓
      </span>
    );
  }
  // seen
  return (
    <span className="status-tick status-seen" title="Seen">
      ✓✓
    </span>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<string>("");
  const [them, setThem] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [online, setOnline] = useState<string[]>([]);
  const [theirTyping, setTheirTyping] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so event handlers always see current values without stale closure
  const meRef = useRef(me);
  const themRef = useRef(them);
  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { themRef.current = them; }, [them]);

  // ── Resolve identity ────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("chat-username");
    if (!stored) {
      router.push("/");
      return;
    }
    setMe(stored);
    setThem(otherUser(stored));
  }, [router]);

  // ── Load history + wire socket listeners ────────────────────────────────
  useEffect(() => {
    if (!me || !them) return;

    const socket = getSocket();

    // Helper: tell server we have read all messages from `them`
    function emitMarkSeen() {
      socket.emit("mark_seen", { viewer: meRef.current, sender: themRef.current });
    }

    // Load message history, then immediately mark everything as seen
    fetch(`${BACKEND_URL}/api/messages?user1=${me}&user2=${them}`)
      .then((res) => res.json())
      .then((data: ChatMessage[]) => {
        setMessages(data);
        emitMarkSeen();
      })
      .catch((err) => console.error("Failed to load history", err));

    socket.emit("join", me);

    // New message arrived
    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        // Deduplicate: if we already have this _id, replace (handles status updates)
        if (msg._id && prev.some((m) => m._id === msg._id)) {
          return prev.map((m) => (m._id === msg._id ? msg : m));
        }
        return [...prev, msg];
      });

      // If the incoming message is from them, we're visibly reading it → mark seen
      if (msg.sender === themRef.current) {
        emitMarkSeen();
      }
    };

    // Server tells us the status of our OWN sent messages changed
    const onStatusUpdate = ({
      messageIds,
      status,
    }: {
      messageIds: string[];
      status: string;
    }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id && messageIds.includes(msg._id)
            ? { ...msg, status: status as MessageStatus }
            : msg
        )
      );
    };

    const onPresence = (users: string[]) => setOnline(users);

    const onTyping = (from: string) => {
      if (from === themRef.current) setTheirTyping(true);
    };
    const onStopTyping = (from: string) => {
      if (from === themRef.current) setTheirTyping(false);
    };

    socket.on("message", onMessage);
    socket.on("message_status_update", onStatusUpdate);
    socket.on("presence", onPresence);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);

    // When the user comes back to this tab, mark everything as seen again
    const onFocus = () => emitMarkSeen();
    window.addEventListener("focus", onFocus);

    return () => {
      socket.off("message", onMessage);
      socket.off("message_status_update", onStatusUpdate);
      socket.off("presence", onPresence);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
      window.removeEventListener("focus", onFocus);
    };
  }, [me, them]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, theirTyping]);

  // ── Typing indicator ────────────────────────────────────────────────────
  function handleTextChange(value: string) {
    setText(value);
    const socket = getSocket();
    socket.emit("typing", { sender: me, receiver: them });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit("stop_typing", { sender: me, receiver: them });
    }, 1200);
  }

  // ── Send text message ───────────────────────────────────────────────────
  function sendText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const socket = getSocket();
    socket.emit("message", {
      sender: me,
      receiver: them,
      kind: "text",
      text: trimmed,
    });
    socket.emit("stop_typing", { sender: me, receiver: them });
    setText("");
  }

  // ── Send file ───────────────────────────────────────────────────────────
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${BACKEND_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      const socket = getSocket();
      socket.emit("message", {
        sender: me,
        receiver: them,
        kind: data.kind,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        mimeType: data.mimeType,
      });
    } catch (err) {
      console.error(err);
      alert("Could not send that file. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function logout() {
    localStorage.removeItem("chat-username");
    router.push("/");
  }

  if (!me || !them) return null;

  const isThemOnline = online.includes(them);

  return (
    <main className="chat-screen">
      <header className="chat-header">
        <div className="who">
          <strong>{them}</strong>
          <span className={`status ${isThemOnline ? "online" : ""}`}>
            {isThemOnline ? "Online" : "Offline"}
          </span>
        </div>
        <button className="logout-btn" onClick={logout}>
          Switch user
        </button>
      </header>

      <div className="messages">
        {messages.map((msg) => {
          const mine = msg.sender === me;
          return (
            <div
              key={msg._id || `${msg.createdAt}-${msg.text}`}
              className={`bubble-row ${mine ? "mine" : "theirs"}`}
            >
              <div className="bubble">
                <MessageContent msg={msg} />
                {/* timestamp + tick live together so they stay on one line */}
                <div className="bubble-meta">
                  <span className="timestamp">{formatTime(msg.createdAt)}</span>
                  {mine && <StatusTick status={msg.status} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {theirTyping && (
        <div className="typing-indicator">{them} is typing…</div>
      )}
      {uploading && <div className="upload-progress">Uploading file…</div>}

      <div className="composer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.zip,.txt"
          style={{ display: "none" }}
          onChange={handleFilePicked}
        />
        <button
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach photo, video, or file"
        >
          📎
        </button>
        <input
          type="text"
          placeholder="Type a message"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendText();
          }}
        />
        <button
          className="send-btn"
          onClick={sendText}
          disabled={!text.trim()}
          title="Send"
        >
          ➤
        </button>
      </div>
    </main>
  );
}

function MessageContent({ msg }: { msg: ChatMessage }) {
  const fileSrc = msg.fileUrl ? `${BACKEND_URL}${msg.fileUrl}` : "";

  switch (msg.kind) {
    case "image":
      return <img src={fileSrc} alt={msg.fileName || "photo"} />;
    case "video":
      return <video src={fileSrc} controls />;
    case "file":
      return (
        <a
          className="file-pill"
          href={fileSrc}
          target="_blank"
          rel="noreferrer"
        >
          <span className="file-icon">📄</span>
          <span>{msg.fileName || "Download file"}</span>
        </a>
      );
    default:
      return <span>{msg.text}</span>;
  }
}