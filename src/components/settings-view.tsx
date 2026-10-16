'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Languages,
  Mic,
  Minus,
  RefreshCw,
  RotateCcw,
  Zap,
  WandSparkles,
  X,
} from 'lucide-react';
import type { AiProviderId, CloudProviderId, DictationLanguage, EngineStrategy, OutputMode, Settings, SpekoSttModel, TranslationProviderId } from '@shared/types';
import { AI_PROVIDERS, CLOUD_PROVIDER_LABELS, DICTATION_LANGUAGES, OUTPUT_MODES, TARGET_LANGUAGES, TRANSLATION_PROVIDERS } from '@shared/types';
import { AI_MODEL_CATALOG, STT_MODEL_CATALOG, type ModelCatalog } from '@shared/model-catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hasBridge, invoke } from '@/lib/bridge';
import { AppSidebar } from '@/components/app-sidebar';
import { MicCapture } from '@/lib/mic';
import { formatBytes } from '@/lib/utils';

interface Props {
  state: ReturnType<typeof import('@/hooks/use-vibetype').useVibetype>;
}

export function SettingsView({ state }: Props) {
  const { settings, status, update, refreshStatus, modelProgress } = state;
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [providers, setProviders] = useState<
    Array<{ provider: string; reachable: boolean; detail: string }>
  >([]);
  const [checking, setChecking] = useState(false);
  const [activeTab, setActiveTab] = useState('output');
  const progress = modelProgress;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'agent') setActiveTab('agent');
  }, []);

  // Device labels are blank until mic permission exists, so ask for it on entry.
  useEffect(() => {
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* listing falls back to generic labels */
      }
      setDevices(await MicCapture.listDevices());
    })();
  }, []);

  // `settings` is guaranteed by the page gate, but keep the hook honest.
  if (!settings) return null;

  const checkProviders = async () => {
    setChecking(true);
    try {
      setProviders(await invoke('runtime:providers'));
    } finally {
      setChecking(false);
    }
  };

  const download = async (kind: 'vad' | 'asr') => {
    // Progress arrives via the `models:progress` event.
    await invoke('models:download', kind);
    await refreshStatus();
  };

  return (
    <main className="settings-shell flex h-screen overflow-hidden">
      <AppSidebar active="settings" mode={OUTPUT_MODES.find((item) => item.value === settings.output.mode)?.label} engine={status?.activeEngine} />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="drag-region flex h-14 items-center gap-3 border-b border-[#ebebe9] px-7 dark:border-white/10">
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag"
          onClick={() => {
            window.location.href = '/';
          }}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-[13px] font-semibold">Settings</span>
        <Button
          variant="ghost"
          size="sm"
          className="no-drag ml-auto gap-1.5"
          onClick={async () => {
            await invoke('settings:reset');
            await refreshStatus();
          }}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
        <div className="no-drag ml-1 flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title="Minimize" onClick={() => void invoke('window:minimize')}><Minus className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" title="Hide to tray" onClick={() => void invoke('window:hide')}><X className="size-4" /></Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="px-7 pt-7">
          <div className="mx-auto mb-5 w-full max-w-[780px]">
            <h1 className="text-[22px] font-semibold tracking-[-0.04em]">Preferences</h1>
            <p className="text-muted-foreground mt-1 text-xs">Set up how Ready Finch listens, processes, and inserts your words.</p>
          </div>
          <TabsList className="mx-auto flex h-10 w-full max-w-[780px] justify-start gap-5 rounded-none border-b border-[#e8e8e6] bg-transparent p-0 dark:border-white/10">
            <TabsTrigger value="output">
              <WandSparkles className="size-3.5" />
              Output
            </TabsTrigger>
            <TabsTrigger value="agent">
              <Bot className="size-3.5" />
              Agent
            </TabsTrigger>
            <TabsTrigger value="engine">
              <Zap className="size-3.5" />
              Engine
            </TabsTrigger>
            <TabsTrigger value="input">
              <Mic className="size-3.5" />
              Input
            </TabsTrigger>
            <TabsTrigger value="insertion">
              <HardDrive className="size-3.5" />
              Insertion
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[780px] space-y-0 px-7 pb-8">
            <TabsContent value="agent" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm"><Bot className="size-4" /> Agent model</CardTitle>
                  <CardDescription>This model plans actions for Assistant tasks. It has its own provider, key, and model, separate from Polish and translation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4"><AiProviderFields mode="agent" settings={settings} update={update} /></CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Tool access</CardTitle>
                  <CardDescription>Choose what the Agent can request. These controls are enforced before each action, even if the model proposes a disabled tool.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <Toggle label="Read Chrome tabs" hint="Send the active page snapshot to your Agent model." checked={settings.agent.tools.chromeRead} onChange={(chromeRead) => void update({ agent: { tools: { chromeRead } } })} />
                  <Separator />
                  <Toggle label="Open web pages" hint="Open an HTTPS or HTTP URL in your existing Chrome session." checked={settings.agent.tools.chromeNavigate} onChange={(chromeNavigate) => void update({ agent: { tools: { chromeNavigate } } })} />
                  <Separator />
                  <Field label="Click and type in Chrome" hint="Requires Chrome reading">
                    <Select value={settings.agent.tools.chromeInteract} onValueChange={(chromeInteract) => void update({ agent: { tools: { chromeInteract } } })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="ask">Ask before every click and text entry</SelectItem>
                        <SelectItem value="auto">Automatic, with sensitive clicks reviewed</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="text-muted-foreground text-xs">Scrolling does not require approval. Password and payment fields always require manual entry. Sensitive click detection is limited; use “Ask” for higher control.</p>
                  <Separator />
                  <Toggle label="Local PowerShell commands" hint="Allow the Agent to propose a command. Every command still needs your approval." checked={settings.agent.tools.localCommands} onChange={(localCommands) => void update({ agent: { tools: { localCommands } } })} />
                </CardContent>
              </Card>
              <p className="text-muted-foreground px-1 text-xs leading-5">Current Agent tasks are limited to 15 actions. Tasks stop when the app closes and cannot yet resume. The Agent has no long-term memory or app connectors.</p>
            </TabsContent>
            {/* -------------------------------------------------- engine tab */}
            <TabsContent value="engine" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Transcription engine</CardTitle>
                  <CardDescription>
                    Where your audio gets turned into text. On-device keeps it private and works
                    offline; cloud is faster to set up and lighter on CPU.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Strategy" hint="What to prefer when both are available">
                    <Select
                      value={settings.strategy}
                      onValueChange={(v) => void update({ strategy: v as EngineStrategy })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">
                          Auto — on-device when installed, cloud otherwise
                        </SelectItem>
                        <SelectItem value="local">On-device only (private, offline)</SelectItem>
                        <SelectItem value="cloud">Cloud only (fastest, needs a key)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Cloud provider</div>
                      <div className="text-muted-foreground text-xs">
                        Used when strategy is <code>cloud</code>, or as the auto fallback.
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkProviders}
                      disabled={checking}
                      className="gap-1.5"
                    >
                      {checking ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Test
                    </Button>
                  </div>

                  {providers.length > 0 && (
                    <div className="space-y-1.5">
                      {providers.map((p) => (
                        <div
                          key={p.provider}
                          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                        >
                          <span
                            className={`size-1.5 rounded-full ${p.reachable ? 'bg-settled' : 'bg-destructive'}`}
                          />
                          <span className="font-medium">
                            {p.provider === 'local'
                              ? 'On-device'
                              : (CLOUD_PROVIDER_LABELS[p.provider as CloudProviderId] ??
                                p.provider)}
                          </span>
                          <span className="text-muted-foreground ml-auto truncate">{p.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <ProviderFields settings={settings} update={update} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">On-device model</CardTitle>
                  <CardDescription>
                    SenseVoice-Small (~900 MB) handles multilingual speech in one utterance,
                    with punctuation and number normalisation built in.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(status?.models ?? []).map((m) => (
                    <div key={m.kind} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {m.kind === 'vad' ? 'Voice activity detector' : 'Speech recogniser'}
                        </span>
                        {m.installed ? (
                          <Badge variant="settled" className="gap-1">
                            <Check className="size-3" />
                            {formatBytes(m.bytes)}
                          </Badge>
                        ) : progress[m.kind] != null ? (
                          <Badge variant="muted">{Math.round((progress[m.kind] ?? 0) * 100)}%</Badge>
                        ) : (
                          <Badge variant="muted">not installed</Badge>
                        )}
                        <div className="ml-auto flex gap-1.5">
                          {!m.installed && progress[m.kind] == null && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => download(m.kind)}
                            >
                              <Download className="size-3.5" />
                              Download
                            </Button>
                          )}
                          {m.installed && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={m.path}
                              onClick={() => void invoke('app:openLogs')}
                            >
                              <FolderOpen className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {progress[m.kind] != null && <Progress value={(progress[m.kind] ?? 0) * 100} />}
                      {m.error && (
                        <div className="text-destructive flex items-start gap-1.5 text-xs">
                          <AlertCircle className="mt-0.5 size-3 shrink-0" />
                          <span className="selectable">{m.error}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Language</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field
                    label="Dictation language"
                    hint="Names the language to the model instead of detecting it — faster and more accurate"
                  >
                    <Select
                      value={settings.language.primary}
                      onValueChange={(v) =>
                        void update({ language: { primary: v as DictationLanguage } })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DICTATION_LANGUAGES.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label="Bias prompt"
                    hint="Names and jargon to nudge the model toward (cloud providers only)"
                  >
                    <Input
                      value={settings.language.prompt}
                      placeholder="e.g. Next.js, shadcn, Kubernetes"
                      onChange={(e) => void update({ language: { prompt: e.target.value } })}
                    />
                  </Field>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="output" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm"><WandSparkles className="size-4" /> Output mode</CardTitle>
                  <CardDescription>Choose what happens after transcription and before text is inserted.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Mode">
                    <Select value={settings.output.mode} onValueChange={(mode) => void update({ output: { mode: mode as OutputMode } })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{OUTPUT_MODES.map((mode) => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <p className="text-muted-foreground text-xs">The current raw transcript stays available when you visit Settings. If processing fails, nothing is inserted, so you can change the key and retry.</p>
                  {settings.output.mode.startsWith('translate') && (
                    <Field label="Target language">
                      <Select value={settings.output.targetLanguage} onValueChange={(targetLanguage) => void update({ output: { targetLanguage } })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{TARGET_LANGUAGES.map((lang) => <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm"><WandSparkles className="size-4" /> AI polish</CardTitle>
                  <CardDescription>Choose a provider for cleaning up dictated text. Each provider keeps its own key and model.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AiProviderFields mode="polish" settings={settings} update={update} />
                  <Field label="Polish preference" hint="Optional: tone, formatting or vocabulary guidance"><Input value={settings.output.polishPrompt} placeholder="e.g. Concise and professional" onChange={(e) => void update({ output: { polishPrompt: e.target.value } })} /></Field>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm"><Languages className="size-4" /> AI translation</CardTitle>
                  <CardDescription>Choose an AI provider separately from polish. Your target language is set above.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AiProviderFields mode="translate" settings={settings} update={update} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm"><Languages className="size-4" /> Direct translation API</CardTitle>
                  <CardDescription>Translate without an AI chat model. Choose the service that issued your key.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TranslationProviderFields settings={settings} update={update} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* --------------------------------------------------- input tab */}
            <TabsContent value="input" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Hotkey</CardTitle>
                  <CardDescription>
                    Hold the key, speak, release. The text lands in whatever app has focus.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Current mode shortcut">
                    <HotkeyRecorder
                      value={settings.hotkey.accelerator}
                      onChange={(accel) => void update({ hotkey: { accelerator: accel } })}
                    />
                  </Field>

                  <div className="border-t border-[#e8e8e6] pt-4 dark:border-white/10">
                    <div className="text-[13px] font-medium">Mode shortcuts</div>
                    <p className="text-muted-foreground mt-1 text-xs">Start dictation in a specific output mode. You can add Shift to the current shortcut for a quick switch.</p>
                    <div className="mt-3 space-y-2.5">
                      {OUTPUT_MODES.map(({ value, label }) => (
                        <div key={value} className="grid grid-cols-[115px_1fr_auto] items-center gap-2">
                          <span className="text-xs font-medium">{label}</span>
                          <HotkeyRecorder
                            value={settings.hotkey.modeShortcuts[value]}
                            onChange={(accelerator) => void update({ hotkey: { modeShortcuts: { [value]: accelerator } } })}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={!settings.hotkey.modeShortcuts[value]}
                            onClick={() => void update({ hotkey: { modeShortcuts: { [value]: '' } } })}
                          >Clear</Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Field label="Activation mode">
                    <Select
                      value={settings.hotkey.mode}
                      onValueChange={(v) =>
                        void update({ hotkey: { mode: v as Settings['hotkey']['mode'] } })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hold">Hold to talk (recommended)</SelectItem>
                        <SelectItem value="toggle">Press once to start, again to stop</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {status?.hotkeyWarning && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{status.hotkeyWarning}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Microphone</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Input device">
                    <Select
                      value={settings.audio.deviceId ?? 'default'}
                      onValueChange={(v) =>
                        void update({ audio: { deviceId: v === 'default' ? null : v } })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">System default</SelectItem>
                        {devices.map((d) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field
                    label="Silence before finishing"
                    hint={`${settings.audio.silenceMs} ms — lower feels snappier, higher handles pauses mid-sentence`}
                  >
                    <Slider
                      value={[settings.audio.silenceMs]}
                      min={150}
                      max={2000}
                      step={10}
                      onValueChange={([v]) => void update({ audio: { silenceMs: v } })}
                    />
                  </Field>

                  <Field
                    label="Voice activity sensitivity"
                    hint={`${Math.round((1 - settings.audio.vadThreshold) * 100)}% — raise if background noise triggers it`}
                  >
                    <Slider
                      value={[settings.audio.vadThreshold]}
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      onValueChange={([v]) => void update({ audio: { vadThreshold: v } })}
                    />
                  </Field>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ----------------------------------------------- insertion tab */}
            <TabsContent value="insertion" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">How text is inserted</CardTitle>
                  <CardDescription>
                    Paste is instant and handles any length. Typing avoids touching the clipboard
                    but is slower and can trip autocomplete.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Method">
                    <Select
                      value={settings.injection.method}
                      onValueChange={(v) =>
                        void update({ injection: { method: v as Settings['injection']['method'] } })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto — paste, falling back to typing</SelectItem>
                        <SelectItem value="paste">Paste (clipboard)</SelectItem>
                        <SelectItem value="type">Type character by character</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Toggle
                    label="Restore clipboard afterwards"
                    hint="Put back whatever you had copied before dictating"
                    checked={settings.injection.restoreClipboard}
                    onChange={(v) => void update({ injection: { restoreClipboard: v } })}
                  />
                  <Separator />
                  <Toggle
                    label="Keep transcript on clipboard"
                    hint="Leaves the text copied so you can paste it again elsewhere"
                    checked={settings.injection.keepInClipboard}
                    onChange={(v) => void update({ injection: { keepInClipboard: v } })}
                  />
                  <Separator />
                  <Toggle
                    label="Append a trailing space"
                    hint="So your next typed word does not run into the dictated text"
                    checked={settings.injection.trailingSpace}
                    onChange={(v) => void update({ injection: { trailingSpace: v } })}
                  />
                  <Separator />
                  <Toggle
                    label="Spoken punctuation"
                    hint='Say "comma", "period", "new line" to insert symbols'
                    checked={settings.injection.spokenPunctuation}
                    onChange={(v) => void update({ injection: { spokenPunctuation: v } })}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">App behaviour</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Toggle
                    label="Show the floating overlay"
                    hint="A small always-on-top pill with the live transcript"
                    checked={settings.ui.showOverlay}
                    onChange={(v) => void update({ ui: { showOverlay: v } })}
                  />
                  <Separator />
                  <Toggle
                    label="Start hidden"
                    hint="Launch straight to the tray without opening the window"
                    checked={settings.ui.startHidden}
                    onChange={(v) => void update({ ui: { startHidden: v } })}
                  />
                  <Separator />
                  <Toggle
                    label="Launch at login"
                    hint="Requires the packaged app, not a dev build"
                    checked={settings.ui.launchAtLogin}
                    onChange={(v) => void update({ ui: { launchAtLogin: v } })}
                  />
                  <Separator />
                  <Field label={`Overlay opacity — ${Math.round(settings.ui.overlayOpacity * 100)}%`}>
                    <Slider
                      value={[settings.ui.overlayOpacity]}
                      min={0.4}
                      max={1}
                      step={0.02}
                      onValueChange={([v]) => void update({ ui: { overlayOpacity: v } })}
                    />
                  </Field>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Diagnostics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {status && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                      <dt className="text-muted-foreground">Active engine</dt>
                      <dd className="selectable font-medium">{status.activeEngine}</dd>
                      <dt className="text-muted-foreground">Why</dt>
                      <dd className="selectable">{status.engineReason}</dd>
                      <dt className="text-muted-foreground">Hotkey</dt>
                      <dd>
                        {status.hotkeyRegistered ? (
                          <span className="text-settled">registered</span>
                        ) : (
                          <span className="text-destructive">not registered</span>
                        )}
                      </dd>
                    </dl>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void invoke('app:openLogs')}
                  >
                    <FolderOpen className="size-3.5" />
                    Open logs
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
      </section>
    </main>
  );
}

function ModelPicker({ value, catalog, onChange }: {
  value: string;
  catalog: ModelCatalog;
  onChange: (model: string) => void;
}) {
  const preset = catalog.options.some((option) => option.id === value);
  return <div className="space-y-2">
    <Select value={preset ? value : '__custom__'} onValueChange={(choice) => onChange(choice === '__custom__' ? '' : choice)}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {catalog.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label} · {option.id}</SelectItem>)}
        <SelectItem value="__custom__">Custom model ID…</SelectItem>
      </SelectContent>
    </Select>
    {!preset && <Input value={value} spellCheck={false} autoComplete="off" placeholder="Enter model ID" onChange={(event) => onChange(event.target.value)} />}
    <p className="text-muted-foreground text-xs">Availability depends on your account. <a className="underline underline-offset-2 hover:text-foreground" href={catalog.docsUrl} target="_blank" rel="noreferrer">Official model list ↗</a></p>
  </div>;
}

function AiProviderFields({ mode, settings, update }: {
  mode: 'polish' | 'translate' | 'agent';
  settings: Settings;
  update: (patch: unknown) => Promise<Settings | null>;
}) {
  const selection = mode === 'agent' ? settings.agent.ai : settings.output.ai[mode];
  const provider = selection.provider;
  const config = selection.providers[provider];
  const patchField = (field: 'apiKey' | 'model' | 'baseUrl', value: string) =>
    void update(mode === 'agent'
      ? { agent: { ai: { providers: { [provider]: { [field]: value } } } } }
      : { output: { ai: { [mode]: { providers: { [provider]: { [field]: value } } } } } });

  return <>
    <Field label="Provider">
      <Select value={provider} onValueChange={(value) => void update(mode === 'agent'
        ? { agent: { ai: { provider: value as AiProviderId } } }
        : { output: { ai: { [mode]: { provider: value as AiProviderId } } } })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{AI_PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
    <Field label="API key"><Input type="password" value={config.apiKey} autoComplete="off" onChange={(event) => patchField('apiKey', event.target.value)} /></Field>
    <Field label="Model">
      {provider === 'custom'
        ? <Input value={config.model} spellCheck={false} placeholder="Model ID" onChange={(event) => patchField('model', event.target.value)} />
        : <ModelPicker value={config.model} catalog={AI_MODEL_CATALOG[provider]} onChange={(value) => patchField('model', value)} />}
    </Field>
    {provider === 'custom' && <Field label="Base URL" hint="OpenAI-compatible endpoint, ending in /v1 when required"><Input value={config.baseUrl} spellCheck={false} placeholder="https://your-provider.example/v1" onChange={(event) => patchField('baseUrl', event.target.value)} /></Field>}
  </>;
}

function TranslationProviderFields({ settings, update }: {
  settings: Settings;
  update: (patch: unknown) => Promise<Settings | null>;
}) {
  const selection = settings.output.translation;
  const provider = selection.provider;
  const config = selection.providers[provider];
  const patchField = (field: 'apiKey' | 'region' | 'baseUrl', value: string) =>
    void update({ output: { translation: { providers: { [provider]: { [field]: value } } } } });

  return <>
    <Field label="Provider">
      <Select value={provider} onValueChange={(value) => void update({ output: { translation: { provider: value as TranslationProviderId } } })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{TRANSLATION_PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
    <Field label="API key"><Input type="password" value={config.apiKey} autoComplete="off" onChange={(event) => patchField('apiKey', event.target.value)} /></Field>
    {provider === 'azure' && <Field label="Region" hint="Only required for a regional or multi-service Azure resource"><Input value={config.region} spellCheck={false} placeholder="e.g. eastasia" onChange={(event) => patchField('region', event.target.value)} /></Field>}
    {provider === 'custom' && <Field label="Base URL" hint="DeepL-compatible /v2 endpoint"><Input value={config.baseUrl} spellCheck={false} placeholder="https://your-provider.example/v2" onChange={(event) => patchField('baseUrl', event.target.value)} /></Field>}
    {provider === 'google' && <p className="text-muted-foreground text-xs">Requires a Google Cloud project with the Translation API enabled.</p>}
  </>;
}

function SpekoRouterFields({ settings, update }: {
  settings: Settings;
  update: (patch: unknown) => Promise<Settings | null>;
}) {
  const config = settings.cloud.speko;
  const [models, setModels] = useState<SpekoSttModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!config.apiKey.trim() || !hasBridge()) {
      setModels([]);
      setLoading(false);
      setError(config.apiKey.trim() && !hasBridge() ? 'Open the desktop app to load live models.' : '');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      void invoke('speko:models').then((result) => {
        if (!cancelled) setModels(result);
      }).catch((reason: unknown) => {
        if (!cancelled) { setModels([]); setError(reason instanceof Error ? reason.message : 'Could not load Speko models'); }
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [config.apiKey, refresh]);

  const patch = (fields: Record<string, string>) => void update({ cloud: { speko: fields } });
  const selected = models.find((item) => item.provider === config.provider && item.id === config.model);
  const selectedValue = selected ? JSON.stringify([selected.provider, selected.id]) : '__custom__';

  return <div className="space-y-4">
    <Field label="Routing">
      <Select value={config.routingMode} onValueChange={(value) => patch({ routingMode: value })}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Automatic · Speko chooses</SelectItem>
          <SelectItem value="explicit">Choose a model</SelectItem>
        </SelectContent>
      </Select>
    </Field>
    {config.routingMode === 'auto'
      ? <Field label="Optimize for">
          <Select value={config.objective} onValueChange={(value) => patch({ objective: value })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latency">Speed</SelectItem>
              <SelectItem value="quality">Accuracy</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="cost">Cost</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      : <>
          <Field label="Model" hint="Speko lists models currently available to your account and region.">
            <div className="space-y-2">
              <Select value={selectedValue} onValueChange={(value) => {
                if (value === '__custom__') patch({ provider: '', model: '' });
                else {
                  const [provider, model] = JSON.parse(value) as [string, string];
                  patch({ provider, model });
                }
              }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((item) => <SelectItem key={`${item.provider}:${item.id}`} value={JSON.stringify([item.provider, item.id])}>{item.provider} · {item.id}</SelectItem>)}
                  <SelectItem value="__custom__">Custom provider + model ID…</SelectItem>
                </SelectContent>
              </Select>
              {!selected && <div className="grid grid-cols-2 gap-2">
                <Input value={config.provider} spellCheck={false} placeholder="Provider ID" onChange={(event) => patch({ provider: event.target.value })} />
                <Input value={config.model} spellCheck={false} placeholder="Model ID" onChange={(event) => patch({ model: event.target.value })} />
              </div>}
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{loading ? 'Loading Speko models…' : error || (!config.apiKey.trim() ? 'Add an API key to load models.' : `${models.length} models available`)}</span>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setRefresh((n) => n + 1)} disabled={!config.apiKey.trim() || loading}><RefreshCw className="size-3" /> Refresh</Button>
              </div>
              <a className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" href="https://docs.speko.ai/relay/models" target="_blank" rel="noreferrer">Speko model catalog ↗</a>
            </div>
          </Field>
          <p className="text-muted-foreground text-xs">Choosing a model pins this route. Speko automatic failover applies only to Automatic routing.</p>
        </>}
  </div>;
}

function ProviderFields({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: unknown) => Promise<Settings | null>;
}) {
  const provider = settings.cloudProvider;

  type FieldSpec = {
    label: string;
    key: string;
    value: string;
    placeholder?: string;
    secret?: boolean;
    hint?: string;
  };
  type RowSpec = { id: CloudProviderId; name: string; note: string; fields: FieldSpec[] };

  const rows: RowSpec[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      note: 'Whisper. Widely supported and accurate.',
      fields: [
        { label: 'Base URL', key: 'baseUrl', value: settings.cloud.openai.baseUrl },
        { label: 'API key', key: 'apiKey', value: settings.cloud.openai.apiKey, secret: true },
        { label: 'Model', key: 'model', value: settings.cloud.openai.model },
      ],
    },
    {
      id: 'groq',
      name: 'Groq Whisper',
      note: 'Fast Whisper transcription through Groq’s OpenAI-compatible API.',
      fields: [
        { label: 'Base URL', key: 'baseUrl', value: settings.cloud.groq.baseUrl },
        { label: 'API key', key: 'apiKey', value: settings.cloud.groq.apiKey, secret: true },
        { label: 'Model', key: 'model', value: settings.cloud.groq.model },
      ],
    },
    {
      id: 'siliconflow',
      name: 'SiliconFlow',
      note: 'Runs SenseVoice in the cloud — the same model as the on-device option.',
      fields: [
        { label: 'Base URL', key: 'baseUrl', value: settings.cloud.siliconflow.baseUrl },
        {
          label: 'API key',
          key: 'apiKey',
          value: settings.cloud.siliconflow.apiKey,
          secret: true,
          placeholder: 'sk-…',
        },
        { label: 'Model', key: 'model', value: settings.cloud.siliconflow.model },
      ],
    },
    {
      id: 'speko',
      name: 'Speko Router',
      note: 'Automatic routing or a specific speech model from your Speko account.',
      fields: [{ label: 'API key', key: 'apiKey', value: settings.cloud.speko.apiKey, secret: true }],
    },
    {
      id: 'deepgram',
      name: 'Deepgram',
      note: 'True streaming — text appears as you speak.',
      fields: [
        { label: 'API key', key: 'apiKey', value: settings.cloud.deepgram.apiKey, secret: true },
        { label: 'Model', key: 'model', value: settings.cloud.deepgram.model },
      ],
    },
    {
      id: 'elevenlabs',
      name: 'ElevenLabs Scribe',
      note: 'Strong accuracy on mixed-language speech.',
      fields: [
        { label: 'API key', key: 'apiKey', value: settings.cloud.elevenlabs.apiKey, secret: true },
        {
          label: 'Model',
          key: 'model',
          value: settings.cloud.elevenlabs.model,
          hint: 'Scribe v2 supports both English and Chinese.',
        },
      ],
    },
    {
      id: 'assemblyai',
      name: 'AssemblyAI',
      note: 'Uploads each utterance, then polls for the result — noticeably slower than the others.',
      fields: [
        { label: 'API key', key: 'apiKey', value: settings.cloud.assemblyai.apiKey, secret: true },
        {
          label: 'Model',
          key: 'model',
          value: settings.cloud.assemblyai.model,
          hint: 'Use a multilingual model for non-English audio.',
        },
      ],
    },
    {
      id: 'google',
      name: 'Google Cloud STT',
      note: 'Requires the Speech-to-Text API to be enabled on the key.',
      fields: [
        { label: 'API key', key: 'apiKey', value: settings.cloud.google.apiKey, secret: true },
        {
          label: 'Model',
          key: 'model',
          value: settings.cloud.google.model,
          hint: 'latest_long, latest_short, or a specific model name',
        },
      ],
    },
    {
      id: 'azure',
      name: 'Azure Speech',
      note: 'Endpoint is built from your region, so the region has to be right or every request 404s.',
      fields: [
        { label: 'API key', key: 'apiKey', value: settings.cloud.azure.apiKey, secret: true },
        {
          label: 'Region',
          key: 'region',
          value: settings.cloud.azure.region,
          hint: 'e.g. eastasia, southeastasia, westus',
        },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <Field label="Provider">
        <Select value={provider} onValueChange={(id) => void update({ cloudProvider: id as CloudProviderId })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {rows.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <p className="text-muted-foreground text-xs leading-relaxed">{rows.find((row) => row.id === provider)?.note}</p>
      <div className="space-y-4 border-t pt-4">
        {rows
          .filter((r) => r.id === provider)
          .map((row) =>
            row.fields.map((f) => (
              <Field key={`${row.id}-${f.key}`} label={f.label} hint={f.hint}>
                {f.key === 'model' && STT_MODEL_CATALOG[row.id]
                  ? <ModelPicker value={f.value} catalog={STT_MODEL_CATALOG[row.id]!} onChange={(value) => void update({ cloud: { [row.id]: { model: value } } })} />
                  : <Input
                    type={f.secret ? 'password' : 'text'}
                    value={f.value}
                    placeholder={f.placeholder}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => void update({ cloud: { [row.id]: { [f.key]: e.target.value } } })}
                  />}
              </Field>
            )),
          )}
        {provider === 'speko' && <SpekoRouterFields settings={settings} update={update} />}
      </div>
    </div>
  );
}

/**
 * Captures an accelerator by listening for the next key chord.
 *
 * Modifier-only chords are accepted: holding Ctrl+Win fires `keydown` for the
 * modifiers and nothing else, so the recorder commits when the user releases
 * rather than waiting for a key that will never come. Escape cancels.
 */
function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [modsOnly, setModsOnly] = useState<string[]>([]);

  useEffect(() => {
    if (!recording) return;
    void invoke('hotkey:suspend', true);
    return () => { void invoke('hotkey:suspend', false); };
  }, [recording]);

  useEffect(() => {
    if (!recording) return;

    const modsOf = (e: KeyboardEvent): string[] => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');
      return parts;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        setModsOnly([]);
        return;
      }

      const mods = modsOf(e);

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        // Remember the modifiers so releasing them can commit a chord.
        setModsOnly(mods);
        return;
      }

      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      onChange([...mods, key].join('+'));
      setRecording(false);
      setModsOnly([]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key) && modsOnly.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        onChange(modsOnly.join('+'));
        setRecording(false);
        setModsOnly([]);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [recording, modsOnly, onChange]);

  return (
    <button
      type="button"
      onClick={() => {
        setModsOnly([]);
        setRecording((r) => !r);
      }}
      className={`flex h-9 w-full items-center justify-center rounded-md border text-sm transition-colors ${
        recording ? 'border-primary bg-accent animate-pulse' : 'hover:bg-accent/40'
      }`}
    >
      {recording ? (
        <span className="text-muted-foreground text-xs">
          Press a key combination… (modifiers alone work too)
        </span>
      ) : (
        <span className="flex items-center gap-1">
          {value ? value.split('+').map((p, i) => (
            <kbd
              key={i}
              className="bg-muted inline-flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[11px]"
            >
              {p}
            </kbd>
          )) : <span className="text-muted-foreground text-xs">Click to record</span>}
        </span>
      )}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-muted-foreground text-right text-[11px]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-muted-foreground text-xs">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
