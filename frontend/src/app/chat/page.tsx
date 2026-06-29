"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { ChatMessage } from "@/types";

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

  // Resolve identity, redirect to login if missing
  useEffect(() => {
    const stored = localStorage.getItem("chat-username");
    if (!stored) {
      router.push("/");
      return;
    }
    setMe(stored);
    setThem(otherUser(stored));
  }, [router]);

  // Load history + wire up socket listeners
  useEffect(() => {
    if (!me || !them) return;

    fetch(`${BACKEND_URL}/api/messages?user1=${me}&user2=${them}`)
      .then((res) => res.json())
      .then((data: ChatMessage[]) => setMessages(data))
      .catch((err) => console.error("Failed to load history", err));

    const socket = getSocket();
    socket.emit("join", me);

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    };
    const onPresence = (users: string[]) => setOnline(users);
    const onTyping = (from: string) => {
      if (from === them) setTheirTyping(true);
    };
    const onStopTyping = (from: string) => {
      if (from === them) setTheirTyping(false);
    };

    socket.on("message", onMessage);
    socket.on("presence", onPresence);
    socket.on("typing", onTyping);
    socket.on("stop_typing", onStopTyping);

    return () => {
      socket.off("message", onMessage);
      socket.off("presence", onPresence);
      socket.off("typing", onTyping);
      socket.off("stop_typing", onStopTyping);
    };
  }, [me, them]);

  // Auto scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, theirTyping]);

  function handleTextChange(value: string) {
    setText(value);
    const socket = getSocket();
    socket.emit("typing", { sender: me, receiver: them });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit("stop_typing", { sender: me, receiver: them });
    }, 1200);
  }

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
                <span className="timestamp">{formatTime(msg.createdAt)}</span>
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
        <a className="file-pill" href={fileSrc} target="_blank" rel="noreferrer">
          <span className="file-icon">📄</span>
          <span>{msg.fileName || "Download file"}</span>
        </a>
      );
    default:
      return <span>{msg.text}</span>;
  }
}
