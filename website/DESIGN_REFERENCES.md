# Saykin landing page — visual direction

The current design follows **Aqua's restrained visual system**. The [Aqua hero captured on Mobbin](https://mobbin.com/sites/sections/2f15b024-cf4d-435d-a596-c612c3bb1e82) is the primary reference: nearly white full-width canvas, one large sans-serif sentence, generous negative space, sparse navigation, and a compact blue action. We inspected the section image and the [current live Aqua page](https://aquavoice.com/) visually at desktop width. The live page uses one sans-serif family throughout; its computed body and heading styles use PP Neue Montreal with system sans fallbacks and normal font weight. The 2504 px viewport confirmed its canvas fills the browser while content uses intentional insets.

Two secondary references inform individual sections:

- [Aqua's text comparison](https://mobbin.com/sites/sections/d37b62ca-8a17-4499-97e0-862bd7a53b68) shows the benefit through words, rather than a product settings screenshot. Saykin uses one spoken-to-written example on a quiet white surface.
- [Aqua's editorial feature grid](https://mobbin.com/sites/sections/81997816-d34c-41ef-9747-35119f13d2d9) uses spacious explanations. Saykin uses four ruled feature rows instead of tabs or cards.

We also inspected [Wispr Flow's hero](https://mobbin.com/sites/sections/e0030809-614c-4bcb-9c53-746c90165df9) as a contrast: its concise CTA supports the direction, but its serif type, circular copy, and diagonal ribbons are excluded so the page has one coherent style.

The D: offline component library was searched for landing heroes. The inspected MIT-licensed examples from Badtz UI and Fancy use framework-specific dependencies and/or animated display treatments that conflict with the Aqua-style direction. The page therefore uses plain React and CSS with no copied competitor assets or component code.

Design constraints: one sans-serif family; English copy only; no app screenshot, invented metrics, testimonials, or unshipped assistant claims; full-width section backgrounds at desktop and mobile sizes. The abstract blue orbs are decorative.

## Motion reference and implementation

The two blue orbs were revised after inspecting the live [Paper Shaders Mesh Gradient](https://shaders.paper.design/mesh-gradient), [Liquid Metal](https://shaders.paper.design/liquid-metal), and [Metaballs](https://shaders.paper.design/metaballs) previews. Mesh Gradient's flowing color field fit this page's soft blue visual language. Liquid Metal felt too rigid and Metaballs broke the single-orb silhouette. The orbs now use a slowly animated Mesh Gradient inside a gently morphing CSS surface, with a subtle highlight and halo. The same component is shared between hero and final CTA.

The pinned `@paper-design/shaders-react@0.0.81` dependency is [Apache-2.0 licensed](https://github.com/paper-design/shaders/blob/main/LICENSE). Shader canvases mount only while visible, stop when the tab is hidden, and are omitted for reduced-motion users. A CSS gradient remains visible as the fallback.
