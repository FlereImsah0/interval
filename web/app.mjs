import { Workout, durationParts, limitIntervalSeconds, roundOverageSeconds, secondsFromDuration, warningAt } from './timer.mjs';
import { VoicePlayer } from './voice.mjs';

const byId = (id) => document.getElementById(id);
const setup = byId('setup');
const preferences = byId('preferences');
const settings = byId('settings');
const workout = byId('workout');
const pause = byId('pause');
const stop = byId('stop');
const favoritePicker = byId('favorite-picker');
const favoriteList = byId('favorite-list');
const favoriteToggle = byId('favorite-toggle');
const settingsButton = byId('settings-button');
const backButton = byId('back-button');
const endPaused = byId('end-paused');
const screens = { setup, settings, workout };
const headings = { setup: byId('setup-title'), settings: byId('settings-title'), workout: byId('phase') };
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
const touchPatterns = { action: 8, navigation: 14, confirmation: [9, 24, 12] };
const tones = new Set();
const intervalKinds = ['active', 'rest'];
const durationUnits = ['Hours', 'Minutes', 'Seconds'];
const durationNames = intervalKinds.flatMap((kind) => durationUnits.map((unit) => kind + unit));
const workoutNames = [...durationNames, 'rounds', 'unlimited', 'mode'];
const storageKey = 'interval-timer-v1';
const cues = {
  ready: { frequency: 300, seconds: 0.25, vibration: 95 },
  active: { frequency: 294, seconds: 0.56, vibration: [130, 75, 130, 75, 130] },
  rest: { frequency: 196, seconds: 0.73, vibration: 850 },
  complete: { frequency: 220, seconds: 0.9, vibration: 950 },
  warning: { frequency: 260, seconds: 0.18, vibration: 95 },
};
const canVibrate = typeof navigator.vibrate === 'function';
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
let selectedFavorite = null;
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

const preferenceNames = [...new Set([...preferences.elements].map((field) => field.name).filter(Boolean))];
const pref = (name) => preferences.elements.namedItem(name);
const field = (name) => setup.elements.namedItem(name);
const audioMode = () => pref('audioMode').value;
const audioVolume = () => Number(pref('volume').value) / 100;
const voicePlayer = new VoicePlayer(() => audio, audioVolume);

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      setup: values(setup, workoutNames), preferences: savedPreferences, favorites, cueDefaults: 2,
    }));
    return true;
  } catch {
    return false;
  }
}

function intervalSeconds(kind, config) {
  return secondsFromDuration(...durationUnits.map((unit) => {
    const name = kind + unit;
    return config ? config[name] : field(name).value;
  }));
}

function durationEntries(kind, seconds) {
  const parts = durationParts(seconds);
  return Object.fromEntries(durationUnits.map((unit, index) => [
    kind + unit, String(parts[index]).padStart(2, '0'),
  ]));
}

function normalizeSavedDurations(config) {
  if (!config) return;
  const active = limitIntervalSeconds(intervalSeconds('active', config));
  const rest = limitIntervalSeconds(intervalSeconds('rest', config));
  Object.assign(config, durationEntries('active', active), durationEntries('rest', rest));
}

function setIntervalDuration(kind, seconds) {
  apply(setup, durationEntries(kind, limitIntervalSeconds(seconds)));
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    normalizeSavedDurations(saved?.setup);
    apply(setup, saved?.setup);
    const storedPreferences = saved?.preferences;
    if (saved?.cueDefaults !== 2 && storedPreferences?.volume === '65' &&
        storedPreferences.vibration === false && storedPreferences.pattern === 'activity') {
      storedPreferences.volume = '100';
      storedPreferences.vibration = true;
    }
    if (storedPreferences && !storedPreferences.audioMode) {
      storedPreferences.audioMode = storedPreferences.voice ? 'voice'
        : storedPreferences.sound === false ? 'silent' : 'sound';
    }
    apply(preferences, storedPreferences);
    if (Array.isArray(saved?.favorites)) {
      favorites = saved.favorites;
      for (const favorite of favorites) {
        normalizeSavedDurations(favorite.config);
        favorite.label = favoriteLabel(favorite.config);
      }
    }
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
  byId('volume-setting').hidden = audioMode() === 'silent';
  byId('voice-preview').hidden = audioMode() !== 'voice';
  byId('custom-voice').hidden = field('mode').value !== 'custom' || audioMode() !== 'voice';
  byId('vibration-setting').hidden = !canVibrate;
  byId('touch-setting').hidden = !canVibrate;
  byId('vibration-pattern').hidden = !canVibrate || !pref('vibration').checked;
  byId('wake-setting').hidden = !canWake;
}

