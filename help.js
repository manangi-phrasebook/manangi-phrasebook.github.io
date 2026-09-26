// Contributor page: walks through prompts nobody has recorded yet, so 30 people cover 30 different
// phrases instead of all saying "hello". Each save goes to Supabase with the prompt id (and the optional,
// private speaker name, which a voice model later needs to tell speakers apart).

import { openPrompts } from './match.js';
import { consentField } from './consent.js';
import { canRecord, startTake } from './recorder.js';
import { fetchSubmissions, uploadSubmission } from './supabase.js';

const $ = (id) => document.getElementById(id);
const SPEAKER_KEY = 'manangi-speaker';
const player = new Audio();

let queue = [];
let skipped = new Set(); // this visit only: skipping is "not now", not "never"
let take = null;
let pending = null;
let consent = null;

// same light/dark choice as the phrasebook page
try { document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'dark'); } catch { /* default dark */ }

const say = (msg, isError = false) => {
  $('take-msg').textContent = msg;
  $('take-msg').style.color = isError ? 'var(--rec)' : '';
};

function storedSpeaker() {
  try { return localStorage.getItem(SPEAKER_KEY) || ''; } catch { return ''; }
}
function rememberSpeaker(name) {
  try { localStorage.setItem(SPEAKER_KEY, name); } catch { /* typed again next visit */ }
}

const remaining = () => queue.filter((p) => !skipped.has(p.pid));

function showCurrent() {
  const [prompt] = remaining();
  const left = remaining().length;
  $('progress').textContent = left
    ? `${left} phrases still need a voice · ${left} वाक्य बाँकी`
    : '';
  $('prompt-card').classList.toggle('hidden', !prompt);
  $('done-card').classList.toggle('hidden', Boolean(prompt));
  if (!prompt) return;
  $('prompt-english').textContent = prompt.english || prompt.nepali;
  $('prompt-nepali').textContent = prompt.english ? prompt.nepali : '';
  setReviewing(false);
  say('');
}

function setReviewing(on) {
  $('take-review').classList.toggle('hidden', !on);
  $('take-btn').classList.toggle('hidden', on);
  $('help-consent-slot').replaceChildren();
  if (on) {
    consent = consentField('en');
    $('help-consent-slot').append(consent.element);
  }
}

async function record() {
  if (take) return take.stop();
  try {
    take = await startTake();
  } catch {
    return say('Microphone access was blocked. · माइक्रोफोन अनुमति रोकिएको छ।', true);
  }
  $('take-btn').classList.add('recording');
  $('take-btn').textContent = '⏹ Stop · रोक्नुहोस्';
  say('Recording… say it once, then Stop.');
  pending = await take.done;
  take = null;
  $('take-btn').classList.remove('recording');
  $('take-btn').textContent = '🎙 Record · रेकर्ड';
  if (!pending) return;
  setReviewing(true);
  player.src = URL.createObjectURL(pending);
  player.play().catch(() => {});
  say('▶ Playing it back. Save, or record again.');
}

async function save() {
  const prompt = remaining()[0];
  if (!pending || !prompt) return;
  if (!consent.accepted()) return say('Please tick the box to agree before saving. · सेभ गर्नुअघि टिक लगाउनुहोस्।', true);
  const speaker = $('speaker').value.trim();
  rememberSpeaker(speaker);
  $('take-save').disabled = true;
  say('Saving…');
  try {
    await uploadSubmission({
      phrase: prompt.english || prompt.nepali, lang: prompt.english ? 'en' : 'ne',
      blob: pending, promptId: prompt.pid, speaker,
    });
    queue = queue.filter((p) => p.pid !== prompt.pid);
    pending = null;
    showCurrent();
    say('Saved — thank you! Next one: · सेभ भयो — धन्यवाद! अर्को:');
  } catch (err) {
    say(`Not saved: ${err.message}`, true);
  } finally {
    $('take-save').disabled = false;
  }
}

$('take-btn').onclick = record;
$('take-save').onclick = save;
$('take-again').onclick = () => { pending = null; setReviewing(false); record(); };
$('skip-btn').onclick = () => {
  take?.discard();
  pending = null;
  const [prompt] = remaining();
  if (prompt) skipped.add(prompt.pid);
  showCurrent();
};

async function load() {
  try {
    const res = await fetch('phrases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.recorder) {
      $('progress').textContent = '';
      return $('local-card').classList.remove('hidden');
    }
    if (!canRecord()) {
      $('progress').textContent = 'This browser cannot record audio. Try Chrome or Safari on a phone.';
      return;
    }
    queue = openPrompts(data.prompts || [], await fetchSubmissions(), data.phrases);
    $('speaker').value = storedSpeaker();
    showCurrent();
  } catch (err) {
    $('progress').textContent = `Could not load: ${err.message}`;
  }
}

load();
