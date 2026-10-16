'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  Cpu,
  Download,
  Languages,
  Loader2,
  Mic,
  Minus,
  Settings2,
  Square,
  WandSparkles,
  X,
} from 'lucide-react';
import type { RuntimeStatus, Settings, TranscriptSegment } from '@shared/types';
import { OUTPUT_MODES, TARGET_LANGUAGES } from '@shared/types';
import { AppSidebar } from '@/components/app-sidebar';
import { BrandMark } from '@/components/brand-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invoke, sendAudio } from '@/lib/bridge';
import { MicCapture } from '@/lib/mic';
import { cn, countChars, formatBytes } from '@/lib/utils';
import { copyText } from '@/hooks/use-vibetype';

interface Props {
  state: ReturnType<typeof import('@/hooks/use-vibetype').useVibetype>;
}

/**
 * The main window: live transcript, level meter, engine status.
 *
 * This is also the component that owns the microphone. Audio capture has to
 * happen in the renderer (Electron gives no mic access to the main process), so
 * this view streams PCM down to main and renders whatever comes back.
 */
export function DictationView({ state }: Props) {
  const {
    settings,
    status,
    segments,
    output,
    level,
    error,
    version,
    dictationState,
    update,
    clearError,
    refreshStatus,
  } = state;

  const capture = useRef<MicCapture | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewedText, setReviewedText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const listening = dictationState === 'listening';
  const processing = dictationState === 'processing';

  const deviceId = settings?.audio.deviceId ?? null;

  // Build the capture pipeline once and keep it. Acquiring the audio device is
  // the slow part of starting a recording, so paying it here — at mount and on
  // device change — is what makes the hotkey feel instant instead of laggy.
  useEffect(() => {
    const mic = new MicCapture({
      onSamples: sendAudio,
      onError: setMicError,
    });
    capture.current = mic;

    void mic
      .prepare(deviceId)
      .then(() => setMicError(null))
      .catch((err: Error) => setMicError(err.message));

    return () => {
      void mic.dispose();
      capture.current = null;
    };
  }, [deviceId]);

  // Toggle recording in lockstep with the session state driven by main. Both
  // branches are flag flips on an already-allocated device.
  useEffect(() => {
    const mic = capture.current;
    if (!mic) return;

    if (listening && !mic.isRunning) {
      void mic
        .start(deviceId)
        .then(() => setMicError(null))
        .catch((err: Error) => {
          setMicError(err.message);
          // The session is already open in main; close it so state stays honest.
          void invoke('dictation:cancel');
        });
    } else if (!listening && mic.isRunning) {
      // Stop, not dispose: the device stays allocated for the next press.
      void mic.stop();
    }
  }, [listening, deviceId]);

  // Keep the transcript pinned to the newest text.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [segments]);

  const toggleSession = useCallback(async () => {
    clearError();
    if (listening) await invoke('dictation:stop');
    else await invoke('dictation:start');
  }, [listening, clearError]);

  const cancel = useCallback(async () => {
    await invoke('dictation:cancel');
  }, []);

  const rawTranscript = segments.length ? segments[segments.length - 1].text : '';
  const transcript = reviewedText ?? output?.text ?? rawTranscript;
  const activeEngine = status?.activeEngine ?? '—';

  const copyTranscript = async () => {
    if (!transcript) return;
    if (await copyText(transcript)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const retryProcessing = async () => {
    if (!rawTranscript.trim()) return;
    setRetrying(true);
    setReviewError(null);
    try {
      const result = await invoke('text:process', rawTranscript);
      setReviewedText(result.text);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (listening) {
      setReviewedText(null);
      setReviewError(null);
    }
  }, [listening]);

  const downloadModels = async () => {
    import('@/lib/bridge').then(async ({ invoke: inv }) => {
      setDownloading('vad');
      await inv('models:download', 'vad').catch(() => null);
      setDownloading('asr');
      await inv('models:download', 'asr').catch(() => null);
      setDownloading(null);
      await refreshStatus();
    });
  };

  const modelsInstalled = (status?.models ?? []).every((m) => m.installed);
  const hasModelFiles = (status?.models ?? []).some((m) => m.installed);

  return (
    <main className="flex h-screen overflow-hidden">
      <AppSidebar active="home" mode={OUTPUT_MODES.find((item) => item.value === settings?.output.mode)?.label} engine={activeEngine} />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ---------------------------------------------------------- titlebar */}
        <header className="drag-region flex h-14 items-center gap-3 border-b border-[#ebebe9] px-7 dark:border-white/10">
        <span className="text-[13px] font-semibold">Dictation</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Badge variant={listening ? 'recording' : 'muted'} className="gap-1.5 capitalize">
            <span
              className={cn(
                'size-1.5 rounded-full',
                listening ? 'bg-recording-foreground animate-pulse' : 'bg-muted-foreground',
              )}
            />
            {dictationState}
          </Badge>
          <span className="text-muted-foreground max-w-36 truncate text-xs" title={status?.engineReason}>
            {activeEngine}
          </span>
        </div>

        <div className="no-drag flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title="Minimize" onClick={() => void invoke('window:minimize')}>
            <Minus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Settings"
            onClick={() => {
              window.location.href = '/settings/';
            }}
          >
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Hide to tray"
            onClick={() => void invoke('window:hide')}
          >
            <X className="size-4" />
          </Button>
        </div>
        </header>

        {/* ------------------------------------------------------------ content */}
        <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col gap-4 px-7 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.04em]">Write with your voice</h1>
            <p className="text-muted-foreground mt-1 text-xs">Speak in any app. Your words appear where you are working.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground text-[11px]">{settings?.hotkey.mode === 'toggle' ? 'Press to talk' : 'Hold to talk'}</span>
            <KeyCap>{formatAccelerator(settings?.hotkey.accelerator ?? 'Ctrl+Super')}</KeyCap>
          </div>
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-1 border-b border-[#e8e8e6] dark:border-white/10">
          <span className="text-muted-foreground mr-3 text-xs font-medium">Output</span>
          {OUTPUT_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              disabled={listening || processing}
              onClick={() => void update({ output: { mode: mode.value } })}
              className={cn('no-drag -mb-px flex h-10 items-center border-b-2 px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50', settings?.output.mode === mode.value ? 'border-foreground text-foreground' : 'text-muted-foreground border-transparent hover:text-foreground')}
            >
              {mode.value === 'polish' && <WandSparkles className="mr-1 inline size-3" />}
              {mode.value.startsWith('translate') && <Languages className="mr-1 inline size-3" />}
              {mode.label}
            </button>
          ))}
          {settings?.output.mode.startsWith('translate') && (
            <button type="button" className="text-muted-foreground ml-auto text-xs hover:text-foreground" onClick={() => { window.location.href = '/settings/'; }}>Into {TARGET_LANGUAGES.find((item) => item.value === settings.output.targetLanguage)?.label ?? settings.output.targetLanguage} <span aria-hidden>↗</span></button>
          )}
        </div>
        {/* warnings */}
        {status?.hotkeyWarning && (
          <Notice tone="warn" onDismiss={undefined}>
            {status.hotkeyWarning}
          </Notice>
        )}
        {(micError || error) && (
          <Notice tone="error" onDismiss={() => { setMicError(null); clearError(); }}>
            {micError ?? error}
          </Notice>
        )}
        {settings && missingOutputKey(settings) && (
          <Notice tone="warn">
            <span className="flex-1">Add an API key in Settings → Output before using this mode.</span>
            <Button size="sm" variant="outline" onClick={() => { window.location.href = '/settings/'; }}>Open settings</Button>
          </Notice>
        )}
        {!modelsInstalled && (
          <Notice tone="info">
            <span className="flex-1">
              On-device model not downloaded{hasModelFiles ? ' (partial)' : ''}. Dictation will use a
              cloud provider once one is configured — or download the model to work fully offline (~900 MB).
            </span>
            <Button size="sm" variant="secondary" onClick={downloadModels} disabled={!!downloading}>
              {downloading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {downloading}
                </>
              ) : (
                <>
                  <Download className="size-3.5" />
                  Download
                </>
              )}
            </Button>
          </Notice>
        )}

        {/* transcript */}
        <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-xl border-[#e8e8e6] py-0 shadow-none dark:border-white/10">
          <CardHeader className="flex-row items-center justify-between gap-2 border-b border-[#eeeeec] px-6 py-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <CardTitle className="text-[13px]">{output || reviewedText ? 'Finished text' : 'Transcript'}</CardTitle>
              {transcript && (
                <span className="text-muted-foreground text-xs">
                  {countChars(transcript)} chars
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {rawTranscript && settings?.output.mode !== 'raw' && (
                <Button variant="ghost" size="sm" onClick={retryProcessing} disabled={retrying || processing}>
                  {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                  Retry
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!transcript}
                onClick={copyTranscript}
                className="gap-1.5"
              >
                {copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </CardHeader>

          <ScrollArea className="min-h-0 flex-1" ref={undefined}>
            <div ref={scrollRef} className="h-full overflow-y-auto px-7 py-6">
              {transcript ? (
                <p className="selectable max-w-[680px] text-[17px] leading-[1.7] whitespace-pre-wrap">
                  {transcript}
                  {listening && (
                    <span className="bg-primary animate-caret ml-0.5 inline-block h-5 w-[2px] translate-y-0.5 align-middle" />
                  )}
                </p>
              ) : (
                <div className="flex h-full min-h-52 flex-col items-center justify-center py-10 text-center">
                  <div className={cn('mb-4 flex size-12 items-center justify-center rounded-2xl', listening ? 'bg-red-50 text-recording dark:bg-red-500/10' : 'bg-[#f1f1ef] text-foreground dark:bg-muted')}>
                    {listening ? <Mic className="size-5" /> : <BrandMark className="size-6" />}
                  </div>
                  <p className="text-base font-semibold tracking-tight">
                    {listening ? 'Listening to you' : processing ? 'Finishing your text' : 'Ready when you are'}
                  </p>
                  <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-relaxed">
                    {listening ? 'Speak naturally. Pause when you are finished.' : 'Use your shortcut in any app, or start a recording here.'}
                  </p>
                  {!listening && !processing && (
                    <Button size="sm" className="mt-5" onClick={toggleSession}><Mic className="size-3.5" /> Start dictation</Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {(output || reviewedText) && rawTranscript && transcript !== rawTranscript && (
            <div className="border-t bg-stone-50 px-6 py-3 dark:bg-muted/30">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">Original transcript</div>
              <p className="selectable text-muted-foreground line-clamp-2 text-xs">{rawTranscript}</p>
            </div>
          )}
          {reviewError && <p className="text-destructive border-t px-6 py-2 text-xs">{reviewError}</p>}

          {/* meter */}
          <div className="flex items-center gap-3 border-t border-[#eeeeec] px-6 py-3 dark:border-white/10">
            <LevelMeter level={level.level} active={listening || processing} />
            <span className="text-muted-foreground text-xs">{listening ? 'Recording' : processing ? 'Processing' : 'Microphone ready'}</span>
            <div className="flex-1" />
            {(transcript || listening || processing) && (
              <Button
                onClick={toggleSession}
                variant={listening ? 'destructive' : 'default'}
                className="gap-2"
                disabled={processing}
              >
                {processing ? (
                  <><Loader2 className="size-4 animate-spin" />Finishing…</>
                ) : listening ? (
                  <><Square className="size-4" />Stop and insert</>
                ) : (
                  <><Mic className="size-4" />Start dictation</>
                )}
              </Button>
            )}
            {listening && (
              <Button variant="outline" onClick={cancel} className="gap-2">
                <X className="size-4" />
                Cancel
              </Button>
            )}
          </div>
        </Card>
        <div className="text-muted-foreground flex items-center justify-end gap-3 text-[11px]">
          <ModelSummary status={status} />
          {version && <span>v{version.app}</span>}
        </div>
        </div>
      </section>
    </main>
  );
}

function ModelSummary({ status }: { status: RuntimeStatus | null }) {
  const models = status?.models ?? [];
  if (!models.length) return null;
  const total = models.reduce((n, m) => n + m.bytes, 0);
  const ready = models.filter((m) => m.installed).length;
  return (
    <span className="flex items-center gap-1.5">
      <Cpu className="size-3" />
      {ready}/{models.length} models
      {total > 0 && ` · ${formatBytes(total)}`}
    </span>
  );
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  // Compact waveform follows the recording strip in the Mobbin Manus reference.
  const bars = 22;
  return (
    <div className="flex h-6 w-24 shrink-0 items-center gap-[2px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const threshold = i / bars;
        const on = active && level > threshold;
        return (
          <div
            key={i}
            className={cn(
              'h-full flex-1 rounded-sm transition-colors duration-75',
              on
                ? threshold > 0.8
                  ? 'bg-recording'
                  : threshold > 0.55
                    ? 'bg-amber-500'
                    : 'bg-settled'
                : 'bg-muted',
            )}
            style={{ transform: on ? 'scaleY(1)' : 'scaleY(0.35)' }}
          />
        );
      })}
    </div>
  );
}

function Notice({
  children,
  tone,
  onDismiss,
}: {
  children: React.ReactNode;
  tone: 'info' | 'warn' | 'error';
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        tone === 'info' && 'bg-muted/50 text-muted-foreground',
      )}
    >
      {tone === 'error' && <AlertCircle className="size-3.5 shrink-0" />}
      <div className="flex flex-1 items-center gap-2">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Render an accelerator as separate keycaps.
 *
 * Electron calls the Windows key `Super`; users call it Win, so translate for
 * display only — the stored value stays in Electron's vocabulary.
 */
const KEY_LABELS: Record<string, string> = { Super: 'Win', Meta: 'Win' };

function missingOutputKey(settings: Settings): boolean {
  const { mode, ai, translation } = settings.output;
  if (mode === 'raw') return false;
  if (mode === 'translate-api') return !translation.providers[translation.provider].apiKey.trim();
  const selected = mode === 'polish' ? ai.polish : ai.translate;
  return !selected.providers[selected.provider].apiKey.trim();
}

function formatAccelerator(accel: string): string[] {
  return accel
    .split('+')
    .map((p) => KEY_LABELS[p] ?? (p.length === 1 ? p.toUpperCase() : p));
}

function KeyCap({ children }: { children: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {children.map((part, i) => (
        <kbd
          key={i}
          className="bg-muted text-foreground inline-flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[11px] font-medium shadow-sm"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}
