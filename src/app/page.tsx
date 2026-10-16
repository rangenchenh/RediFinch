'use client';

import { Boot } from '@/components/boot';
import { DictationView } from '@/components/dictation-view';
import { NotInApp } from '@/components/not-in-app';
import { useVibetype } from '@/hooks/use-vibetype';

export default function HomePage() {
  const state = useVibetype();

  // `Boot` is what the prerendered HTML contains, so the first client render
  // must match it. Only once the bridge is known do we branch.
  if (!state.ready) return <Boot />;
  if (!state.inApp) return <NotInApp />;

  return <DictationView state={state} />;
}
