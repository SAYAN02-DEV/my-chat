"use client";

import { useRouter } from "next/navigation";

const USER_A = process.env.NEXT_PUBLIC_USER_A || "Alice";
const USER_B = process.env.NEXT_PUBLIC_USER_B || "Bob";

export default function HomePage() {
  const router = useRouter();

  function chooseUser(username: string) {
    localStorage.setItem("chat-username", username);
    router.push("/chat");
  }

  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Who's chatting?</h1>
        <p>This chat is private to just the two of you. Pick your name.</p>
        <div className="login-options">
          <button className="login-btn" onClick={() => chooseUser(USER_A)}>
            {USER_A}
          </button>
          <button className="login-btn" onClick={() => chooseUser(USER_B)}>
            {USER_B}
          </button>
        </div>
      </div>
    </main>
  );
}
