const recordings = {
  'Get ready': 'ready', Go: 'go', Rest: 'rest', Run: 'run', Walk: 'walk',
  Hold: 'hold', Relax: 'relax', 'Workout complete': 'complete', 'Next round after rest': 'next',
  '1': 'one', '2': 'two', '3': 'three', '3 seconds': 'three-seconds', '5 seconds': 'five-seconds',
};

export class VoicePlayer {
  constructor(context, volume) {
    this.context = context;
    this.volume = volume;
    this.buffers = new Map();
    this.request = 0;
    this.expires = Infinity;
    this.source = null;
    this.speech = globalThis.speechSynthesis;
  }

  buffer(file) {
    if (!this.buffers.has(file)) {
      const context = this.context();
      const request = fetch(new URL('./voice/' + file + '.wav', import.meta.url))
        .then((response) => {
          if (!response.ok) throw new Error('Voice clip unavailable.');
          return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data));
      this.buffers.set(file, request);
      request.catch(() => this.buffers.delete(file));
    }
    return this.buffers.get(file);
  }

  preload() {
    if (!this.context()) return;
    for (const file of Object.values(recordings)) this.buffer(file).catch(() => {});
  }

  stop() {
    this.request += 1;
    this.source?.stop();
    this.source = null;
    this.speech?.cancel();
  }

  isCurrent(request) {
    return request === this.request && performance.now() < this.expires;
  }

  async playRecording(file, request) {
    const context = this.context();
    if (!file || !context) return false;
    try {
      const buffer = await this.buffer(file);
      if (!this.isCurrent(request)) return true;
      if (context.state !== 'running') await context.resume();
      if (!this.isCurrent(request)) return true;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = this.volume();
      source.connect(gain).connect(context.destination);
      source.addEventListener('ended', () => {
        if (this.source === source) this.source = null;
        source.disconnect();
        gain.disconnect();
      }, { once: true });
      source.start();
      this.source = source;
      return true;
    } catch {
      return false;
    }
  }

  systemSpeak(text, request, fallback) {
    if (!this.isCurrent(request) || !this.speech || !globalThis.SpeechSynthesisUtterance) return false;
    const english = this.speech.getVoices().filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
    const voice = english.find((candidate) => candidate.localService) ?? english[0];
    if (!voice) return false;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.volume = this.volume();
    utterance.addEventListener('error', () => {
      if (this.isCurrent(request)) fallback?.();
    }, { once: true });
    this.speech.speak(utterance);
    return true;
  }

  async play(text, fallback = text, validFor = Infinity) {
    this.stop();
    const request = this.request;
    this.expires = performance.now() + validFor;
    const clip = Object.hasOwn(recordings, text) ? recordings[text] : null;
    if (clip) {
      if (!await this.playRecording(clip, request)) this.systemSpeak(text, request);
      return;
    }
    const playFallback = () => this.playRecording(recordings[fallback], request);
    if (!this.systemSpeak(text, request, playFallback)) await playFallback();
  }
}
