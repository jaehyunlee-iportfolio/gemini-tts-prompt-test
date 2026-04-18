import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gemini TTS Prompt Tester",
  description: "LAURA TTS stage prompt and voice tester",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-dvh min-h-screen">{children}</body>
    </html>
  );
}
