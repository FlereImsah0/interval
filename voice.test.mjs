import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { VoicePlayer } from './web/voice.mjs';

test('recorded voice cues can play in a hidden tab without an installed browser voice', async (t) => {
  const played = [];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url.pathname.split('/').pop());
    const data = await readFile(url);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.ok(data.length > 44);
    return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  const oldDocument = globalThis.document;
  globalThis.document = { hidden: true };
  t.after(() => { globalThis.document = oldDocument; });

  const gain = { gain: {}, connect() {} };
  const context = {
    state: 'running',
    decodeAudioData: async (data) => data,
    createGain: () => gain,
    createBufferSource() {
      return {
        connect: () => gain,
        addEventListener() {},
        start() { played.push('start'); },
        stop() { played.push('stop'); },
      };
    },
  };
  const voice = new VoicePlayer(() => context, () => 1);
  voice.speech = undefined;

  await voice.play('Go');
  await voice.play('My custom rest cue', 'Rest');
  assert.deepEqual(requests, ['go.wav', 'rest.wav']);
  assert.deepEqual(played, ['start', 'stop', 'start']);
  assert.equal(gain.gain.value, 1);

  await voice.play('3', undefined, 0);
  assert.deepEqual(played, ['start', 'stop', 'start', 'stop']);
});
