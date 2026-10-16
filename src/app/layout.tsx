import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Saykin',
  description: 'Hold a key, speak, and your words are typed into whatever app has focus.',
};

/**
 * Applied before first paint so the window never flashes the wrong theme.
 * `beforeInteractive` inlines this into the exported HTML head, which is what
 * makes that possible — a plain inline `<script>` inside a React tree is not
 * executed on the client and would also be a hydration hazard.
 */
const THEME_BOOTSTRAP = `
(function(){
  try {
    var stored = localStorage.getItem('vibetype-theme') || 'system';
    var dark = stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
