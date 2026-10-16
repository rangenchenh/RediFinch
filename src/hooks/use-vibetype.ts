'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioLevel,
  DictationOutput,
  RuntimeStatus,
  Settings,
  TranscriptSegment,
} from '@shared/types';
import { invoke, hasBridge, loadSettings, patchSettings, subscribe } from '@/lib/bridge';

/**
 * Single subscription hub for app state. Every window (main and overlay) uses
 * this, so neither has to reach into the other and both stay in sync.
 */

export interface VibetypeState {
  ready: boolean;
  inApp: boolean;
  settings: Settings | null;
  status: RuntimeStatus | null;
  segments: TranscriptSegment[];
  output: DictationOutput | null;
  level: AudioLevel;
  /** Download progress per model kind; `null` when idle. */
  modelProgress: Record<string, number | null>;
  error: string | null;
  version: { app: string; electron: string; node: string; chrome: string } | null;
}

export function useVibetype() {
  const [ready, setReady] = useState(false);
  const [inApp, setInApp] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [output, setOutput] = useState<DictationOutput | null>(null);
  const [transcriptRestored, setTranscriptRestored] = useState(false);
  const [level, setLevel] = useState<AudioLevel>({ level: 0, speaking: false });
  const [modelProgress, setModelProgress] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<VibetypeState['version']>(null);

  // Keep the current dictation available while moving between Home and Settings.
  // This is session-scoped and is cleared when a new dictation starts.
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('vibetype-current-transcript');
      if (cached) {
        const parsed = JSON.parse(cached) as { segments?: TranscriptSegment[]; output?: DictationOutput | null };
        if (Array.isArray(parsed.segments)) setSegments(parsed.segments);
        if (parsed.output) setOutput(parsed.output);
      }
    } catch { /* damaged cache is ignored */ }
    setTranscriptRestored(true);
  }, []);

  useEffect(() => {
    if (!transcriptRestored) return;
    try {
      sessionStorage.setItem('vibetype-current-transcript', JSON.stringify({ segments, output }));
    } catch { /* storage may be disabled */ }
  }, [segments, output, transcriptRestored]);

  useEffect(() => {
    // Resolved in an effect, never during render: the prerendered HTML has no
    // bridge, so claiming otherwise on the first client render would be a
    // hydration mismatch.
    const bridgePresent = hasBridge();
    setInApp(bridgePresent);

    if (!bridgePresent) {
      setReady(true);
      return;
    }

    let cancelled = false;

    // Initial fetch, then live updates from the main process.
    void (async () => {
      const [s, st, v] = await Promise.all([
        loadSettings(),
        invoke('runtime:status').catch(() => null),
        invoke('app:version').catch(() => null),
      ]);
      if (cancelled) return;
      setSettings(s);
      setStatus(st);
      setVersion(v);
      setReady(true);
    })();

    const unsubscribers = [
      subscribe('runtime:status', setStatus),
      subscribe('settings:changed', setSettings),
      subscribe('dictation:level', setLevel),
      subscribe('dictation:segment', (segment) => {
        setSegments((prev) => {
          // A revised hypothesis replaces the previous non-final segment rather
          // than appending, so the transcript never shows the same sentence twice.
          const lastFinalIndex = findLastFinal(prev);
          const tail = prev.slice(lastFinalIndex + 1);
          if (tail.length === 0) return [...prev, segment];
          if (segment.final) return [...prev.slice(0, lastFinalIndex + 1), segment];
          return [...prev.slice(0, lastFinalIndex + 1), segment];
        });
      }),
      subscribe('dictation:output', setOutput),
      subscribe('app:error', (payload) => setError(payload.message)),
      subscribe('models:progress', (model) => {
        setModelProgress((prev) => ({ ...prev, [model.kind]: model.progress }));
        // A finished download changes what `auto` would pick.
        if (model.installed) void refreshStatus().catch(() => null);
      }),
    ];

    return () => {
      cancelled = true;
      for (const off of unsubscribers) off();
    };
  }, [inApp]);

  // Clear the transcript when a session ends, so each press starts clean.
  const dictationState = status?.state ?? 'idle';
  const prevState = useRef(dictationState);
  useEffect(() => {
    if (prevState.current !== 'idle' && dictationState === 'idle') {
      // Keep the text on screen briefly after finishing so the user can read
      // what was inserted; the next session clears it.
    }
    if (prevState.current === 'idle' && dictationState === 'listening') {
      setSegments([]);
      setOutput(null);
      setError(null);
    }
    prevState.current = dictationState;
  }, [dictationState]);

  const update = useCallback(async (patch: unknown) => {
    const next = await patchSettings(patch);
    if (next) setSettings(next);
    return next;
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!inApp) return;
    setStatus(await invoke('runtime:status').catch(() => null));
  }, [inApp]);

  const fullText = segments
    .map((s) => s.text)
    .slice(-1)[0] ?? '';

  return {
    ready,
    inApp,
    settings,
    status,
    segments,
    output,
    level,
    modelProgress,
    error,
    version,
    dictationState,
    fullText,
    update,
    clearError: () => setError(null),
    refreshStatus,
  };
}

function findLastFinal(segments: TranscriptSegment[]): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].final) return i;
  }
  return -1;
}

/** Convenience wrapper for the copy-to-clipboard affordance. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
