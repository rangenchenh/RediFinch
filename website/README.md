# RediFinch marketing site

This is a standalone Next.js 16 static site for the RediFinch Windows desktop project in the parent folder.

## Run locally

```powershell
cd website
npm ci
npm run dev
```

Open http://localhost:3010.

## Build and deploy

`npm run build` exports static files to `out/`. This can be deployed to either Vercel or Cloudflare Pages without a server runtime. For Vercel, set root directory to `website`, build command to `npm run build`, and output directory to `out`. For Cloudflare Pages, use the same root, build command, and output directory.

The desktop installer is distributed through [GitHub Releases](https://github.com/rangenchenh/RediFinch/releases). The download page links directly to the [v0.1.10 Windows installer](https://github.com/rangenchenh/RediFinch/releases/download/v0.1.10/RediFinch-0.1.10-x64.exe), while release notes remain available on the [v0.1.10 release page](https://github.com/rangenchenh/RediFinch/releases/tag/v0.1.10). The site does not bundle the binary into the repository or export.

## Design references

- [Wispr Flow](https://wisprflow.ai/): warm off-white surface, confident editorial type, raw-to-polished demonstration.
- [Granola](https://www.granola.ai/): restrained navigation, prominent app window, product-first hierarchy.
- [Monologue](https://www.monologue.to/): clear mode grouping, dark section for agent-oriented workflow.
- [Tailark blocks](https://github.com/tailark/blocks): MIT licensed hero section composition reference. The page uses its content order and two-column app showcase pattern, adapted to this product. See `THIRD_PARTY_NOTICES.md`.

The illustrations and example text are original and illustrative. No competitor assets, testimonials, logos, or performance figures are used.
