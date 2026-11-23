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
const headerNav = backButton.closest('nav');
const endFromSetup = byId('end-from-setup');
const secondaryScreens = ['welcome', 'terms', 'privacy'];
const screens = { setup, settings, workout, ...Object.fromEntries(secondaryScreens.map((name) => [name, byId(name)])) };
const headings = { setup: byId('setup-title'), settings: byId('settings-title'), workout: byId('phase'),
  ...Object.fromEntries(secondaryScreens.map((name) => [name, byId(name + '-title')])) };
const welcomeKey = 'interval-timer-welcome-seen';
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
const touchPatterns = { action: 8, navigation: 14, confirmation: [9, 24, 12] };
const android = window.IntervalAndroid;
const androidMessage = (action, details = {}) => android?.postMessage(JSON.stringify({ action, ...details }));
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
const canVibrate = Boolean(android) || typeof navigator.vibrate === 'function';
const audioType = window.AudioContext ?? window.webkitAudioContext;
const canWake = Boolean(android) || 'wakeLock' in navigator;
let favorites = [];
let selectedFavorite = null;
let session = null;
let tick = null;
let lastPhase = null;
let lastElapsed = -1;
let audio = null;
let wake = null;
let wakePending = false;
let screen = null;
let returning = false;
let setupScroll = 0;
let sessionMode = 'general';
let activeTouch = null;
let savedPreferences;
let nativeId = null;
let ignoredNativeId = null;
let nativeStarting = false;
let nativeAwake = false;

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
const audioMode = () => pref('audioMode').value === 'voice' ? 'voice' : 'sound';
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
    if (storedPreferences && !['sound', 'voice', 'silent'].includes(storedPreferences.audioMode)) {
      storedPreferences.audioMode = storedPreferences.voice ? 'voice'
        : storedPreferences.sound === false ? 'silent' : 'sound';
    }
    if (storedPreferences?.audioMode === 'silent') {
      storedPreferences.audioMode = 'sound';
      storedPreferences.volume = '0';
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

function applyTheme() {
  const theme = pref('theme').value;
  document.documentElement.dataset.theme = theme;
  const dark = screen === 'welcome' || theme === 'dark' || (theme === 'auto' && themeQuery.matches);
  androidMessage('theme', { dark });
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.content = dark ? '#0c1018' : '#f3f5f3';
  });
}

