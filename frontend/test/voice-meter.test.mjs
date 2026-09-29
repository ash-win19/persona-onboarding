import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createVoiceMeter } from "../src/lib/voice-meter.ts";

const originalAudio = globalThis.AudioContext;
const originalDocument = globalThis.document;
afterEach(() => {
  if (originalAudio) globalThis.AudioContext = originalAudio;
  else delete globalThis.AudioContext;
  if (originalDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
});

test("samples the selected speaker without playback and releases every audio resource", async () => {
  let closed = 0;
  let disconnected = 0;
  let value = 128;
  globalThis.document = { hidden: false };
  globalThis.AudioContext = class {
    state = "running";
    resume() {
      return Promise.resolve();
    }
    close() {
      closed++;
      this.state = "closed";
      return Promise.resolve();
    }
    createMediaStreamSource(stream) {
      value = stream.value;
      return {
        connect(node) {
          assert.equal(typeof node.getByteTimeDomainData, "function");
        },
        disconnect() {
          disconnected++;
        },
      };
    }
    createAnalyser() {
      const sample = value;
      return {
        getByteTimeDomainData(data) {
          data.fill(sample);
        },
        disconnect() {
          disconnected++;
        },
      };
    }
  };
  const meter = createVoiceMeter();
  meter.input({ value: 136, getAudioTracks: () => [{}] });
  meter.output({ value: 152, getAudioTracks: () => [{}] });
  assert.ok(meter.level("agent") > meter.level("user"));
  assert.ok(meter.level("user") > 0);
  globalThis.document.hidden = true;
  assert.equal(meter.level("agent"), 0);
  meter.close();
  meter.close();
  assert.equal(closed, 1);
  assert.equal(disconnected, 4);
  assert.equal(meter.level("user"), 0);
});

test("unavailable metering leaves the call usable with zero levels", () => {
  delete globalThis.AudioContext;
  const meter = createVoiceMeter();
  meter.input({ getAudioTracks: () => [] });
  assert.equal(meter.level("user"), 0);
  meter.resume();
  meter.close();
});
