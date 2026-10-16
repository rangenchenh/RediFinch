import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://redifinch.com"),
  title: "RediFinch — Your words, without the typing.",
  description:
    "Voice dictation, polished writing, translation, and a controllable desktop assistant for Windows. Choose the models and providers that work for you.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "RediFinch — Your words, without the typing.",
    description: "Your voice, everywhere you work.",
    type: "website",
    url: "https://redifinch.com",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
