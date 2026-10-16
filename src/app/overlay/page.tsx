'use client';

import { Overlay } from '@/components/overlay';

/**
 * The always-on-top pill shown while dictating.
 *
 * Rendered in its own window with `focusable: false`, so it never steals focus
 * from the app being dictated into.
 */
export default function OverlayPage() {
  return <Overlay />;
}
