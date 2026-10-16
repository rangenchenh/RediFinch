/**
 * Neutral first-paint state.
 *
 * The renderer is prerendered at build time, where there is no `window` and
 * therefore no preload bridge. Anything that branches on the bridge during
 * render would produce different markup on the server and the client and trip
 * React's hydration check — so every page shows this until the bridge is known,
 * which is also what the prerendered HTML contains.
 */
export function Boot() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="border-muted-foreground/30 border-t-muted-foreground size-5 animate-spin rounded-full border-2" />
    </div>
  );
}
