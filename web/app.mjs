import { Workout, warningAt } from './timer.mjs';

const byId = (id) => document.getElementById(id);
const setup = byId('setup');
const preferences = byId('preferences');
const settings = byId('settings');
const workout = byId('workout');
const pause = byId('pause');
const stop = byId('stop');
const favoritesControl = byId('favorite');
const settingsButton = byId('settings-button');
const backButton = byId('back-button');
const endPaused = byId('end-paused');
const screens = { setup, settings, workout };
const headings = { setup: byId('setup-title'), settings: byId('settings-title'), workout: byId('phase') };
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
const touchPatterns = { action: 8, navigation: 14, confirmation: [9, 24, 12] };
const tones = new Set();
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
let screen = 'setup';
let returning = false;
let setupScroll = 0;
let sessionMode = 'general';
let activeTouch = null;
let savedPreferences;

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
      setup: values(setup, workoutNames), preferences: savedPreferences, favorites,
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
  const theme = pref('theme').value;
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && themeQuery.matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.content = dark ? '#111c1a' : '#f3f5f3';
  });
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
  byId('touch-setting').hidden = !canVibrate;
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
  for (const name of ['activeMinutes', 'restMinutes']) {
    const minutes = field(name);
    minutes.closest('.duration').dataset.long = String(minutes.value.length > 2);
  }
  const { active, rest, rounds, prep } = planFromSetup();
  const summary = byId('workout-summary');
  if (rounds === Infinity) {
    summary.textContent = 'Unlimited workout';
    return;
  }
  const seconds = (prep + active * rounds + rest * (rounds - 1)) / 1000;
  if (![...durationNames, 'rounds'].every((name) => field(name).validity.valid) ||
      !Number.isFinite(seconds) || active < 1000 || rounds < 1) {
    summary.textContent = 'Total time unavailable';
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

function clearError(form, error) {
  const previous = form.querySelector('[aria-invalid="true"]');
  previous?.removeAttribute('aria-invalid');
  previous?.removeAttribute('aria-describedby');
  error.hidden = true;
  error.textContent = '';
}

function showError(form, error, input, message) {
  clearError(form, error);
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', error.id);
  input.focus();
  return false;
}

function clearResolvedSetupError() {
  const invalid = setup.querySelector('[aria-invalid="true"]');
  if (invalid?.validity.valid && (invalid.name !== 'activeSeconds' || planFromSetup().active > 0)) {
    clearError(setup, byId('setup-error'));
  }
}

function checkSetup() {
  const error = byId('setup-error');
  const invalidTime = durationNames.find((name) => !field(name).validity.valid);
  if (invalidTime) {
    const message = invalidTime.endsWith('Seconds') ? 'Enter seconds from 0 to 59.' : 'Enter minutes from 0 to 599.';
    return showError(setup, error, field(invalidTime), message);
  }
  if (planFromSetup().active < 1000) {
    return showError(setup, error, field('activeSeconds'), 'Set an active interval of at least one second.');
  }
  if (!field('rounds').validity.valid) {
    return showError(setup, error, field('rounds'), 'Enter a round count from 1 to 9,999, or select Unlimited.');
  }
  clearError(setup, error);
  return true;
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
  clearError(setup, byId('setup-error'));
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
  clearResolvedSetupError();
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
  clearResolvedSetupError();
  updateFavorites();
  updateSummary();
  save();
});

function persistPreferences() {
  updateSettings();
  if (!preferences.checkValidity()) return;
  savedPreferences = values(preferences, preferenceNames);
  save();
}

preferences.addEventListener('change', persistPreferences);
preferences.addEventListener('input', () => {
  const invalid = preferences.querySelector('[aria-invalid="true"]');
  if (!invalid || invalid.validity.valid) clearError(preferences, byId('settings-error'));
});
preferences.addEventListener('submit', (event) => {
  event.preventDefault();
  const invalid = [...preferences.elements].find((input) => input.willValidate && !input.validity.valid);
  if (invalid) {
    invalid.closest('.row').after(byId('settings-error'));
    showError(preferences, byId('settings-error'), invalid, invalid.name === 'prep'
      ? 'Enter preparation time from 0 to 60 seconds.' : 'Enter an advance warning from 1 to 60 seconds.');
    return;
  }
  persistPreferences();
  goBack();
});

