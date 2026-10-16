import type { Metadata } from "next";

export const siteUrl = "https://redifinch.com";

export function pageMetadata(title: string, description: string, path: string): Metadata {
  const url = `${siteUrl}${path}`;
  return {
    title: `${title} | RediFinch`,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | RediFinch`, description, type: "website", url, images: [{ url: "/og-redifinch.png", alt: "Abstract blue sound wave for RediFinch" }] },
    twitter: { card: "summary_large_image", title: `${title} | RediFinch`, description, images: ["/og-redifinch.png"] },
  };
}

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.path}`,
    })),
  };
}
