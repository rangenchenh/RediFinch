import { ArrowRight, ArrowUpRight, Github } from "lucide-react";
import type { ReactNode } from "react";

export function ContentHeader() {
  return <header className="site-header content-header">
    <a className="wordmark" href="/" aria-label="RediFinch home">RediFinch<span>.</span></a>
    <nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/#more-than-dictation">What it does</a><a href="/guides/">Guides</a></nav>
    <div className="header-actions"><a className="header-github" href="https://github.com/rangenchenh/RediFinch" aria-label="RediFinch on GitHub" target="_blank" rel="noopener noreferrer"><Github size={22} strokeWidth={1.8}/></a><a className="header-cta" href="/download/">Download <ArrowUpRight size={16}/></a></div>
  </header>;
}

export function ContentFooter() {
  return <footer className="footer content-footer"><a className="wordmark" href="/">RediFinch<span>.</span></a><span>Voice, made useful.</span><a href="/guides/">Guides</a><a href="/compare/wispr-flow/">Compare</a><a href="https://github.com/rangenchenh/RediFinch" target="_blank" rel="noopener noreferrer">GitHub ↗</a><small>© 2026 RediFinch</small></footer>;
}

export function ContentLayout({ children }: { children: ReactNode }) {
  return <div className="site content-site"><ContentHeader/><main>{children}</main><ContentFooter/></div>;
}

export function ContentCta() {
  return <aside className="content-cta"><div><span className="content-eyebrow">READY WHEN YOU ARE</span><h2>Give your hands a break.</h2><p>Try dictation, translation, and the assistant preview in one Windows app.</p></div><a className="button button-primary" href="/download/">Get the Windows preview <ArrowRight size={17}/></a></aside>;
}