document.addEventListener('pointerdown', (event) => {
  const button = event.target.closest('button:not(:disabled)');
  if (!button || event.pointerType !== 'touch' || !event.isPrimary || !canVibrate || !pref('touch').checked) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (button.classList.contains('start') && pref('vibration').checked && !session) return;
  activeTouch = event.pointerId;
  navigator.vibrate(touchPatterns[button.dataset.touch ?? 'action']);
});
document.addEventListener('pointerup', (event) => {
  if (activeTouch === event.pointerId) activeTouch = null;
});
document.addEventListener('pointercancel', (event) => {
  if (activeTouch !== event.pointerId) return;
  activeTouch = null;
  navigator.vibrate(0);
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
  if (screen !== 'workout' || document.hidden || !pref('sound').checked || !audio) return;
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
  const calm = sessionMode === 'stretching';
  const length = kind === 'complete' ? 0.33 : calm ? 0.19 : 0.12;
  oscillator.frequency.value = { ready: 500, active: 880, rest: 440, complete: 660, warning: 590 }[kind];
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(Number(pref('volume').value) * (calm ? .0012 : .0022), start + .015);
  gain.gain.linearRampToValueAtTime(0, start + length);
  oscillator.connect(gain).connect(audio.destination);
  tones.add(oscillator);
  oscillator.addEventListener('ended', () => {
    tones.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
  oscillator.start(start);
  oscillator.stop(start + length);
}

function feedback(kind, override = null) {
  tone(kind);
  const mode = sessionMode;
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
  if (screen !== 'workout' || !session || session.pausedAt !== null || !canWake || !pref('awake').checked ||
      document.visibilityState !== 'visible' || wakePending || (wake && !wake.released)) return;
  wakePending = true;
  const current = session;
  try {
    const requested = await navigator.wakeLock.request('screen');
    if (session !== current || screen !== 'workout' || document.hidden ||
        session.pausedAt !== null || session.snapshot().kind === 'complete') await requested.release();
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

function render(deliverCues = true) {
  clearTimeout(tick);
  if (screen !== 'workout' || !session) return;
  const state = session.snapshot();
  const labels = { ready: 'Get ready', active: 'Active', rest: 'Rest', complete: 'Workout complete' };
  const phaseKey = state.kind + ':' + state.round;
  workout.dataset.phase = state.paused ? 'paused' : state.kind;
  setText(byId('phase'), state.paused ? 'Paused · ' + labels[state.kind] : labels[state.kind]);
  const remaining = formatTime(Math.ceil(state.remaining / 1000));
  setText(byId('time'), state.kind === 'complete' ? '' : remaining);
  byId('time').hidden = state.kind === 'complete';
  const rounds = session.plan.rounds;
  const roundLabel = rounds === Infinity ? 'Round ' + state.round : 'Round ' + state.round + ' of ' + rounds;
  const completedRounds = state.round === 1 ? '1 round complete' : state.round + ' rounds complete';
  setText(byId('round-info'), state.kind === 'complete' ? completedRounds : roundLabel);
  const completion = state.kind === 'complete' ? 1 : (state.elapsed - state.start) / (state.end - state.start);
  byId('progress').value = completion;
  byId('dial').style.setProperty('--sweep', completion * 360 + 'deg');
  setText(pause, state.kind === 'complete' ? 'Repeat' : state.paused ? 'Resume' : 'Pause');
  setText(stop, state.kind === 'complete' ? 'Done' : 'End workout');
  if (deliverCues && !state.paused && !document.hidden) {
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
  } else if (!state.paused && !document.hidden) {
    const untilDigit = state.remaining % 1000 || 1000;
    tick = setTimeout(render, Math.max(10, Math.min(100, untilDigit, state.remaining)));
  }
}

function silenceFeedback() {
  for (const oscillator of tones) oscillator.stop();
  tones.clear();
  if (audio?.state === 'running') audio.suspend().catch(() => {});
  if (canSpeak) window.speechSynthesis.cancel();
  if (canVibrate) navigator.vibrate(0);
}

function pauseSession() {
  session.pause();
  clearTimeout(tick);
  releaseAwake();
  silenceFeedback();
}

function resumeSession() {
  enableAudio();
  session.resume();
  void keepAwake();
}

function updateHomeAction() {
  const parked = session && session.snapshot().kind !== 'complete';
  setText(byId('start-label'), parked ? 'Resume workout' : 'Start workout');
  endPaused.hidden = !parked;
}

function refreshHeader() {
  document.querySelector('.heading').classList.toggle('scrolled', scrollY > 0);
}

function showScreen(next) {
  if (screen === next) return;
  const previous = screen;
  if (previous === 'setup') setupScroll = scrollY;
  if (previous === 'workout' && session) {
    if (session.snapshot().kind === 'complete') silenceFeedback();
    else pauseSession();
  }
  if (previous === 'settings') {
    if (preferences.checkValidity()) persistPreferences();
    else apply(preferences, savedPreferences);
    clearError(preferences, byId('settings-error'));
    updateSettings();
  }

  screen = next;
  for (const [name, element] of Object.entries(screens)) element.hidden = name !== next;
  settingsButton.hidden = next !== 'setup';
  backButton.hidden = next === 'setup';
  if (next === 'setup') updateHomeAction();
  if (next === 'workout') render();
  scrollTo(0, next === 'setup' ? setupScroll : 0);
  refreshHeader();
  const target = next === 'setup'
    ? (previous === 'settings' ? settingsButton : setup.querySelector('.start')) : headings[next];
  target.focus({ preventScroll: true });
}

function openScreen(next) {
  if (returning || screen === next) return;
  const url = next === 'settings' ? '#settings' : '#workout';
  history.pushState({ intervalScreen: next }, '', url);
  showScreen(next);
}

function goBack() {
  if (screen === 'setup' || returning) return;
  returning = true;
  history.back();
}

settingsButton.addEventListener('click', () => openScreen('settings'));
backButton.addEventListener('click', goBack);
window.addEventListener('popstate', (event) => {
  returning = false;
  let next = event.state?.intervalScreen;
  if (next === 'workout' && !session) {
    history.replaceState({ intervalScreen: 'setup' }, '', location.pathname + location.search);
    next = 'setup';
  }
  showScreen(next === 'workout' || next === 'settings' ? next : 'setup');
});
window.addEventListener('scroll', refreshHeader, { passive: true });
themeQuery.addEventListener('change', updateSettings);

function start(plan, mode) {
  enableAudio();
  session = new Workout(plan);
  sessionMode = mode;
  lastPhase = null;
  lastElapsed = -1;
  if (screen === 'workout') render();
  else openScreen('workout');
  void keepAwake();
}

setup.addEventListener('submit', (event) => {
  event.preventDefault();
  if (returning) return;
  if (session && session.snapshot().kind !== 'complete') {
    openScreen('workout');
    resumeSession();
    render();
    return;
  }
  if (!checkSetup()) return;
  padDurationFields();
  save();
  start(planFromSetup(), field('mode').value);
});
pause.addEventListener('click', () => {
  if (!session || returning) return;
  if (session.snapshot().kind === 'complete') {
    start(session.plan, sessionMode);
    return;
  }
  if (session.pausedAt === null) pauseSession();
  else resumeSession();
  render();
});
stop.addEventListener('click', () => {
  if (returning) return;
  session = null;
  clearTimeout(tick);
  releaseAwake();
  silenceFeedback();
  goBack();
});
endPaused.addEventListener('click', () => {
  session = null;
  updateHomeAction();
  setup.querySelector('.start').focus();
});

document.addEventListener('visibilitychange', () => {
  if (!session || screen !== 'workout') return;
  if (document.hidden) {
    clearTimeout(tick);
    releaseAwake();
    silenceFeedback();
    return;
  }
  if (session.pausedAt === null) {
    if (session.snapshot().kind !== 'complete') {
      enableAudio();
      void keepAwake();
    }
    lastPhase = null;
    lastElapsed = session.snapshot().elapsed;
    render(false);
  }
});

load();
padDurationFields();
updateFavorites();
updateSettings();
savedPreferences = values(preferences, preferenceNames);
history.scrollRestoration = 'manual';
const directSettings = location.hash === '#settings';
if (history.state?.intervalScreen === 'settings' && directSettings) {
  showScreen('settings');
} else {
  const baseUrl = location.pathname + location.search;
  history.replaceState({ intervalScreen: 'setup' }, '', baseUrl);
  if (directSettings) openScreen('settings');
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
