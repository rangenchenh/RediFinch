'use client';

import { useEffect, useRef, useState } from 'react';
import type { AudioLevel, DictationState } from '@shared/types';
import { subscribe } from '@/lib/bridge';

/**
 * The floating recording indicator.
 *
 * Deliberately nothing but a waveform: no card, no border, no text, no icon.
 * The window is transparent and click-through, so anything drawn here sits on
 * top of the user's real work — a panel would obscure it, whereas a few bars
 * read as a status light.
 *
 * Bars are driven imperatively through refs in a rAF loop rather than by React
 * state. At 60 fps, re-rendering the component on every audio level event would
 * put the UI thread in the hot path of the microphone; writing `transform`
 * directly does not.
 */

/** Odd count so there is a true centre bar to weight the shape around. */
const BAR_COUNT = 9;
/** Per-bar multipliers, highest in the middle: gives the classic tapered look. */
const BAR_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const distance = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
  return 1 - distance * 0.62;
});

export function Overlay() {
  const [state, setState] = useState<DictationState>('idle');
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  /** Latest level from main, read by the animation loop. */
  const targetLevel = useRef(0);
  /** Per-bar rendered heights, so each bar can lag the others slightly. */
  const current = useRef<number[]>(new Array(BAR_COUNT).fill(0));

  // The shared layout paints an opaque `--background` on <body>, which is right
  // for the app windows and wrong for this one: it is what drew the white panel
  // behind the waveform. Override it for the lifetime of this route.
  useEffect(() => {
    const { style } = document.body;
    const previous = style.background;
    style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    return () => {
      style.background = previous;
      document.documentElement.style.background = '';
    };
  }, []);

  useEffect(() => {
    const offs = [
      subscribe('dictation:state', setState),
      subscribe('dictation:level', (level: AudioLevel) => {
        // Bias upward a little: the meter should react to normal speech
        // without needing the user to lean into the microphone.
        targetLevel.current = Math.min(1, Math.pow(level.level, 0.75) * 1.35);
      }),
      subscribe('runtime:status', (status) => setState(status.state)),
    ];

    // The overlay is created lazily, so a session may already be in flight by the
    // time it mounts. Seed from current status instead of waiting for an event.
    void import('@/lib/bridge').then(({ invoke }) =>
      invoke('runtime:status')
        .then((s) => setState(s.state))
        .catch(() => undefined),
    );

    return () => {
      for (const off of offs) off();
    };
  }, []);

  const listening = state === 'listening';
  const processing = state === 'processing';
  const visible = listening || processing;

  // Animate toward the target level every frame.
  useEffect(() => {
    let frame = 0;

    const tick = () => {
      const target = visible ? targetLevel.current : 0;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Each bar eases at a slightly different rate, which is what stops the
        // group from moving as one rigid block.
        const rate = 0.34 + (i % 3) * 0.09;
        // Deterministic per-bar jitter so the resting shape is uneven rather
        // than a flat row of identical bars.
        const jitter = 0.72 + ((i * 37) % 11) / 26;

        const goal = target * BAR_WEIGHTS[i] * jitter;
        // Rise faster than it falls: reads as responsive rather than sluggish.
        const easing = goal > current.current[i] ? rate + 0.22 : rate * 0.62;
        current.current[i] += (goal - current.current[i]) * easing;

        const el = barsRef.current[i];
        if (el) {
          const height = 7 + current.current[i] * 18;
          el.style.transform = `scaleY(${height / 25})`;
          // High floor on purpose: `opacity` fades the halo along with the bar,
          // so a low idle value would make white-on-white disappear entirely.
          el.style.opacity = String(0.82 + current.current[i] * 0.18);
        }
      }

      // Idle-out: once settled and not recording, stop burning frames.
      if (!visible && current.current.every((v) => v < 0.004)) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [visible]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent">
      <div
        className="drag-region flex h-full w-full items-center justify-center gap-[3px] transition-opacity duration-150"
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
            className="h-[25px] w-[3px] origin-center rounded-full bg-white"
            style={{
              // Main only shows this window for an active session. Keep a
              // visible resting waveform even if an IPC status event is missed.
              transform: 'scaleY(0.28)',
              // No backing panel, so the bars have to stay legible over whatever
              // is behind them. White is the worst case against a white document,
              // so the dark halo is doing the real work here: the tight shadows
              // give the bar a defined edge, the wide one lifts it off the page.
              boxShadow:
                '0 0 2px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.5)',
              willChange: 'transform, opacity',
            }}
          />
        ))}
      </div>
    </div>
  );
}
