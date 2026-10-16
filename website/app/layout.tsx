import type { Metadata } from "next";
import { JsonLd } from "./seo";
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
    images: [{ url: "/og-redifinch.png", alt: "Abstract blue sound wave for RediFinch" }],
  },
  twitter: { card: "summary_large_image", title: "RediFinch — Your words, without the typing.", description: "Your voice, everywhere you work.", images: ["/og-redifinch.png"] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><JsonLd data={{ "@context": "https://schema.org", "@graph": [
        { "@type": "Organization", "@id": "https://redifinch.com/#organization", name: "RediFinch", url: "https://redifinch.com/", logo: "https://redifinch.com/icon.svg", sameAs: ["https://github.com/rangenchenh/RediFinch"] },
        { "@type": "WebSite", "@id": "https://redifinch.com/#website", name: "RediFinch", url: "https://redifinch.com/", publisher: { "@id": "https://redifinch.com/#organization" } },
      ] }} />{children}</body>
    </html>
  );
}
