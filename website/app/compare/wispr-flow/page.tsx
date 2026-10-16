import { ArrowLeft, ArrowRight } from "lucide-react";
import { ContentCta, ContentLayout } from "../../content-shell";
import { breadcrumbs, JsonLd, pageMetadata } from "../../seo";

export const metadata = pageMetadata(
  "RediFinch vs. Wispr Flow for Windows dictation",
  "Compare RediFinch and Wispr Flow on Windows platform support, local speech recognition, provider choice, translation, and product scope.",
  "/compare/wispr-flow/",
);

const rows = [
  { label: "Windows dictation", redi: "Windows 10/11 preview with text insertion in the focused app", flow: "Windows app with dictation across apps" },
  { label: "Local speech recognition", redi: "Built-in SenseVoice option; offline transcription after model download", flow: "Wispr Flow describes its dictation as cloud processed" },
  { label: "Speech provider choice", redi: "Local model or supported cloud providers with your own keys", flow: "Wispr Flow provides its own managed speech experience" },
  { label: "Translation", redi: "Service translation or AI translation, each with configurable providers", flow: "Consult Flow's current feature list for supported translation workflows" },
  { label: "Other product scope", redi: "AI polishing and an early, permissioned voice agent preview", flow: "Cross-platform dictation plus a meeting Notetaker" },
  { label: "Source code", redi: "Open-source desktop app on GitHub (MIT)", flow: "Proprietary app" },
];

export default function ComparePage() {
  return <ContentLayout>
    <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides/" }, { name: "RediFinch vs. Wispr Flow", path: "/compare/wispr-flow/" }])} />
    <article className="article compare-article"><div className="article-head"><a className="article-back" href="/guides/"><ArrowLeft size={16}/> Guides</a><p className="content-eyebrow">A PRACTICAL COMPARISON <span className="eyebrow-divider">·</span> REVIEWED OCTOBER 2026</p><h1>RediFinch or Wispr Flow?</h1><p className="article-deck">Both help you dictate across Windows apps. The right choice depends on whether you want a managed, cross-platform experience or more control over your speech engine and output providers.</p></div><div className="article-rule"/>
      <div className="comparison-intro"><div><span>01 / REDIFINCH</span><h2>Choose your own setup.</h2><p>Start with local speech recognition, or connect cloud speech, writing, and translation providers yourself. RediFinch is an open-source Windows preview.</p></div><div><span>02 / WISPR FLOW</span><h2>One managed experience.</h2><p>Wispr Flow offers dictation on Windows, Mac, iOS, and Android, and also has a meeting Notetaker. Its service manages the speech experience for you.</p></div></div>
      <div className="comparison-table-wrap"><table className="comparison-table"><caption>Feature comparison for Windows users</caption><thead><tr><th scope="col">What matters</th><th scope="col">RediFinch</th><th scope="col">Wispr Flow</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.redi}</td><td>{row.flow}</td></tr>)}</tbody></table></div>
      <div className="comparison-notes"><div><h2>Choose RediFinch if…</h2><p>You want a Windows-first tool, a local speech option, your own provider keys, dedicated translation shortcuts, and an early assistant preview. You are comfortable configuring a preview app.</p></div><div><h2>Choose Wispr Flow if…</h2><p>You want a managed experience across desktop and mobile, or you need its meeting Notetaker. Check its current plans and platform support before deciding.</p></div></div>
      <p className="comparison-source">Comparison based on the <a href="https://github.com/rangenchenh/RediFinch#what-you-can-do" target="_blank" rel="noopener noreferrer">RediFinch project documentation</a>, <a href="https://wisprflow.ai/" target="_blank" rel="noopener noreferrer">Wispr Flow product page</a>, <a href="https://wisprflow.ai/pricing" target="_blank" rel="noopener noreferrer">Wispr Flow feature list</a>, and <a href="https://docs.wisprflow.ai/articles/3467817258-security-and-compliance-faq" target="_blank" rel="noopener noreferrer">Wispr Flow's security overview</a>, reviewed October 2026. Features and plans can change. Wispr Flow is a trademark of its owner; this comparison is independent.</p>
      <a className="article-back comparison-guide-link" href="/guides/offline-vs-cloud-dictation/">Understand local vs. cloud dictation <ArrowRight size={16}/></a>
    </article><ContentCta/>
  </ContentLayout>;
}
