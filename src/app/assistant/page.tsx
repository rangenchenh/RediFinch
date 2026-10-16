'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, Mic, Square, X } from 'lucide-react';
import type { AgentTask } from '@shared/types';
import { AppSidebar } from '@/components/app-sidebar';
import { Boot } from '@/components/boot';
import { NotInApp } from '@/components/not-in-app';
import { useVibetype } from '@/hooks/use-vibetype';
import { invoke, sendAudio, subscribe } from '@/lib/bridge';
import { MicCapture } from '@/lib/mic';

export default function AssistantPage() {
  const state = useVibetype();
  const [instruction, setInstruction] = useState('');
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chromeConnected, setChromeConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!state.inApp) return;
    return () => {
      if (recordingRef.current) void invoke('dictation:cancel');
      void invoke('hotkey:suspend', false);
    };
  }, [state.inApp]);

  useEffect(() => {
    if (!state.inApp) return;
    void invoke('agent:tasks').then(setTasks).catch((err) => setError(String(err)));
    return subscribe('agent:updated', (task) => setTasks((previous) => [task, ...previous.filter((item) => item.id !== task.id)].slice(0, 50)));
  }, [state.inApp]);

  useEffect(() => {
    if (!state.inApp) return;
    const capture = new MicCapture({ onSamples: sendAudio, onError: setError });
    mic.current = capture;
    void capture.prepare(state.settings?.audio.deviceId ?? null).catch((err) => setError(String(err)));
    return () => { void capture.dispose(); mic.current = null; };
  }, [state.inApp, state.settings?.audio.deviceId]);

  if (!state.ready) return <Boot />;
  if (!state.inApp) return <NotInApp />;

  const active = tasks.find((task) => ['running', 'awaiting-approval'].includes(task.status));
  const latest = tasks[0];

  async function toggleMic() {
    setError(null);
    setBusy(true);
    try {
      if (recording) {
        try {
          await mic.current?.stop();
          const result = await invoke('dictation:stop', { inject: false, process: false });
          if (result.error) throw new Error(result.error);
          setInstruction(result.text);
        } catch (err) {
          await invoke('dictation:cancel');
          throw err;
        } finally {
          setRecording(false);
          recordingRef.current = false;
          await invoke('hotkey:suspend', false);
        }
      } else {
        await invoke('hotkey:suspend', true);
        try {
          const started = await invoke('dictation:start');
          if (!started.ok) throw new Error(started.error ?? 'Could not start recording');
          await mic.current?.start(state.settings?.audio.deviceId ?? null);
          setRecording(true);
          recordingRef.current = true;
        } catch (err) {
          await invoke('dictation:cancel');
          await invoke('hotkey:suspend', false);
          throw err;
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function runTask() {
    setError(null);
    setBusy(true);
    try { await invoke('agent:start', instruction); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function connectChrome() {
    setError(null);
    setBusy(true);
    try {
      const result = await invoke('agent:connectChrome');
      if (!result.ok) throw new Error(result.error ?? 'Could not connect to Chrome');
      setChromeConnected(true);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-screen min-h-[560px] bg-[#fbfbfa] text-[#222322] dark:bg-[#1d1d1b] dark:text-[#f2f2ef]">
      <AppSidebar active="assistant" mode="Voice agent" engine={state.status?.activeEngine ?? 'Browser tools'} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="drag-region flex h-14 shrink-0 items-center justify-between border-b border-[#e8e8e6] px-8 dark:border-white/10">
          <div className="text-[12px] font-medium text-[#777]">Workspace / Assistant</div>
          <div className="no-drag flex items-center gap-1"><button className="rounded p-1 text-[#777] hover:bg-black/5" onClick={() => void invoke('window:minimize')} aria-label="Minimize"><span className="text-lg leading-none">−</span></button><button className="rounded p-1 text-[#777] hover:bg-black/5" onClick={() => void invoke('window:hide')} aria-label="Hide to tray"><X className="size-4" /></button></div>
        </header>
        <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col overflow-y-auto px-8 py-8">
          <div className="mb-8">
            <div className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-[#888] uppercase">Browser assistant</div>
            <h1 className="text-[29px] font-semibold tracking-[-0.04em]">Tell Ready Finch what to do</h1>
            <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-[#777] dark:text-[#aaa]">Speak or type a task, review the transcript, then let the assistant work in your existing Chrome session or propose a local computer command. You can see every action and stop it at any time.</p>
          </div>

          <div className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-[#e5e5e2] bg-[#f7f7f5] px-4 py-3 dark:border-white/10 dark:bg-[#242422]">
            <div><div className="text-[12px] font-semibold">Your Chrome session <span className={chromeConnected ? 'text-emerald-600' : 'text-[#999]'}>· {chromeConnected ? 'Connected' : 'Not connected'}</span></div><p className="mt-1 text-[11px] leading-5 text-[#888]">Enable Remote Debugging once in Chrome, then allow its connection prompt. Existing tabs and sign-ins stay available.</p></div>
            <div className="flex shrink-0 gap-2"><button onClick={() => void invoke('agent:openChromeSetup').catch((err) => setError(String(err)))} className="rounded-md border border-[#dededb] px-2.5 py-1.5 text-[11px] font-medium dark:border-white/20">Chrome setup</button><button onClick={() => void connectChrome()} disabled={busy || !!active} className="rounded-md bg-[#242424] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-[#eaeae7] dark:text-black">{busy ? 'Connecting…' : chromeConnected ? 'Reconnect' : 'Connect'}</button></div>
          </div>

          <div className="rounded-xl border border-[#e5e5e2] bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.025)] dark:border-white/10 dark:bg-[#242422]">
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Open example.com in my Chrome and find the pricing page…" className="min-h-[110px] w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-[#aaa]" maxLength={2000} />
            <div className="mt-3 flex items-center justify-between border-t border-[#ededeb] pt-3 dark:border-white/10">
              <button onClick={() => void toggleMic()} disabled={busy || !!active} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium disabled:opacity-40 ${recording ? 'bg-red-50 text-red-700' : 'bg-[#f3f3f1] hover:bg-[#eaeae8] dark:bg-white/10'}`}>
                {recording ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}{recording ? 'Stop recording' : 'Speak instruction'}
              </button>
              <button onClick={() => void runTask()} disabled={busy || recording || !!active || !instruction.trim()} className="inline-flex items-center gap-2 rounded-md bg-[#242424] px-4 py-2 text-[12px] font-medium text-white hover:bg-[#3a3a3a] disabled:opacity-40 dark:bg-[#eaeae7] dark:text-black">Run task <ArrowRight className="size-3.5" /></button>
            </div>
          </div>

          {error && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}

          <div className="mt-7 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Activity</h2>
            <div className="flex gap-3 text-[12px]">
              <button onClick={() => void invoke('agent:openChromeSetup').catch((err) => setError(String(err)))} className="inline-flex items-center gap-1 text-[#666] hover:text-foreground"><ExternalLink className="size-3.5" /> Open Chrome</button>
              {active && <button onClick={() => void invoke('agent:cancel', active.id)} className="inline-flex items-center gap-1 text-red-600"><X className="size-3.5" /> Stop task</button>}
            </div>
          </div>

          {latest ? <div className="mt-3 rounded-xl border border-[#e5e5e2] bg-white dark:border-white/10 dark:bg-[#242422]">
            <div className="flex items-start justify-between gap-4 border-b border-[#ededeb] px-4 py-3 dark:border-white/10">
              <div><div className="text-[13px] font-medium">{latest.instruction}</div><div className="mt-1 text-[11px] text-[#888]">{new Date(latest.createdAt).toLocaleString()}</div></div>
              <span className="shrink-0 rounded-full bg-[#f1f1ef] px-2 py-1 text-[10px] font-medium capitalize dark:bg-white/10">{latest.status.replace('-', ' ')}</span>
            </div>
            {latest.approval && <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
              <div className="font-semibold">{latest.approval.action === 'run_command' ? 'Run this command on your computer?' : 'Approve this browser action?'}</div><div className="mt-1 break-all font-mono">{latest.approval.detail}</div>
              <div className="mt-3 flex gap-2"><button onClick={() => void invoke('agent:approve', latest.id, true)} className="rounded bg-[#242424] px-3 py-1.5 text-white">Approve</button><button onClick={() => void invoke('agent:approve', latest.id, false)} className="rounded border border-amber-300 px-3 py-1.5">Skip</button></div>
            </div>}
            <ol className="max-h-[250px] overflow-y-auto p-4">
              {latest.steps.length ? latest.steps.map((step, index) => <li key={`${step.at}-${index}`} className="flex gap-3 py-1.5 text-[12px]"><span className="w-5 shrink-0 text-[#aaa]">{index + 1}</span><span className="w-20 shrink-0 font-medium">{step.action.replace('_', ' ')}</span><span className="min-w-0 break-all text-[#777] dark:text-[#aaa]">{step.detail}</span></li>) : <li className="text-[12px] text-[#888]">Waiting for the first browser action…</li>}
            </ol>
            {(latest.result || latest.error) && <div className="border-t border-[#ededeb] px-4 py-3 text-[12px] leading-5 dark:border-white/10">{latest.result ?? latest.error}</div>}
          </div> : <div className="mt-3 rounded-xl border border-dashed border-[#dededb] px-4 py-10 text-center text-[12px] text-[#999]">Your browser task will appear here.</div>}
          <p className="mt-5 text-[11px] leading-5 text-[#999]">Uses the separate model and tool permissions in <a className="underline underline-offset-2 hover:text-foreground" href="/settings/?tab=agent">Settings → Agent</a>. Page snapshots and short command results are sent to that provider when the related tools are enabled. Local commands require your approval each time; sensitive fields need manual entry.</p>
        </div>
      </main>
    </div>
  );
}