function planFromSetup() {
  return {
    active: intervalSeconds('active') * 1000,
    rest: intervalSeconds('rest') * 1000,
    rounds: field('unlimited').checked ? Infinity : Number(field('rounds').value),
    prep: Number(pref('prep').value) * 1000,
  };
}

function updateSummary() {
  const { active, rest, rounds, prep } = planFromSetup();
  const summary = byId('workout-summary');
  const overage = roundOverageSeconds(active / 1000, rest / 1000);
  setText(byId('round-limit'), overage
    ? 'Shorten active time or rest by ' + formatTime(overage) + ' to stay within 24 hours per round.'
    : '');
  if (overage) {
    summary.textContent = 'Round exceeds 24 hours';
    return;
  }
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

function formatTime(seconds, showHours = seconds >= 3600) {
  const parts = durationParts(seconds);
  return (showHours ? parts : parts.slice(1)).map((part) => String(part).padStart(2, '0')).join(':');
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
    return showError(setup, error, field(invalidTime), 'Enter up to two digits in each time field.');
  }
  const { active, rest } = planFromSetup();
  if (roundOverageSeconds(active / 1000, rest / 1000)) {
    clearError(setup, error);
    updateSummary();
    byId('round-limit').focus();
    return false;
  }
  if (active < 1000) {
    return showError(setup, error, field('activeSeconds'), 'Set an active interval of at least one second.');
  }
  if (!field('rounds').validity.valid) {
    return showError(setup, error, field('rounds'), 'Enter a round count from 1 to 9,999, or select Unlimited.');
  }
  clearError(setup, error);
  return true;
}

function favoriteLabel(config) {
  const label = [...field('mode').options].find((option) => option.value === config.mode)?.text ?? 'General';
  const active = intervalSeconds('active', config);
  const rest = intervalSeconds('rest', config);
  const rounds = config.unlimited ? 'Unlimited' : config.rounds + (Number(config.rounds) === 1 ? ' round' : ' rounds');
  return label + ' · ' + formatTime(active) + ' / ' + formatTime(rest) + ' · ' + rounds;
}

function updateFavorites(index = null) {
  selectedFavorite = index;
  favoritePicker.hidden = favorites.length === 0;
  if (favoritePicker.hidden) favoritePicker.open = false;
  byId('favorite-count').textContent = favorites.length;
  byId('delete-favorite').hidden = index === null;
  favoriteList.replaceChildren(...favorites.map(({ label }, position) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('strong');
    const details = document.createElement('span');
    const [activity, ...summary] = label.split(' · ');
    button.type = 'button';
    button.className = 'favorite-item';
    button.dataset.favorite = position;
    button.setAttribute('aria-pressed', String(position === index));
    title.textContent = activity;
    details.textContent = summary.join(' · ');
    button.append(title, details);
    item.append(button);
    return item;
  }));
}

byId('save-favorite').addEventListener('click', () => {
  if (!checkSetup()) return;
  const config = values(setup, workoutNames);
  const label = favoriteLabel(config);
  let index = favorites.findIndex((item) => workoutNames.every((name) => item.config[name] === config[name]));
  if (index === -1) index = favorites.push({ label, config }) - 1;
  updateFavorites(index);
  byId('favorite-status').textContent = save() ? 'Workout saved.' : 'Workout saved for this visit only.';
});

favoriteList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-favorite]');
  if (!button) return;
  const index = Number(button.dataset.favorite);
  apply(setup, favorites[index].config);
  updateFavorites(index);
  clearError(setup, byId('setup-error'));
  updateSettings();
  save();
  favoritePicker.open = false;
  favoriteToggle.focus();
  byId('favorite-status').textContent = 'Saved workout loaded.';
});

