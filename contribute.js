// "Not in the phrasebook? Record it." Record -> hear it back -> Save or Discard.
// Local recorder (python server.py): saved straight into prompts, playable at once.
// Public site: saved to Supabase. A new phrase is live at once; a phrase that already has a recording
// waits for approval (see mergeSubmissions in match.js), and the 823 originals are never replaced.

import { STRINGS } from './i18n.js';
import { consentField } from './consent.js';
import { canRecord, startTake } from './recorder.js';
import { uploadSubmission } from './supabase.js';

const $ = (id) => document.getElementById(id);

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function saveLocally(phrase, lang, blob) {
  const { pid } = await postJson('/api/prompts', { text: phrase, lang });
  const form = new FormData();
  form.append('audio', blob, 'clip');
  const res = await fetch(`/api/prompt/${pid}/record`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return STRINGS[lang].savedLocal;
}

export function setupContribute({ getPhrase, getLang, isLocal, isRecorded, getPromptId, onSaved }) {
  const t = () => STRINGS[getLang()];
  let take = null;    // recording in progress
  let pending = null; // recorded audio waiting for Save / Discard
  let consent = null;
  const reviewPlayer = new Audio();

  const say = (msg, isError = false) => {
    $('contribute-msg').textContent = msg;
    $('contribute-msg').style.color = isError ? 'var(--rec)' : '';
  };
  const reviewing = (on) => {
    $('contribute-review').classList.toggle('hidden', !on);
    $('rec-btn').classList.toggle('hidden', on);
    $('contribute-spelling-label').classList.toggle('hidden', isLocal());
    $('consent-slot').replaceChildren();
    if (on && !isLocal()) {
      consent = consentField(getLang());
      $('consent-slot').append(consent.element);
    }
  };
  const idleButton = () => {
    $('rec-btn').classList.remove('recording');
    $('rec-btn').textContent = t().record;
  };

  async function start() {
    try {
      take = await startTake();
    } catch {
      return say(t().micBlocked, true);
    }
    $('rec-btn').classList.add('recording');
    $('rec-btn').textContent = t().stop;
    say(t().recording);
    const blob = await take.done;
    take = null;
    idleButton();
    if (!blob) return; // discarded by a new search
    pending = blob;
    reviewing(true);
    reviewPlayer.src = URL.createObjectURL(blob);
    reviewPlayer.play().catch(() => {});
    say(t().playingBack);
  }

  $('rec-btn').onclick = () => (take ? take.stop() : start());

  $('discard-btn').onclick = () => {
    pending = null;
    reviewing(false);
    say(t().discarded);
  };

  $('save-btn').onclick = async () => {
    if (!pending) return;
    if (!isLocal() && !consent?.accepted()) return say(t().consentNeeded, true);
    $('save-btn').disabled = true;
    say(t().saving);
    try {
      const [phrase, lang] = [getPhrase(), getLang()];
      let message;
      if (isLocal()) {
        message = await saveLocally(phrase, lang, pending);
      } else {
        const spelling = $('contribute-spelling').value.trim();
        await uploadSubmission({ phrase, lang, blob: pending, promptId: getPromptId(phrase), spelling });
        message = isRecorded(phrase) ? STRINGS[lang].savedReview : STRINGS[lang].savedLive;
      }
      pending = null;
      $('contribute-spelling').value = '';
      reviewing(false);
      $('rec-btn').classList.add('hidden'); // one recording per search
      say(message);
      onSaved();
    } catch (err) {
      say(t().notSaved(err.message), true);
    } finally {
      $('save-btn').disabled = false;
    }
  };

  // called for each new weak-match search, or to start a re-record of an existing visitor take
  return function reset(phrase, promptText) {
    take?.discard(); // a new search mid-recording: throw the take away, never file it under the new phrase
    pending = null;
    reviewing(false);
    idleButton();
    $('rec-btn').classList.remove('hidden');
    $('save-btn').textContent = t().save;
    $('discard-btn').textContent = t().discard;
    $('contribute-text').textContent = promptText || t().knowHow(phrase);
    $('contribute').classList.toggle('hidden', !canRecord());
    say('');
  };
}
