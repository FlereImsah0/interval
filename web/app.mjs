import { Workout, warningAt } from './timer.mjs';

const byId = (id) => document.getElementById(id);
const setup = byId('setup');
const preferences = byId('preferences');
const settings = byId('settings');
const workout = byId('workout');
const pause = byId('pause');
const stop = byId('stop');
const favoritesControl = byId('favorite');
const durationNames = ['activeMinutes', 'activeSeconds', 'restMinutes', 'restSeconds'];
const workoutNames = [...durationNames, 'rounds', 'unlimited', 'mode'];
const storageKey = 'interval-timer-v1';
const canVibrate = typeof navigator.vibrate === 'function';
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const audioType = window.AudioContext ?? window.webkitAudioContext;
const canWake = 'wakeLock' in navigator;
const words = {
  general: ['Go', 'Rest'],
  running: ['Run', 'Walk'],
  swimming: ['Go', 'Rest'],
  stretching: ['Hold', 'Relax'],
  hiit: ['Go', 'Next round after rest'],
};
let favorites = [];
let session = null;
let tick = null;
let lastPhase = null;
let lastElapsed = -1;
let audio = null;
let wake = null;
let wakePending = false;

function values(form, names) {
  return Object.fromEntries(names.map((name) => {
    const field = form.elements.namedItem(name);
    return [name, field.type === 'checkbox' ? field.checked : field.value];
  }));
}

function apply(form, entries) {
  for (const [name, value] of Object.entries(entries ?? {})) {
    const field = form.elements.namedItem(name);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = String(value);
  }
}

const preferenceNames = [...preferences.elements].filter((field) => field.name).map((field) => field.name);
const pref = (name) => preferences.elements.namedItem(name);
const field = (name) => setup.elements.namedItem(name);

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      setup: values(setup, workoutNames), preferences: values(preferences, preferenceNames), favorites,
    }));
    return true;
  } catch {
    return false;
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    apply(setup, saved?.setup);
    apply(preferences, saved?.preferences);
    if (Array.isArray(saved?.favorites)) favorites = saved.favorites;
  } catch {
    // Local storage may be disabled. The timer can still run.
  }
}

function updateSettings() {
  document.documentElement.dataset.theme = pref('theme').value;
  const unlimited = field('unlimited').checked;
  field('rounds').disabled = unlimited;
  setup.querySelectorAll('[data-adjust="rounds"]').forEach((button) => { button.disabled = unlimited; });
  updateSummary();
  const customWarning = pref('warning').value === 'custom';
  byId('custom-warning').hidden = !customWarning;
  pref('warningSeconds').disabled = !customWarning;
  byId('custom-voice').hidden = field('mode').value !== 'custom';
  byId('voice-setting').hidden = !canSpeak;
  byId('vibration-setting').hidden = !canVibrate;
  byId('vibration-pattern').hidden = !canVibrate || !pref('vibration').checked;
  byId('wake-setting').hidden = !canWake;
}

function planFromSetup() {
  return {
    active: (Number(field('activeMinutes').value) * 60 + Number(field('activeSeconds').value)) * 1000,
    rest: (Number(field('restMinutes').value) * 60 + Number(field('restSeconds').value)) * 1000,
    rounds: field('unlimited').checked ? Infinity : Number(field('rounds').value),
    prep: Number(pref('prep').value) * 1000,
  };
}

