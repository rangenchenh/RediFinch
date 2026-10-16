import { ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { ContentCta, ContentLayout } from "../content-shell";
import { breadcrumbs, JsonLd, pageMetadata } from "../seo";
import { guides } from "./data";

export const metadata = pageMetadata(
  "Guides for voice dictation on Windows",
  "Practical guides to Windows voice dictation, local and cloud speech recognition, and voice translation with RediFinch.",
  "/guides/",
);

export default function GuidesPage() {
  return <ContentLayout>
    <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides/" }])} />
    <section className="content-hero"><div className="content-hero-inner"><p className="content-eyebrow"><BookOpen size={15}/> THE REDIFINCH FIELD GUIDE</p><h1>A little more clarity.<br/><em>A lot less typing.</em></h1><p>Practical notes on voice dictation, choosing a speech engine, and making spoken words useful across your day.</p></div><span className="content-orbit" aria-hidden="true"/></section>
    <section className="guide-index" aria-labelledby="guide-index-title"><div className="guide-index-heading"><p className="section-label">Start here</p><h2 id="guide-index-title">Find your flow.</h2></div><div className="guide-grid">{guides.map((guide, index) => <a className="guide-card" href={`/guides/${guide.slug}/`} key={guide.slug}><span className="guide-card-number">0{index + 1}</span><span className="guide-card-type">{guide.eyebrow}</span><h3>{guide.title}</h3><p>{guide.description}</p><span className="guide-card-foot"><span><Clock3 size={15}/> {guide.readTime}</span><ArrowRight size={20}/></span></a>)}</div></section>
    <section className="compare-strip"><div><p className="section-label">Choosing a tool</p><h2>Looking beyond Flow?</h2><p>See a clear, factual comparison of RediFinch and Wispr Flow for Windows dictation.</p></div><a className="text-link" href="/compare/wispr-flow/">Read the comparison <ArrowRight size={17}/></a></section>
    <ContentCta/>
  </ContentLayout>;
}
