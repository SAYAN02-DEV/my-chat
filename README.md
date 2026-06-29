# Two-Person Chat App (MERN + Next.js + TypeScript + Socket.IO)

A minimal 1-to-1 chat website for exactly two people. Supports text messages
plus sending photos, videos, and any other file. Built with:

- **Backend:** Node.js, Express, TypeScript, Socket.IO, MongoDB (Mongoose), Multer
- **Frontend:** Next.js (App Router), TypeScript, Socket.IO client, plain CSS

There is no real authentication — since only two of you will ever use it,
you just pick your name ("Alice" or "Bob", or whatever you rename them to)
on the landing page. Anyone with the link can technically pick either name,
so only share the link with the other person.

## Folder structure

```
chat-app/
  backend/     Express + Socket.IO + MongoDB server, handles messages & file uploads
  frontend/    Next.js website (the actual chat UI)
```

## 1. Prerequisites

- Node.js 18+ installed
- MongoDB running somewhere (local install, Docker, or a free MongoDB Atlas cluster)

## 2. Backend setup

```bash
cd backend
cp .env.example .env
# edit .env if needed (MONGO_URI, USER_A, USER_B, etc.)
npm install
npm run dev
```

This starts the API + WebSocket server on `http://localhost:5000`.
Uploaded photos/videos/files are stored in `backend/uploads/` and served at
`http://localhost:5000/uploads/...`.

### Backend env vars (`backend/.env`)

| Variable      | Meaning                                      | Default                                   |
|---------------|-----------------------------------------------|--------------------------------------------|
| PORT          | Port the server listens on                    | 5000                                       |
| MONGO_URI     | MongoDB connection string                     | mongodb://localhost:27017/two-person-chat |
| FRONTEND_URL  | Used for CORS / socket origin                 | http://localhost:3000                      |
| USER_A        | First (and only) allowed username             | Alice                                      |
| USER_B        | Second (and only) allowed username             | Bob                                        |

## 3. Frontend setup

In a separate terminal:

```bash
cd frontend
cp .env.local.example .env.local
# edit .env.local if you changed names/ports in the backend
npm install
npm run dev
```

Visit `http://localhost:3000`. Pick your name, and start chatting. Open it
in a second browser/incognito window and pick the other name to test both
sides talking to each other.

### Frontend env vars (`frontend/.env.local`)

| Variable                | Meaning                              | Default                  |
|--------------------------|---------------------------------------|---------------------------|
| NEXT_PUBLIC_BACKEND_URL  | URL of the backend server             | http://localhost:5000     |
| NEXT_PUBLIC_USER_A       | Must match backend USER_A             | Alice                     |
| NEXT_PUBLIC_USER_B       | Must match backend USER_B             | Bob                       |

## How it works

- On the landing page you pick which of the two people you are. This is
  stored in `localStorage` and sent to the server whenever you connect.
- Text messages and file messages are sent over a WebSocket (`socket.emit("message", ...)`).
  The server saves every message to MongoDB and forwards it to both the sender
  and receiver's "room" (named after their username) so it shows up instantly
  on both screens.
- Photos, videos, and any other file type are first uploaded via a normal
  HTTP POST to `/api/upload` (using Multer), which returns a URL. That URL is
  then sent as a regular socket message (`kind: "image" | "video" | "file"`),
  so it's stored in the same chat history.
- Message history is loaded once on page load via `GET /api/messages`.
- A simple typing indicator and "online/offline" status are included for a bit
  of polish, but everything else is intentionally minimal since this is just
  for two people.

## Going to production (optional)

This is built for local/simple personal use. If you want to put it on the
real internet later:
- Deploy the backend (e.g. Render, Railway, a small VPS) with a real MongoDB
  Atlas database, and use `https`/`wss`.
- Deploy the frontend (e.g. Vercel) and point `NEXT_PUBLIC_BACKEND_URL` at
  your backend's public URL.
- Consider adding a simple shared password/PIN screen before the username
  picker, since right now anyone with the link can pick either name.
- Add a max file size / allowed file types check on the frontend too (the
  backend already limits uploads to 50MB — change in `backend/src/server.ts`
  if you need bigger video files).