function updateSummary() {
  const { active, rest, rounds, prep } = planFromSetup();
  const summary = byId('workout-summary');
  if (rounds === Infinity) {
    summary.textContent = 'Unlimited workout';
    return;
  }
  const seconds = (prep + active * rounds + rest * (rounds - 1)) / 1000;
  if (!Number.isFinite(seconds) || active < 1000 || rounds < 1) {
    summary.textContent = '—';
    return;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  const parts = [];
  if (hours) parts.push(hours + ' hr');
  if (minutes) parts.push(minutes + ' min');
  if (remainder || !parts.length) parts.push(remainder + ' sec');
  summary.textContent = parts.join(' ') + ' total';
}

function padDurationFields() {
  for (const name of durationNames) {
    const input = field(name);
    if (input.value && input.validity.valid) input.value = input.value.padStart(2, '0');
  }
}

function formatTime(seconds) {
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function checkSetup() {
  field('activeSeconds').setCustomValidity(planFromSetup().active > 0 ? '' : 'Set an active interval of at least one second.');
  return setup.reportValidity();
}

function updateFavorites(index = '') {
  favoritesControl.replaceChildren(new Option('Favorites', ''));
  favorites.forEach(({ label }, i) => favoritesControl.add(new Option(label, String(i))));
  favoritesControl.value = String(index);
  favoritesControl.hidden = favorites.length === 0;
  byId('delete-favorite').hidden = favoritesControl.value === '';
}

byId('save-favorite').addEventListener('click', () => {
  if (!checkSetup()) return;
  padDurationFields();
  const plan = planFromSetup();
  const config = values(setup, workoutNames);
  const label = field('mode').selectedOptions[0].text + ' · ' +
    formatTime(plan.active / 1000) + ' / ' + formatTime(plan.rest / 1000) +
    (plan.rounds === Infinity ? ' · Unlimited' : ' · ' + plan.rounds + ' rounds');
  let index = favorites.findIndex((item) => JSON.stringify(item.config) === JSON.stringify(config));
  if (index === -1) index = favorites.push({ label, config }) - 1;
  updateFavorites(index);
  byId('favorite-status').textContent = save() ? 'Workout saved.' : 'Workout saved for this visit only.';
});

favoritesControl.addEventListener('change', () => {
  const index = favoritesControl.value;
  if (index !== '') apply(setup, favorites[Number(index)].config);
  updateFavorites(index);
  field('activeSeconds').setCustomValidity('');
  padDurationFields();
  updateSettings();
  save();
});

byId('delete-favorite').addEventListener('click', () => {
  favorites.splice(Number(favoritesControl.value), 1);
  updateFavorites();
  save();
  (favoritesControl.hidden ? byId('save-favorite') : favoritesControl).focus();
  byId('favorite-status').textContent = 'Saved workout removed.';
});

setup.addEventListener('input', (event) => {
  if (event.target === favoritesControl) return;
  field('activeSeconds').setCustomValidity('');
  updateSettings();
  if (favoritesControl.value !== '') updateFavorites();
  save();
});

setup.addEventListener('focusout', (event) => {
  if (durationNames.includes(event.target.name)) {
    padDurationFields();
    save();
  }
});

setup.addEventListener('click', (event) => {
  const button = event.target.closest('[data-adjust]');
  if (!button) return;
  const { adjust, delta } = button.dataset;
  if (adjust === 'rounds') {
    const rounds = Number(field('rounds').value) || 1;
    field('rounds').value = Math.max(1, Math.min(9999, rounds + Number(delta)));
  } else {
    const seconds = planFromSetup()[adjust] / 1000 || 0;
    const minimum = adjust === 'active' ? 1 : 0;
    const next = Math.max(minimum, Math.min(599 * 60 + 59, seconds + Number(delta)));
    field(adjust + 'Minutes').value = String(Math.floor(next / 60)).padStart(2, '0');
    field(adjust + 'Seconds').value = String(next % 60).padStart(2, '0');
  }
  field('activeSeconds').setCustomValidity('');
  updateFavorites();
  updateSummary();
  save();
});

byId('settings-button').addEventListener('click', () => settings.showModal());
preferences.addEventListener('change', () => {
  updateSettings();
  if (preferences.checkValidity()) save();
});
settings.addEventListener('cancel', (event) => {
  if (!preferences.reportValidity()) event.preventDefault();
});

function enableAudio() {
  if (!audioType || !pref('sound').checked) return;
  try {
    audio ??= new audioType();
    audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
}

function tone(kind) {
  if (!pref('sound').checked || !audio) return;
  if (audio.state !== 'running') {
    const current = session;
    const cueTime = performance.now();
    audio.resume().then(() => {
      if (session === current && session?.pausedAt === null && performance.now() - cueTime <= 300 && audio.state === 'running') {
        tone(kind);
      }
    }).catch(() => {});
    return;
  }
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime;
  const calm = field('mode').value === 'stretching';
  const length = kind === 'complete' ? 0.33 : calm ? 0.19 : 0.12;
  oscillator.frequency.value = { ready: 500, active: 880, rest: 440, complete: 660, warning: 590 }[kind];
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(Number(pref('volume').value) * (calm ? .0012 : .0022), start + .015);
  gain.gain.linearRampToValueAtTime(0, start + length);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + length);
}

function feedback(kind, override = null) {
  tone(kind);
  const mode = field('mode').value;
  const pair = mode === 'custom' ? [pref('goWord').value.trim() || 'Go', pref('restWord').value.trim() || 'Rest'] : words[mode];
  const spoken = override ?? { ready: 'Get ready', active: pair[0], rest: pair[1], complete: 'Workout complete' }[kind];
  if (canSpeak && pref('voice').checked && spoken) {
    window.speechSynthesis.cancel();
    const cue = new SpeechSynthesisUtterance(spoken);
    cue.lang = 'en';
    cue.rate = mode === 'stretching' ? 0.85 : 1;
    window.speechSynthesis.speak(cue);
  }
  if (canVibrate && pref('vibration').checked) {
    const choice = pref('pattern').value;
    const patterns = mode === 'swimming'
      ? { active: [100, 65, 100, 65, 100], rest: [480] }
      : { active: [110, 75, 110], rest: [260] };
    const pattern = choice === 'activity' ? (patterns[kind] ?? 95)
      : { short: 95, double: [100, 75, 100], long: 350 }[choice];
    navigator.vibrate(pattern);
  }
}

async function keepAwake() {
  if (!session || session.pausedAt !== null || !canWake || !pref('awake').checked ||
      document.visibilityState !== 'visible' || wakePending || (wake && !wake.released)) return;
  wakePending = true;
  const current = session;
  try {
    const requested = await navigator.wakeLock.request('screen');
    if (session !== current || session.pausedAt !== null) await requested.release();
    else wake = requested;
  } catch {
    // Browsers may deny the wake lock.
  } finally {
    wakePending = false;
    if (session && session !== current) void keepAwake();
  }
}

function releaseAwake() {
  if (!wake) return;
  wake.release().catch(() => {});
  wake = null;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function render() {
  clearTimeout(tick);
  if (!session) return;
  const state = session.snapshot();
  const labels = { ready: 'Get ready', active: 'Active', rest: 'Rest', complete: 'Workout complete' };
  const phaseKey = state.kind + ':' + state.round;
  workout.dataset.phase = state.paused ? 'paused' : state.kind;
  setText(byId('phase'), state.paused ? 'Paused · ' + labels[state.kind] : labels[state.kind]);
  setText(byId('time'), formatTime(Math.ceil(state.remaining / 1000)));
  const rounds = session.plan.rounds;
  const roundLabel = rounds === Infinity ? 'Round ' + state.round : 'Round ' + state.round + ' of ' + rounds;
  setText(byId('round-info'), state.kind === 'complete' ? state.round + ' rounds complete' : roundLabel);
  const completion = state.kind === 'complete' ? 1 : (state.elapsed - state.start) / (state.end - state.start);
  byId('progress').value = completion;
  byId('dial').style.setProperty('--sweep', completion * 360 + 'deg');
  setText(pause, state.kind === 'complete' ? 'Repeat' : state.paused ? 'Resume' : 'Pause');
  setText(stop, state.kind === 'complete' ? 'Done' : 'Stop');
  if (!state.paused && document.visibilityState === 'visible') {
    if (phaseKey !== lastPhase && state.elapsed - state.start <= 300) {
      if (state.kind !== 'complete' || pref('finish').checked) feedback(state.kind);
    } else if (phaseKey === lastPhase) {
      const setting = pref('warning').value;
      const edge = warningAt(state, setting === 'custom' ? pref('warningSeconds').value : setting, lastElapsed);
      if (edge) feedback('warning', edge.spoken ?? edge.seconds + ' seconds');
    }
  }
  lastPhase = phaseKey;
  lastElapsed = state.elapsed;
  if (state.kind === 'complete') {
    releaseAwake();
  } else if (!state.paused) {
    const untilDigit = state.remaining % 1000 || 1000;
    tick = setTimeout(render, Math.max(10, Math.min(100, untilDigit, state.remaining)));
  }
}

function start() {
  enableAudio();
  session = new Workout(planFromSetup());
  lastPhase = null;
  lastElapsed = -1;
  setup.hidden = true;
  byId('settings-button').hidden = true;
  workout.hidden = false;
  render();
  pause.focus();
  void keepAwake();
}

setup.addEventListener('submit', (event) => {
  event.preventDefault();
  if (checkSetup()) {
    padDurationFields();
    save();
    start();
  }
});
pause.addEventListener('click', () => {
  if (session.snapshot().kind === 'complete') {
    start();
    return;
  }
  if (session.pausedAt === null) {
    session.pause();
    releaseAwake();
    if (canSpeak) window.speechSynthesis.cancel();
    if (canVibrate) navigator.vibrate(0);
  } else {
    enableAudio();
    session.resume();
    void keepAwake();
  }
  render();
});
stop.addEventListener('click', () => {
  session = null;
  clearTimeout(tick);
  releaseAwake();
  if (canSpeak) window.speechSynthesis.cancel();
  if (canVibrate) navigator.vibrate(0);
  workout.hidden = true;
  setup.hidden = false;
  byId('settings-button').hidden = false;
  setup.querySelector('button[type="submit"]').focus();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) {
    render();
    if (session.snapshot().kind !== 'complete') void keepAwake();
  }
});

load();
padDurationFields();
updateFavorites();
updateSettings();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
