import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ready Finch — Your words, without the typing.",
  description:
    "Voice dictation, polished writing, translation, and a controllable desktop assistant for Windows. Choose the models and providers that work for you.",
  openGraph: {
    title: "Ready Finch — Your words, without the typing.",
    description: "Your voice, everywhere you work.",
    type: "website",
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