function updateSettings() {
  applyTheme();
  const unlimited = field('unlimited').checked;
  field('rounds').disabled = unlimited;
  setup.querySelectorAll('[data-adjust="rounds"]').forEach((button) => { button.disabled = unlimited; });
  updateSummary();
  const voice = audioMode() === 'voice';
  const customWarning = !voice && pref('warning').value === 'custom';
  byId('sound-warning').hidden = voice;
  byId('custom-warning').hidden = !customWarning;
  pref('warningSeconds').disabled = !customWarning;
  setText(byId('audio-description'), voice ? 'Spoken 3–2–1 countdown.' : 'Tones at interval changes.');
  byId('voice-preview').hidden = !voice || workoutIsRunning();
  byId('custom-voice').hidden = field('mode').value !== 'custom' || !voice;
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
  if (event.target.name === 'audioMode') {
    silenceFeedback();
    if (workoutIsRunning()) enableAudio();
  }
  if (event.target.name === 'awake') {
    if (pref('awake').checked) void keepAwake();
    else releaseAwake();
  }
  persistPreferences();
});
byId('play-voice').addEventListener('click', () => {
  if (audioMode() !== 'voice' || workoutIsRunning()) return;
  enableAudio();
  void voicePlayer.play('3');
});
preferences.addEventListener('input', () => {
  const invalid = preferences.querySelector('[aria-invalid="true"]');
  if (!invalid || invalid.validity.valid) clearError(preferences, byId('settings-error'));
});
preferences.addEventListener('submit', (event) => {
  event.preventDefault();
  const invalid = [...preferences.elements].find((input) => input.willValidate && !input.validity.valid);
  if (invalid) {
    byId('advanced-settings').open = true;
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
  vibrate(touchPatterns[button.dataset.touch ?? 'action']);
});
document.addEventListener('pointerup', (event) => {
  if (activeTouch === event.pointerId) activeTouch = null;
});
document.addEventListener('pointercancel', (event) => {
  if (activeTouch !== event.pointerId) return;
  activeTouch = null;
  vibrate(0);
});

function vibrate(pattern) {
  if (android) androidMessage('touch', { pattern });
  else if (canVibrate) navigator.vibrate(pattern);
}

function enableAudio() {
  if (!audioType || !audioVolume()) return;
  try {
    audio ??= new audioType();
    audio.resume().catch(() => {});
    if (audioMode() === 'voice') voicePlayer.preload();
  } catch {
    audio = null;
  }
}

function tone(kind) {
  if (!session || session.pausedAt !== null || audioMode() !== 'sound' || !audio) return;
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

function feedback(kind, duration = 0) {
  if (audioVolume()) {
    if (audioMode() === 'sound') tone(kind);
    else if (kind === 'complete') void voicePlayer.play('Workout complete', undefined, 1000);
    else if (sessionMode === 'custom' && duration > 3000 && (kind === 'active' || kind === 'rest')) {
      const fallback = kind === 'active' ? 'Go' : 'Rest';
      const command = pref(kind === 'active' ? 'goWord' : 'restWord').value.trim();
      void voicePlayer.play(command || fallback, fallback, 1000);
    }
  }
  if (canVibrate && pref('vibration').checked) {
    const choice = pref('pattern').value;
    const pattern = choice === 'activity' ? cues[kind].vibration
      : { short: 95, double: [100, 75, 100], long: 850 }[choice];
    navigator.vibrate(pattern);
  }
}

async function keepAwake() {
  if (android) {
    const enabled = workoutIsRunning() && !document.hidden && pref('awake').checked;
    if (nativeAwake !== enabled) androidMessage('screenAwake', { enabled });
    nativeAwake = enabled;
    return;
  }
  if (!workoutIsRunning() || !canWake || !pref('awake').checked ||
      document.visibilityState !== 'visible' || wakePending || (wake && !wake.released)) return;
  wakePending = true;
  const current = session;
  try {
    const requested = await navigator.wakeLock.request('screen');
    if (session !== current || document.hidden || !pref('awake').checked || !workoutIsRunning()) await requested.release();
    else wake = requested;
  } catch {
    // Browsers may deny the wake lock.
  } finally {
    wakePending = false;
    if (session && session !== current) void keepAwake();
  }
}

function releaseAwake() {
  if (nativeAwake) {
    androidMessage('screenAwake', { enabled: false });
    nativeAwake = false;
  }
  if (!wake) return;
  wake.release().catch(() => {});
  wake = null;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function renderWorkout(state) {
  const labels = { ready: 'Get ready', active: 'Active', rest: 'Rest', complete: 'Workout complete' };
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
}

function render() {
  clearTimeout(tick);
  if (!session) return;
  const state = session.snapshot();
  if (screen === 'workout' && !document.hidden) renderWorkout(state);
  if (screen === 'setup') updateHomeAction(state);
  const phaseKey = state.kind + ':' + state.round;
  const maxLateness = document.hidden ? 950 : 300;
  if (!android && !state.paused) {
    const entered = phaseKey !== lastPhase;
    if (entered && state.elapsed - state.start <= maxLateness && (state.kind !== 'complete' || pref('finish').checked)) {
      feedback(state.kind, state.end - state.start);
    }
    if (audioMode() === 'voice') {
      const edge = warningAt(state, 'countdown', entered ? state.start - 1 : lastElapsed, maxLateness);
      if (edge && audioVolume()) {
        const cueRemaining = state.end - state.elapsed - (edge.seconds - 1) * 1000;
        void voicePlayer.play(edge.spoken, undefined, cueRemaining);
      }
    } else if (!entered) {
      const setting = pref('warning').value;
      if (warningAt(state, setting === 'custom' ? pref('warningSeconds').value : setting, lastElapsed, maxLateness)) {
        feedback('warning');
      }
    }
  }
  lastPhase = phaseKey;
  lastElapsed = state.elapsed;
  if (state.kind === 'complete') {
    releaseAwake();
    if (screen === 'settings') updateSettings();
  } else if (!state.paused) {
    const untilDigit = state.remaining % 1000 || 1000;
    const refreshInterval = document.hidden || screen !== 'workout' ? 1000 : 100;
    tick = setTimeout(render, Math.max(10, Math.min(refreshInterval, untilDigit, state.remaining)));
  }
}

function silenceFeedback() {
  for (const oscillator of tones) oscillator.stop();
  tones.clear();
  if (audio?.state === 'running') audio.suspend().catch(() => {});
  voicePlayer.stop();
  if (!android && canVibrate) navigator.vibrate(0);
}

function pauseSession() {
  if (android) {
    androidMessage('pause');
    return;
  }
  session.pause();
  clearTimeout(tick);
  releaseAwake();
  silenceFeedback();
}

function resumeSession() {
  if (android) {
    androidMessage('resume');
    return;
  }
  enableAudio();
  session.resume();
  void keepAwake();
}

function workoutIsRunning() {
  const state = session?.snapshot();
  return Boolean(state && !state.paused && state.kind !== 'complete');
}

function updateHomeAction(state = session?.snapshot()) {
  const inProgress = state && state.kind !== 'complete';
  const label = !inProgress ? 'Start workout' : state.paused ? 'Resume workout' : 'Return to workout';
  setText(byId('start-label'), label);
  endFromSetup.hidden = !inProgress;
}

function refreshHeader() {
  document.querySelector('.heading').classList.toggle('scrolled', scrollY > 0);
}

function standaloneWelcome() {
  return screen === 'welcome' && history.state?.welcomeFromSettings !== true;
}

function showScreen(next) {
  if (screen === next) return;
  const previous = screen;
  if (previous === 'setup') setupScroll = scrollY;
  if (previous === 'welcome') {
    try { localStorage.setItem(welcomeKey, '1'); } catch { /* Storage is optional. */ }
  }
  if (previous === 'settings') {
    if (!workoutIsRunning()) silenceFeedback();
    if (preferences.checkValidity()) persistPreferences();
    else apply(preferences, savedPreferences);
    clearError(preferences, byId('settings-error'));
    updateSettings();
  }

  screen = next;
  document.documentElement.dataset.screen = next;
  applyTheme();
  for (const [name, element] of Object.entries(screens)) element.hidden = name !== next;
  headerNav.hidden = standaloneWelcome();
  settingsButton.hidden = next !== 'setup';
  backButton.disabled = next === 'setup';
  if (next === 'setup') updateHomeAction();
  if (next === 'settings') updateSettings();
  if (session) render();
  scrollTo(0, next === 'setup' ? setupScroll : 0);
  refreshHeader();
  const target = next === 'setup'
    ? (previous === 'settings' ? settingsButton : setup.querySelector('.start')) : headings[next];
  if (previous || next !== 'setup') target.focus({ preventScroll: true });
}

function openScreen(next) {
  if (returning || screen === next) return;
  const depth = (history.state?.intervalDepth ?? 0) + 1;
  history.pushState({ intervalScreen: next, intervalDepth: depth,
    welcomeFromSettings: next === 'welcome' && screen === 'settings' }, '', '#' + next);
  showScreen(next);
}

function goBack() {
  if (screen === 'setup' || returning) return;
  returning = true;
  history.back();
}

function goHome() {
  if (returning) return;
  if (standaloneWelcome()) {
    history.replaceState({ intervalScreen: 'setup', intervalDepth: 0 }, '', location.pathname + location.search);
    showScreen('setup');
    return;
  }
  if (screen === 'setup') {
    scrollTo(0, 0);
    headings.setup.focus({ preventScroll: true });
    return;
  }
  returning = true;
  history.go(-(history.state?.intervalDepth || 1));
}

settingsButton.addEventListener('click', () => openScreen('settings'));
byId('home-button').addEventListener('click', goHome);
byId('welcome-start').addEventListener('click', goHome);
settings.querySelector('.settings-links').addEventListener('click', (event) => {
  const link = event.target.closest('[data-screen]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openScreen(link.dataset.screen);
});
backButton.addEventListener('click', goBack);
window.addEventListener('popstate', (event) => {
  returning = false;
  let next = event.state?.intervalScreen;
  if (next === 'workout' && !session) {
    history.replaceState({ intervalScreen: 'setup', intervalDepth: 0 }, '', location.pathname + location.search);
    next = 'setup';
  }
  showScreen(Object.hasOwn(screens, next) ? next : 'setup');
});
window.addEventListener('scroll', refreshHeader, { passive: true });
themeQuery.addEventListener('change', updateSettings);

function start(plan, mode) {
  if (android) {
    if (nativeStarting) return;
    nativeStarting = true;
    sessionMode = mode;
    ignoredNativeId = nativeId;
    androidMessage('start', {
      active: plan.active / 1000, rest: plan.rest / 1000, prep: plan.prep / 1000,
      rounds: plan.rounds === Infinity ? 0 : plan.rounds,
      mode, voice: audioMode() === 'voice', volume: Number(pref('volume').value),
      vibration: pref('vibration').checked, pattern: pref('pattern').value,
      finish: pref('finish').checked,
      warning: pref('warning').value === 'custom' ? pref('warningSeconds').value : pref('warning').value,
      goWord: mode === 'custom' ? pref('goWord').value.trim() || 'Go' : '',
      restWord: mode === 'custom' ? pref('restWord').value.trim() || 'Rest' : '',
    });
    return;
  }
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
    if (session.pausedAt !== null) resumeSession();
    openScreen('workout');
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
function endSession() {
  if (android) {
    ignoredNativeId = nativeId;
    nativeId = null;
    androidMessage('stop');
  }
  session = null;
  clearTimeout(tick);
  releaseAwake();
  silenceFeedback();
}

stop.addEventListener('click', () => {
  if (returning) return;
  endSession();
  goBack();
});
endFromSetup.addEventListener('click', () => {
  endSession();
  updateHomeAction();
  setup.querySelector('.start').focus();
});

document.addEventListener('visibilitychange', () => {
  if (!session) return;
  if (document.hidden) releaseAwake();
  else if (workoutIsRunning()) {
    if (!android) enableAudio();
    void keepAwake();
  }
  render();
});

load();
updateFavorites();
updateSettings();
savedPreferences = values(preferences, preferenceNames);
history.scrollRestoration = 'manual';
const direct = location.hash.slice(1);
const baseURL = location.pathname + location.search;
const isSecondary = secondaryScreens.includes(direct);
const recognized = direct === 'settings' || isSecondary;
function showStandaloneWelcome() {
  history.replaceState({ intervalScreen: 'welcome', intervalDepth: 0 }, '', '#welcome');
  showScreen('welcome');
}
if (direct === 'welcome' && history.state?.welcomeFromSettings !== true) {
  showStandaloneWelcome();
} else if (recognized && history.state?.intervalScreen === direct && history.state?.intervalDepth > 0) {
  showScreen(direct);
} else {
  history.replaceState({ intervalScreen: 'setup', intervalDepth: 0 }, '', baseURL);
  if (isSecondary) {
    history.pushState({ intervalScreen: 'settings', intervalDepth: 1 }, '', '#settings');
    openScreen(direct);
  } else if (direct === 'settings') {
    openScreen('settings');
  } else if (!direct) {
    let seen = false;
    try { seen = localStorage.getItem(welcomeKey) === '1'; } catch { /* Storage is optional. */ }
    if (!seen) showStandaloneWelcome();
  }
}
if (!screen) showScreen('setup');
if (android) {
  const overlay = byId('android-overlay');
  overlay.closest('label').hidden = false;
  overlay.addEventListener('change', () => androidMessage('overlay', { enabled: overlay.checked }));
  window.intervalAndroidPreferences = (settings) => {
    overlay.checked = settings.overlay;
    try {
      if (settings.active === undefined || localStorage.getItem(storageKey)) return;
      setIntervalDuration('active', settings.active);
      setIntervalDuration('rest', settings.rest);
      apply(setup, { unlimited: settings.rounds === 0, rounds: settings.rounds || 10 });
      apply(preferences, { audioMode: settings.voice ? 'voice' : 'sound', vibration: settings.vibration });
      savedPreferences = values(preferences, preferenceNames);
      save();
      updateSettings();
    } catch { /* Storage is optional. */ }
  };
  window.intervalAndroidStartFailed = () => {
    nativeStarting = false;
    ignoredNativeId = null;
    setText(byId('native-workout-error'), 'Could not start the workout. Try again.');
  };
  window.intervalAndroidState = (snapshot) => {
    if (!snapshot) {
      if (nativeStarting || !session || session.snapshot().kind === 'complete') return;
      session = null;
      nativeId = null;
      clearTimeout(tick);
      releaseAwake();
      if (screen === 'workout') goBack();
      else updateHomeAction();
      return;
    }
    if (snapshot.id === ignoredNativeId) return;
    const newWorkout = nativeId !== snapshot.id;
    nativeId = snapshot.id;
    nativeStarting = false;
    setText(byId('native-workout-error'), '');
    const now = performance.now();
    if (newWorkout) {
      sessionMode = snapshot.mode;
      session = new Workout({
        active: snapshot.active, rest: snapshot.rest, prep: snapshot.prep,
        rounds: snapshot.rounds || Infinity,
      });
    }
    session.origin = now - snapshot.elapsed;
    session.pausedAt = snapshot.paused ? now : null;
    if (newWorkout && screen !== 'workout') openScreen('workout');
    else render();
    void keepAwake();
  };
  androidMessage('ready');
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
}
