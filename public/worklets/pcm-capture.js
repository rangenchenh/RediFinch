/**
 * AudioWorklet that forwards mono PCM to the UI thread and reports a level.
 *
 * Runs on the audio rendering thread, so it does as little as possible: copy the
 * input block, compute a cheap RMS for the meter, post both.
 *
 * The graph stays alive between recordings (that is what makes starting one
 * instant), so this processor is explicitly told when a recording begins and
 * ends. The `active` flag is what keeps idle microphone frames out of the
 * transcription pipeline.
 */

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkFrames = opts.chunkFrames || 2048;
    this.buffer = new Float32Array(this.chunkFrames);
    this.fill = 0;

    /** False while idle; gates both the level meter and sample forwarding. */
    this.active = false;

    // Report a level roughly every ~16 blocks so the UI is not flooded.
    this.levelAccumulator = 0;
    this.levelBlocks = 0;
    this.levelInterval = 16;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'active') {
        this.active = !!data.value;
        // Discard any partial chunk from the previous recording, so a new one
        // never starts with stale audio glued to its front.
        this.fill = 0;
        this.levelAccumulator = 0;
        this.levelBlocks = 0;
        if (!this.active) {
          // Also clear the meter immediately rather than leaving it mid-bar.
          this.port.postMessage({ type: 'level', level: 0 });
        }
      }
    };
  }

  process(inputs) {
    const input = inputs[0];

    // Keep the processor alive even while idle: returning false would let the
    // graph tear this node down, and rebuilding it is exactly the cost we are
    // avoiding.
    if (!this.active || !input || input.length === 0) return true;

    const channels = input.length;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      // Sum extra channels rather than dropping them, so a stereo-only device
      // still records at full level.
      let sample = channels === 1 ? input[0][i] : 0;
      if (channels > 1) {
        for (let c = 0; c < channels; c++) sample += input[c][i];
        sample /= channels;
      }

      this.buffer[this.fill++] = sample;
      this.levelAccumulator += sample * sample;

      if (this.fill === this.chunkFrames) {
        const out = new Float32Array(this.buffer);
        this.port.postMessage({ type: 'samples', samples: out }, [out.buffer]);
        this.fill = 0;
      }
    }

    this.levelBlocks++;
    if (this.levelBlocks >= this.levelInterval) {
      const rms = Math.sqrt(this.levelAccumulator / (this.levelBlocks * frames));
      // Square-root compression keeps quiet speech visible on the meter.
      const level = Math.min(1, Math.pow(rms * 5, 0.5));
      this.port.postMessage({ type: 'level', level });
      this.levelAccumulator = 0;
      this.levelBlocks = 0;
    }

    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
