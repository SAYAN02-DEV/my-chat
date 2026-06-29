import { io, Socket } from "socket.io-client";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    console.log("[SOCKET CLIENT] connecting to:", BACKEND_URL);
    socket = io(BACKEND_URL, {
      autoConnect: true,
      // allow polling fallback in case websocket upgrade fails through the proxy
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[SOCKET CLIENT] connected. id:", socket?.id, "transport:", socket?.io.engine.transport.name);
    });

    socket.on("connect_error", (err) => {
      console.error("[SOCKET CLIENT] connect_error:", err.message, err);
    });

    socket.on("disconnect", (reason) => {
      console.warn("[SOCKET CLIENT] disconnected. reason:", reason);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      console.log("[SOCKET CLIENT] reconnect_attempt #", attempt);
    });

    socket.io.engine?.on?.("upgrade", (transport: any) => {
      console.log("[SOCKET CLIENT] transport upgraded to:", transport.name);
    });
  }
  return socket;
}
