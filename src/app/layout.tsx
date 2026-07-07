import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RNG Dodgers Tile Game",
  description: "Track RNG Dodgers tile game progress with a MongoDB-backed leaderboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