byId('delete-favorite').addEventListener('click', () => {
  if (selectedFavorite === null) return;
  favorites.splice(selectedFavorite, 1);
  updateFavorites();
  save();
  (favoritePicker.hidden ? byId('save-favorite') : favoriteToggle).focus();
  byId('favorite-status').textContent = 'Saved workout removed.';
});

setup.addEventListener('beforeinput', (event) => {
  if (event.target.dataset.interval && event.data && /[^0-9]/.test(event.data)) event.preventDefault();
});

setup.addEventListener('paste', (event) => {
  if (event.target.dataset.interval && !/^[0-9]{1,2}$/.test(event.clipboardData?.getData('text') ?? '')) {
    event.preventDefault();
  }
});

setup.addEventListener('input', (event) => {
  const input = event.target;
  const kind = input.dataset.interval;
  if (kind) {
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, 2);
    if (input.value.length === 2) setIntervalDuration(kind, intervalSeconds(kind));
  }
  clearResolvedSetupError();
  updateSettings();
  if (selectedFavorite !== null) updateFavorites();
  save();
});

setup.addEventListener('focusout', (event) => {
  const kind = event.target.dataset.interval;
  if (!kind) return;
  setIntervalDuration(kind, intervalSeconds(kind));
  clearResolvedSetupError();
  updateSummary();
  save();
});

setup.addEventListener('click', (event) => {
  const button = event.target.closest('[data-adjust]');
  if (!button) return;
  const { adjust, delta } = button.dataset;
  if (adjust === 'rounds') {
    const rounds = Number(field('rounds').value) || 1;
    field('rounds').value = Math.max(1, Math.min(9999, rounds + Number(delta)));
  } else {
    const minimum = adjust === 'active' ? 1 : 0;
    setIntervalDuration(adjust, Math.max(minimum, intervalSeconds(adjust) + Number(delta)));
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

preferences.addEventListener('change', (event) => {
  if (event.target.name === 'audioMode') silenceFeedback();
  persistPreferences();
});
byId('play-voice').addEventListener('click', () => {
  if (audioMode() !== 'voice') return;
  enableAudio();
  void voicePlayer.play('Get ready');
});
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
  if (!audioType || audioMode() === 'silent') return;
  try {
    audio ??= new audioType();
    audio.resume().catch(() => {});
    if (audioMode() === 'voice') voicePlayer.preload();
  } catch {
    audio = null;
  }
}

function tone(kind) {
  if (screen !== 'workout' || document.hidden || audioMode() !== 'sound' || !audio) return;
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
  const { frequency, seconds } = cues[kind];
  const level = audioVolume() * 0.82;
  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.035);
  gain.gain.setValueAtTime(level, start + seconds * 0.58);
  gain.gain.linearRampToValueAtTime(0, start + seconds);
  oscillator.connect(gain).connect(audio.destination);
  tones.add(oscillator);
  oscillator.addEventListener('ended', () => {
    tones.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
  oscillator.start(start);
  oscillator.stop(start + seconds);
}

function feedback(kind, override = null) {
  if (audioMode() === 'sound') {
    tone(kind);
  } else if (audioMode() === 'voice') {
    const mode = sessionMode;
    const pair = mode === 'custom' ? [pref('goWord').value.trim() || 'Go', pref('restWord').value.trim() || 'Rest'] : words[mode];
    const spoken = override ?? { ready: 'Get ready', active: pair[0], rest: pair[1], complete: 'Workout complete' }[kind];
    const fallback = { active: 'Go', rest: 'Rest', warning: 'Get ready' }[kind] ?? spoken;
    if (spoken) void voicePlayer.play(spoken, fallback);
  }
  if (canVibrate && pref('vibration').checked) {
    const choice = pref('pattern').value;
    const pattern = choice === 'activity' ? cues[kind].vibration
      : { short: 95, double: [100, 75, 100], long: 850 }[choice];
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
  const showHours = state.end - state.start >= 3600 * 1000;
  const remaining = formatTime(Math.ceil(state.remaining / 1000), showHours);
  const countdown = byId('time');
  countdown.classList.toggle('wide', showHours);
  setText(countdown, state.kind === 'complete' ? '' : remaining);
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
  voicePlayer.stop();
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
    silenceFeedback();
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
  if (document.hidden && screen === 'settings') silenceFeedback();
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
