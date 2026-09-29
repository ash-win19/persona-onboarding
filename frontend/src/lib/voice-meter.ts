type Meter = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Uint8Array<ArrayBuffer>;
};

// The call owns this context. Analysers never connect to the destination, so
// they cannot echo the microphone or play the remote stream a second time.
export function createVoiceMeter() {
  let context: AudioContext | null = null;
  let input: Meter | null = null;
  let output: Meter | null = null;
  try {
    context = new AudioContext();
    void context.resume().catch(() => undefined);
  } catch {
    // Metering is optional; voice transport still works without Web Audio.
  }

  function attach(stream: MediaStream): Meter | null {
    if (!context || !stream.getAudioTracks().length) return null;
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      return { source, analyser, samples: new Uint8Array(analyser.fftSize) };
    } catch {
      return null;
    }
  }
  function disconnect(meter: Meter | null) {
    meter?.source.disconnect();
    meter?.analyser.disconnect();
  }
  return {
    input(stream: MediaStream) {
      disconnect(input);
      input = attach(stream);
    },
    output(stream: MediaStream) {
      disconnect(output);
      output = attach(stream);
    },
    level(speaker: "user" | "agent") {
      const meter = speaker === "user" ? input : output;
      if (!meter || context?.state !== "running" || document.hidden) return 0;
      meter.analyser.getByteTimeDomainData(meter.samples);
      let sum = 0;
      for (const sample of meter.samples) sum += ((sample - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / meter.samples.length);
      return rms < 0.015 ? 0 : Math.min(1, rms * 3.1);
    },
    resume() {
      if (context?.state === "suspended")
        void context.resume().catch(() => undefined);
    },
    close() {
      disconnect(input);
      disconnect(output);
      input = output = null;
      if (context && context.state !== "closed")
        void context.close().catch(() => undefined);
      context = null;
    },
  };
}
