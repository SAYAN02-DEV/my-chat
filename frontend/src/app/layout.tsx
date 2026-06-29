import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Two Person Chat",
  description: "A simple private chat for two people",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
