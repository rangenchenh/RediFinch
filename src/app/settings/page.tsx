'use client';

import { Boot } from '@/components/boot';
import { NotInApp } from '@/components/not-in-app';
import { SettingsView } from '@/components/settings-view';
import { useVibetype } from '@/hooks/use-vibetype';

export default function SettingsPage() {
  const state = useVibetype();

  if (!state.ready) return <Boot />;
  if (!state.inApp) return <NotInApp />;
  if (!state.settings) return <Boot />;

  return <SettingsView state={state} />;
}
