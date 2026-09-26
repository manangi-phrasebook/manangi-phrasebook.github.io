// Owner-only approval, bottom-right of the page. Open the site once with #admin to sign in (Supabase
// emails a link); the browser stays signed in. Database rules decide who may approve: only the owner's
// email can read every recording or change its status, so this panel is useless to anyone else.
// Visitors never load any of this: the Supabase library is fetched only for #admin or a saved session.

import { normalize, waitingSubmissions } from './match.js';
import { SUPABASE_URL, TABLE, audioUrl, getClient } from './supabase.js';

const SESSION_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const REFRESH_MS = 60000;

function hasSavedSession() {
  try { return Boolean(localStorage.getItem(SESSION_KEY)); } catch { return false; }
}

const isOwnerVisit = () =>
  location.hash.includes('admin') || location.hash.includes('access_token') || hasSavedSession();

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); // strings become text nodes: visitor-typed phrases are never parsed as HTML
  return node;
}

function playButton(label, url) {
  const btn = el('button', { className: 'owner-play', textContent: label, disabled: !url });
  btn.onclick = () => new Audio(url).play().catch(() => {});
  return btn;
}

export function setupAdmin({ getBasePhrases, getPhrases, reloadPhrases }) {
  if (!isOwnerVisit()) return;

  const box = el('div', { id: 'owner' });
  document.body.append(box);
  let sb = null;
  let open = false;

  async function render() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderSignIn();
    const { data: rows, error } = await sb.from(TABLE).select('*');
    if (error) return box.replaceChildren(el('p', { className: 'owner-msg', textContent: `Could not load: ${error.message}` }));
    const waiting = waitingSubmissions(getBasePhrases(), rows);
    const badge = el('button', { className: 'owner-badge' + (waiting.length ? ' has' : ''),
      textContent: waiting.length ? `🔔 ${waiting.length} waiting for approval` : '✓ Nothing to approve' });
    badge.onclick = () => { open = !open; render(); };
    box.replaceChildren(...(open ? [renderPanel(waiting, session)] : []), badge);
  }

  function renderSignIn() {
    const email = el('input', { type: 'email', placeholder: 'Owner email', required: true, autocomplete: 'email' });
    const msg = el('p', { className: 'owner-msg' });
    const form = el('form', { className: 'owner-panel' }, el('b', { textContent: 'Owner sign-in' }), email,
      el('button', { type: 'submit', textContent: 'Email me a sign-in link' }), msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email: email.value.trim(),
        options: { emailRedirectTo: `${location.origin}${location.pathname}` } }); // works under a sub-path (GitHub Pages)
      msg.textContent = error ? `Could not send: ${error.message}` : 'Check your email and open the link on this Mac.';
    };
    box.replaceChildren(form);
  }

  function currentAudio(phrase) {
    const key = normalize(phrase);
    return getPhrases().find((p) => normalize(p.english || '') === key || normalize(p.nepali || '') === key)?.audio;
  }

  async function decide(row, status) {
    const { error } = await sb.from(TABLE).update({ status }).eq('id', row.id);
    if (error) return alertInPanel(`Not saved: ${error.message}`);
    await reloadPhrases();
    render();
  }

  function alertInPanel(text) {
    box.querySelector('.owner-msg')?.replaceChildren(text);
  }

  function renderPanel(waiting, session) {
    const items = waiting.map((row) => {
      const isOriginal = row.replaces === 'original';
      const approve = el('button', { className: 'owner-approve',
        textContent: isOriginal ? 'Keep (original stays)' : 'Approve — replace current' });
      const reject = el('button', { className: 'owner-reject', textContent: 'Reject' });
      approve.onclick = () => decide(row, 'approved');
      reject.onclick = () => decide(row, 'rejected');
      return el('li', {},
        el('div', { className: 'owner-phrase', textContent: `“${row.phrase}”` }),
        el('div', { className: 'owner-row' }, playButton('▶ New', audioUrl(row.audio_path)),
          playButton(isOriginal ? '▶ Original' : '▶ Current', currentAudio(row.phrase))),
        el('div', { className: 'owner-row' }, approve, reject));
    });
    const signOut = el('button', { className: 'owner-link', textContent: `Sign out (${session.user.email})` });
    signOut.onclick = async () => { await sb.auth.signOut(); open = false; render(); };
    return el('div', { className: 'owner-panel' },
      el('b', { textContent: 'Waiting for approval' }),
      items.length ? el('ul', {}, ...items) : el('p', { textContent: 'Nothing waiting. New phrases go live on their own.' }),
      el('p', { className: 'owner-msg' }), signOut);
  }

  (async () => {
    try {
      sb = await getClient();
      sb.auth.onAuthStateChange(() => render());
      await render();
      setInterval(() => { if (!open) render(); }, REFRESH_MS);
    } catch (err) {
      box.replaceChildren(el('p', { className: 'owner-msg', textContent: `Owner panel unavailable: ${err.message}` }));
    }
  })();
}
