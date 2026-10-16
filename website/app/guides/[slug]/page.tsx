import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { ContentCta, ContentLayout } from "../../content-shell";
import { breadcrumbs, JsonLd, pageMetadata, siteUrl } from "../../seo";
import { guides } from "../data";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() { return guides.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) return {};
  return pageMetadata(guide.title, guide.description, `/guides/${slug}/`);
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) notFound();
  const path = `/guides/${slug}/`;
  const related = guides.filter((item) => item.slug !== slug).slice(0, 2);
  return <ContentLayout>
    <JsonLd data={[
      breadcrumbs([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides/" }, { name: guide.title, path }]),
      { "@context": "https://schema.org", "@type": "Article", headline: guide.title, description: guide.description, mainEntityOfPage: `${siteUrl}${path}`, author: { "@type": "Organization", name: "RediFinch", url: siteUrl }, publisher: { "@type": "Organization", name: "RediFinch", url: siteUrl } },
    ]} />
    <article className="article">
      <div className="article-head"><a className="article-back" href="/guides/"><ArrowLeft size={16}/> All guides</a><p className="content-eyebrow">{guide.eyebrow} <span className="eyebrow-divider">·</span> <Clock3 size={14}/> {guide.readTime}</p><h1>{guide.title}</h1><p className="article-deck">{guide.intro}</p></div>
      <div className="article-rule"/>
      <div className="article-body"><aside className="article-aside"><span>IN THIS GUIDE</span>{guide.sections.map((section, index) => <a href={`#section-${index + 1}`} key={section.heading}>{section.heading}</a>)}</aside><div className="article-prose">{guide.sections.map((section, index) => <section id={`section-${index + 1}`} key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.steps && <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>}</section>)}</div></div>
    </article>
    <section className="related-guides"><p className="section-label">Keep exploring</p><div>{related.map((item) => <a href={`/guides/${item.slug}/`} key={item.slug}><span>{item.eyebrow}</span><h3>{item.title}</h3><ArrowRight size={20}/></a>)}</div></section>
    <ContentCta/>
  </ContentLayout>;
}
