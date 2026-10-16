/**
 * Microphone capture for the renderer.
 *
 * ## Why this class is built around a persistent pipeline
 *
 * The obvious implementation opens the microphone on hotkey-press and closes it
 * on release. That is also why it feels slow: acquiring an audio device is the
 * expensive part of capture. `getUserMedia` negotiates with the OS audio stack,
 * constructs an `AudioContext` (which spins up a real-time audio thread), and
 * compiles the `AudioWorklet` module — all of which were being paid on **every
 * press**, for hundreds of milliseconds before a single sample could flow.
 *
 * So the pipeline is built once and kept. Starting a recording is then just
 * enabling a track and flipping a flag in the worklet, which costs microseconds
 * instead of a device handshake.
 *
 * The trade-off, stated plainly: while the app is idle the microphone is still
 * *allocated*, though its track is disabled so no audio is delivered. That is
 * what buys the instant start, and it is the same trade every always-listening
 * dictation tool makes.
 */

const TARGET_SAMPLE_RATE = 16000;
/** 2048 frames @ 16 kHz ≈ 128 ms — small enough to feel live. */
const CHUNK_FRAMES = 2048;

export interface MicCaptureHandlers {
  onLevel?: (level: number) => void;
  onError?: (message: string) => void;
  onSamples?: (samples: Float32Array) => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;

  /** Device the live pipeline was built for, so a switch triggers a rebuild. */
  private preparedDeviceId: string | null | undefined = undefined;
  private preparing: Promise<void> | null = null;
  private running = false;

  constructor(private handlers: MicCaptureHandlers = {}) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** True once a device is allocated and a press would start instantly. */
  get isPrepared(): boolean {
    return this.stream !== null && this.context !== null && this.node !== null;
  }

  /**
   * Build the pipeline without starting a recording. Safe to call repeatedly.
   *
   * Call this on mount and whenever the app goes idle, so the first hotkey press
   * is as fast as the hundredth.
   */
  async prepare(deviceId: string | null): Promise<void> {
    if (this.isPrepared && this.preparedDeviceId === deviceId) return;
    // Coalesce concurrent callers: two rapid presses must not race two
    // getUserMedia calls and leak one device.
    if (this.preparing) return this.preparing;

    this.preparing = this.build(deviceId).finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }

  private async build(deviceId: string | null): Promise<void> {
    await this.teardown();

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // All three are essential for dictation quality:
        //  - EC prevents the app's own output feeding back
        //  - NS removes keyboard and fan noise the VAD would otherwise catch
        //  - AGC keeps quiet speech above the VAD threshold
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw new Error(describeMicError(err));
    }

    const track = this.stream.getAudioTracks()[0];
    if (!track) {
      await this.teardown();
      throw new Error('The selected microphone provided no audio track.');
    }
    // Idle until a recording actually starts: keeps the device allocated but
    // stops it delivering audio.
    track.enabled = false;

    this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => undefined);
    }

    await this.context.audioWorklet.addModule('/worklets/pcm-capture.js');

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkFrames: CHUNK_FRAMES },
    });

    this.node.port.onmessage = (event: MessageEvent) => {
      // Drop anything that arrives while idle — a stray frame would otherwise be
      // fed to the model before the user has said anything.
      if (!this.running) return;

      const data = event.data as { type: string; samples?: Float32Array; level?: number };
      if (data.type === 'level' && typeof data.level === 'number') {
        this.handlers.onLevel?.(data.level);
      } else if (data.type === 'samples' && data.samples) {
        this.handlers.onSamples?.(data.samples);
      }
    };

    this.source.connect(this.node);

    // The worklet must be connected to something for the graph to run, but the
    // microphone must not be audible. A zero-gain node is the standard fix.
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.node.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);

    this.preparedDeviceId = deviceId;
  }

  /**
   * Begin recording. Assumes `prepare()` has run; falls back to building the
   * pipeline if it has not (first press after launch).
   *
   * Everything here is a flag flip, which is the point.
   */
  async start(deviceId: string | null): Promise<void> {
    if (!this.isPrepared || this.preparedDeviceId !== deviceId) {
      await this.prepare(deviceId);
    }
    if (!this.context || !this.stream) throw new Error('Microphone is not available.');

    for (const track of this.stream.getAudioTracks()) track.enabled = true;

    // A context can be auto-suspended by the browser after long idle periods.
    if (this.context.state === 'suspended') {
      await this.context.resume().catch(() => undefined);
    }

    this.running = true;
    this.node?.port.postMessage({ type: 'active', value: true });
  }

  /**
   * Stop recording but keep the device allocated, so the next press is instant.
   * Use `dispose()` to actually release the microphone.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.node?.port.postMessage({ type: 'active', value: false });

    // Disabling the track stops audio flowing without giving up the device.
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = false;
    }
  }

  /** Release the microphone entirely, e.g. on device change or unmount. */
  async dispose(): Promise<void> {
    this.running = false;
    await this.teardown();
    this.preparedDeviceId = undefined;
  }

  private async teardown(): Promise<void> {
    try {
      this.node?.port.postMessage({ type: 'active', value: false });
      this.node?.port.close();
      this.node?.disconnect();
      this.source?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      /* graph may already be torn down */
    }

    this.node = null;
    this.source = null;
    this.silentGain = null;

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;

    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.preparedDeviceId = undefined;
  }

  /** Enumerate inputs. Labels are only populated once permission is granted. */
  static async listDevices(): Promise<Array<{ deviceId: string; label: string; kind: string }>> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
          kind: d.kind,
        }));
    } catch {
      return [];
    }
  }
}

/** Turn the DOM's opaque mic failures into something a user can act on. */
function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was denied. Allow it in Windows Settings → Privacy → Microphone, then try again.';
    case 'NotFoundError':
      return 'No microphone was found. Plug one in and try again.';
    case 'NotReadableError':
      return 'The microphone is in use by another app. Close it and try again.';
    case 'OverconstrainedError':
      return 'The selected microphone is unavailable. Pick a different one in Settings.';
    default:
      return err instanceof Error ? err.message : 'Could not open the microphone.';
  }
}
