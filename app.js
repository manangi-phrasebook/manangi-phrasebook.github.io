import { hasRecording, lookup, mergeSubmissions } from './match.js';
import { audioUrl, fetchSubmissions } from './supabase.js';
import { detectLang, STRINGS } from './i18n.js';
import { setupContribute } from './contribute.js';
import { setupAdmin } from './admin.js';

const $ = (id) => document.getElementById(id);
const ARCHIVE_CREDIT = 'Archive recording · Manang Languages Project (K. Hildebrandt), CC BY-NC-SA';

let phrases = [];
let basePhrases = []; // the built phrase list, before visitor recordings are merged in
let prompts = [];
let hasRecorder = false; // true when served by the local recorder (python server.py), false on the public site
let matches = [];
let current = 0;
let lastQuery = '';
let lang = 'en'; // language of the last search, detected from what was typed
const t = () => STRINGS[lang];
const player = new Audio();

function setStatus(msg, isError = false) {
  $('status-msg').textContent = msg;
  $('status-msg').className = 'status' + (isError ? ' error' : '');
}

// --- theme (remembered per browser; storage can be blocked, so never depend on it) ---
function storedTheme() {
  try { return localStorage.getItem('theme'); } catch { return null; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('theme-toggle').textContent = theme === 'light' ? '🌙' : '☀️';
}
applyTheme(storedTheme() || 'dark');
$('theme-toggle').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* per-browser nicety only */ }
};

function applyLabels() {
  $('say-label').textContent = t().sayIt;
  $('means-label').textContent = t().means;
  $('listen-btn').textContent = t().listen;
  $('copy-btn').textContent = t().copy;
  $('not-yet').textContent = t().notYet;
  $('closest').textContent = t().closest;
}

// --- lookup + result ---
async function find(query) {
  query = query.trim().replace(/\s+/g, ' ');
  if (!query) return;
  await phrasesReady; // a search typed on a slow connection waits for the list instead of finding nothing
  lang = detectLang(query);
  applyLabels();
  matches = lookup(query, lang, phrases);
  if (!matches.length) {
    $('result-section').classList.add('hidden');
    return setStatus('No phrases loaded yet.', true);
  }
  setStatus('');
  // "not there" means this exact phrase has no recording, even if something similar scores high
  // ("how are you" vs "How old are you?"): offer to record it and still show the closest match
  const isMissing = !hasRecording(phrases, query);
  $('weak-match').classList.toggle('hidden', !isMissing);
  if (isMissing) {
    lastQuery = query;
    resetContribute(query);
  }
  show(0);
}

// the phrase's meaning in the searcher's language (English when no Nepali meaning exists)
const meaningOf = (m) => (lang === 'ne' && m.nepali) || m.english;

function audioNote(m) {
  if (m.source === 'archive') return ARCHIVE_CREDIT;
  if (m.source === 'visitor') return t().visitorRecording;
  if (m.audio) return '';
  return hasRecorder ? `No recording yet — record #${m.clip} in the recorder.` : t().noRecording;
}

function show(i) {
  current = i;
  const m = matches[i];
  $('result-section').classList.remove('hidden');
  // spoken in prompt mode but not written down yet: audio only
  $('say').textContent = m.spelling || t().unwritten;
  $('ipa').textContent = m.text;
  // matching is by similar words, not meaning: always show what the phrase really says
  $('meaning').textContent = meaningOf(m);
  $('listen-btn').disabled = !m.audio;
  $('audio-note').textContent = audioNote(m);
  if (hasRecorder && !m.audio) {
    const link = document.createElement('a');
    link.href = `/?clip=${encodeURIComponent(m.clip)}`;
    link.textContent = ' Open recorder →';
    $('audio-note').appendChild(link);
  }
  renderOthers(i);
}

function renderOthers(shownIndex) {
  $('others').replaceChildren(...matches.flatMap((m, j) => {
    if (j === shownIndex) return [];
    const btn = document.createElement('button');
    const label = document.createElement('span');
    const pct = document.createElement('span');
    label.textContent = `${m.spelling || '🔊'} — ${meaningOf(m)}`;
    pct.className = 'score';
    pct.textContent = `${Math.round(m.score * 100)}%`;
    btn.append(label, pct);
    btn.onclick = () => { show(j); listen(); $('query').value = meaningOf(m); };
    return [btn];
  }));
}

// Called straight from a tap, so iOS allows playback.
function listen() {
  const m = matches[current];
  if (!m?.audio) return;
  player.src = m.audio;
  player.play().catch((err) => setStatus(`Playback failed: ${err.message}`, true));
}

async function copy() {
  const m = matches[current];
  if (!m) return;
  try {
    await navigator.clipboard.writeText([m.spelling, m.text, meaningOf(m)].filter(Boolean).join('\n'));
    setStatus('✓');
    setTimeout(() => setStatus(''), 1200);
  } catch {
    setStatus('Copy failed.', true);
  }
}

const resetContribute = setupContribute({
  getPhrase: () => lastQuery,
  getLang: () => lang,
  isLocal: () => hasRecorder,
  isRecorded: (phrase) => hasRecording(phrases, phrase),
  getPromptId: () => null, // typed searches here are never tied to a prompt; that's help.html's job
  onSaved: () => { phrasesReady = loadPhrases(); }, // new recordings are playable at once
});

$('form').onsubmit = (e) => { e.preventDefault(); find($('query').value); };

$('listen-btn').onclick = listen;
$('copy-btn').onclick = copy;

// --- data ---
// The public site adds visitor recordings from Supabase; if Supabase is unreachable the phrasebook still works.
async function withVisitorRecordings(base) {
  try {
    return mergeSubmissions(base, await fetchSubmissions(), audioUrl, prompts);
  } catch {
    return base;
  }
}

async function loadPhrases() {
  setStatus('Loading phrases…');
  try {
    const res = await fetch('phrases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    hasRecorder = Boolean(data.recorder);
    basePhrases = data.phrases;
    prompts = data.prompts || [];
    phrases = hasRecorder ? data.phrases : await withVisitorRecordings(data.phrases);
    setStatus('');
  } catch (err) {
    setStatus(`Could not load phrases: ${err.message}`, true);
  }
}

applyLabels();
let phrasesReady = loadPhrases();

setupAdmin({
  getBasePhrases: () => basePhrases,
  getPhrases: () => phrases,
  reloadPhrases: () => (phrasesReady = loadPhrases()),
});
