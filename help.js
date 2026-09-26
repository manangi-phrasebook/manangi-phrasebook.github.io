// Contributor page: walks through prompts nobody has recorded yet, so 30 people cover 30 different
// phrases instead of all saying "hello". Each save goes to Supabase with the prompt id (and the optional,
// private speaker name, which a voice model later needs to tell speakers apart).
// The whole page reads in one language at a time (toggle at the top); a prompt with no translation in
// the chosen language falls back to whichever it has.

import { openPrompts } from './match.js';
import { consentField } from './consent.js';
import { canRecord, startTake } from './recorder.js';
import { fetchSubmissions, uploadSubmission } from './supabase.js';
import { STRINGS } from './i18n.js';

const $ = (id) => document.getElementById(id);
const SPEAKER_KEY = 'manangi-speaker';
const LANG_KEY = 'manangi-help-lang';
const player = new Audio();

let queue = [];
let skipped = new Set(); // this visit only: skipping is "not now", not "never"
let take = null;
let pending = null;
let consent = null;
let lang = storedLang();

const t = () => STRINGS[lang];

// same light/dark choice as the phrasebook page
try { document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'dark'); } catch { /* default dark */ }

function storedLang() {
  try { return localStorage.getItem(LANG_KEY) === 'ne' ? 'ne' : 'en'; } catch { return 'en'; }
}

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

// The phrase in the chosen language, or whichever it has (many glossary-word prompts are English-only).
const promptText = (p) => (lang === 'ne' ? p.nepali || p.english : p.english || p.nepali);

function applyLangUI() {
  document.documentElement.lang = lang;
  document.querySelectorAll('#lang-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  $('help-title').textContent = t().helpTitle;
  $('back-link').textContent = t().back;
  $('say-label').textContent = t().sayThis;
  $('take-btn').textContent = take ? t().helpStop : t().helpRecord;
  $('take-save').textContent = t().save;
  $('take-again').textContent = t().again;
  $('skip-btn').textContent = t().skipBtn;
  $('speaker-label').firstChild.textContent = t().speakerLabel;
  $('done-msg').textContent = t().done;
  $('local-msg').replaceChildren(
    `${t().localRecorder} `,
    Object.assign(document.createElement('a'), { href: '/?mode=prompts', textContent: t().localRecorderLink }),
    ` ${t().localRecorderSuffix}`,
  );
}

function setLang(next) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* asked again next visit; harmless */ }
  applyLangUI();
  if (!$('prompt-card').classList.contains('hidden')) showCurrent();
}

$('lang-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-lang]');
  if (btn) setLang(btn.dataset.lang);
});

function showCurrent() {
  const [prompt] = remaining();
  const left = remaining().length;
  $('progress').textContent = left ? t().progress(left) : '';
  $('prompt-card').classList.toggle('hidden', !prompt);
  $('done-card').classList.toggle('hidden', Boolean(prompt));
  if (!prompt) return;
  $('prompt-text').textContent = promptText(prompt);
  setReviewing(false);
  say('');
}

function setReviewing(on) {
  $('take-review').classList.toggle('hidden', !on);
  $('take-btn').classList.toggle('hidden', on);
  $('help-consent-slot').replaceChildren();
  if (on) {
    consent = consentField(lang);
    $('help-consent-slot').append(consent.element);
  }
}

async function record() {
  if (take) return take.stop();
  try {
    take = await startTake();
  } catch {
    return say(t().micBlocked, true);
  }
  $('take-btn').classList.add('recording');
  $('take-btn').textContent = t().helpStop;
  say(t().recording);
  pending = await take.done;
  take = null;
  $('take-btn').classList.remove('recording');
  $('take-btn').textContent = t().helpRecord;
  if (!pending) return;
  setReviewing(true);
  player.src = URL.createObjectURL(pending);
  player.play().catch(() => {});
  say(t().playingBack);
}

async function save() {
  const prompt = remaining()[0];
  if (!pending || !prompt) return;
  if (!consent.accepted()) return say(t().consentNeeded, true);
  const speaker = $('speaker').value.trim();
  rememberSpeaker(speaker);
  $('take-save').disabled = true;
  say(t().saving);
  try {
    await uploadSubmission({
      phrase: prompt.english || prompt.nepali, lang: prompt.english ? 'en' : 'ne',
      blob: pending, promptId: prompt.pid, speaker,
    });
    queue = queue.filter((p) => p.pid !== prompt.pid);
    pending = null;
    showCurrent();
    say(t().savedNext);
  } catch (err) {
    say(t().notSaved(err.message), true);
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
  applyLangUI();
  $('progress').textContent = t().loading;
  try {
    const res = await fetch('phrases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.recorder) {
      $('progress').textContent = '';
      return $('local-card').classList.remove('hidden');
    }
    if (!canRecord()) {
      $('progress').textContent = t().cannotRecordBrowser;
      return;
    }
    queue = openPrompts(data.prompts || [], await fetchSubmissions(), data.phrases);
    $('speaker').value = storedSpeaker();
    showCurrent();
  } catch (err) {
    $('progress').textContent = t().couldNotLoad(err.message);
  }
}

load();
