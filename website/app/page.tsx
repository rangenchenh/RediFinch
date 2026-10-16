import { ArrowRight, ArrowUpRight, Download, Github } from "lucide-react";
import LiquidOrb from "./liquid-orb";
import { JsonLd } from "./seo";

const questions = [
  { title: "Does it work in my apps?", answer: "RediFinch places dictated text in the field where your cursor is. Use it in messages, documents, browsers, and other Windows apps." },
  { title: "Can I choose my own providers?", answer: "Yes. Choose supported speech, writing, and translation providers in settings, then connect with your own API keys. Custom compatible endpoints are available too." },
  { title: "What can the assistant do?", answer: "The assistant is an early preview. It has a separate model and a set of tools you control. Browser and computer actions require the permissions you configure." },
];

function Wordmark() {
  return <a className="wordmark" href="#top" aria-label="RediFinch home">RediFinch<span>.</span></a>;
}

function VoiceMark() {
  return <span className="voice-mark" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>;
}

export default function Home() {
  return <main id="top" className="site">
    <JsonLd data={{ "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": "https://redifinch.com/#app", name: "RediFinch", url: "https://redifinch.com/", description: "Open-source voice dictation for Windows with optional AI polishing, translation, and an early voice agent preview.", applicationCategory: "UtilitiesApplication", operatingSystem: "Windows 10, Windows 11", downloadUrl: "https://redifinch.com/download/", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@id": "https://redifinch.com/#organization" } }} />
    <header className="site-header">
      <Wordmark />
      <nav aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#more-than-dictation">What it does</a>
        <a href="/guides/">Guides</a>
      </nav>
      <div className="header-actions">
        <a className="header-github" href="https://github.com/rangenchenh/RediFinch" aria-label="RediFinch on GitHub" title="View RediFinch on GitHub" target="_blank" rel="noopener noreferrer">
          <Github size={22} strokeWidth={1.8}/>
        </a>
        <a className="header-cta" href="/download/"><span className="header-cta-desktop">Get RediFinch</span><span className="header-cta-mobile">Download</span> <ArrowUpRight size={16}/></a>
      </div>
    </header>

    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-glow" aria-hidden="true"/>
      <div className="hero-copy">
        <p className="availability"><span className="availability-dot"/> Available for Windows</p>
        <h1 id="hero-title">Your words,<br/><span>without the typing.</span></h1>
        <p className="hero-lead">Speak naturally. RediFinch turns your thoughts into clear text, right where you need it.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="/download/"><Download size={18}/> Get the Windows preview</a>
          <a className="text-link" href="#how-it-works">See how it works <ArrowRight size={17}/></a>
        </div>
      </div>
      <div className="hero-composition" aria-hidden="true">
        <LiquidOrb variant="hero"/>
        <div className="floating-voice"><VoiceMark/><span>Listening</span><span className="live-dot"/></div>
      </div>
      <div className="hero-bottom"><span>Less time at the keyboard.</span><span>More room for the thought.</span></div>
    </section>

    <section className="intro" id="how-it-works">
      <div className="section-heading">
        <p className="section-label">How it works</p>
        <h2>Just speak.<br/>Keep going.</h2>
      </div>
      <div className="intro-main">
        <p>Hold your shortcut, say what you mean, and release. Your words appear in the app you&apos;re already using.</p>
        <div className="writing-surface" aria-label="Example of spoken words becoming clear text">
          <div className="writing-topline"><span>In a message</span><span className="writing-status"><span/> Ready to send</span></div>
          <p className="writing-text">Hey Alex, I looked through the plan. Monday works for me. Let&apos;s talk through the last details tomorrow.</p>
          <div className="writing-source"><VoiceMark/><span>“Hey Alex, um, I looked through the plan. Monday works...”</span></div>
        </div>
        <p className="intro-note">A natural thought becomes a useful message. No copy and paste, no new workflow to learn.</p>
      </div>
    </section>

    <section className="statement" id="more-than-dictation">
      <div className="statement-inner">
        <p className="section-label">One voice. More possibilities.</p>
        <h2>Say what you want<br/>to get done.</h2>
        <p>Dictate a message. Refine a rough draft. Translate a thought. Or ask the early assistant to help with a task on your computer.</p>
      </div>
      <div className="statement-rings" aria-hidden="true"><i/><i/><i/></div>
    </section>

    <section className="features" aria-label="RediFinch capabilities">
      <div className="feature-row"><span className="feature-index">01</span><div><h3>Write at the speed of thought.</h3><p>Turn natural speech into clean text in the app you already have open.</p></div><span className="feature-symbol">↗</span></div>
      <div className="feature-row"><span className="feature-index">02</span><div><h3>Make the words feel right.</h3><p>Polish a quick thought into a clear message, with a writing model you choose.</p></div><span className="feature-symbol">↗</span></div>
      <div className="feature-row"><span className="feature-index">03</span><div><h3>Speak across languages.</h3><p>Switch into translation with a shortcut. Choose a translation service or an AI model.</p></div><span className="feature-symbol">↗</span></div>
      <div className="feature-row"><span className="feature-index">04</span><div><h3>Ask for a hand.</h3><p>Use the assistant preview to open a page or take a computer action with tools you allow.</p></div><span className="feature-symbol">↗</span></div>
    </section>

    <section className="choice">
      <div><p className="section-label">Made to fit your setup</p><h2>Your voice.<br/>Your choice.</h2></div>
      <div className="choice-copy"><p>Choose the speech and AI providers that fit you. Set your own shortcuts for dictation, translation, and assistant mode. Keep control over which computer tools the assistant can use.</p><a className="text-link" href="/download/">Explore the Windows preview <ArrowRight size={17}/></a></div>
    </section>

    <section className="home-guides" aria-labelledby="home-guides-title"><div className="home-guides-heading"><div><p className="section-label">From the field guide</p><h2 id="home-guides-title">Make more of your voice.</h2></div><a className="text-link" href="/guides/">Explore all guides <ArrowRight size={17}/></a></div><div className="home-guide-links"><a href="/guides/voice-dictation-windows/"><span>01 / GETTING STARTED</span><strong>Dictate in any Windows app</strong><ArrowUpRight size={20}/></a><a href="/guides/offline-vs-cloud-dictation/"><span>02 / CHOOSING A SETUP</span><strong>Local or cloud speech?</strong><ArrowUpRight size={20}/></a><a href="/guides/voice-translation-windows/"><span>03 / VOICE TRANSLATION</span><strong>Translate with a shortcut</strong><ArrowUpRight size={20}/></a></div></section>

    <section className="questions" id="questions">
      <div><p className="section-label">Good to know</p><h2>Questions,<br/>answered.</h2></div>
      <div className="question-list">{questions.map(({title,answer}) => <details key={title}><summary>{title}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
    </section>

    <section className="final-cta"><LiquidOrb variant="footer"/><div className="final-content"><h2>Give your hands<br/>a break.</h2><p>Your next thought is ready when you are.</p><a className="button button-primary" href="/download/"><Download size={18}/> Get RediFinch for Windows</a></div></section>
    <footer className="footer"><Wordmark/><span>Voice, made useful.</span><a href="/guides/">Guides</a><a href="/compare/wispr-flow/">Compare</a><a href="#top">Back to top ↑</a><small>© 2026 RediFinch</small></footer>
  </main>;
}
