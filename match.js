// Closest-phrase lookup. Not a translator: it only ever returns phrases that exist in the phrasebook.
// ponytail: similar-words matching, so "how are you" can land on "How old are you?"; the UI always
// shows the real meaning. Upgrade path: multilingual sentence embeddings.

export const MIN_GOOD_SCORE = 0.5;
const TOP_N = 3;

export function normalize(text) {
  // drop punctuation incl. the Devanagari danda; keep letters and vowel signs of any script
  return text.toLowerCase().replace(/[()[\]।॥.,!?;:"'’]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// Dice coefficient over character pairs: tolerant of small spelling/inflection differences.
function charSimilarity(a, b) {
  const [ga, gb] = [bigrams(a), bigrams(b)];
  const total = [...ga.values(), ...gb.values()].reduce((x, y) => x + y, 0);
  if (!total) return a === b ? 1 : 0;
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) || 0);
  return (2 * shared) / total;
}

function wordOverlap(a, b) {
  const [wa, wb] = [new Set(a.split(' ')), new Set(b.split(' '))];
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / new Set([...wa, ...wb]).size;
}

export function score(query, candidate) {
  const [q, c] = [normalize(query), normalize(candidate)];
  if (!q || !c) return 0;
  return Math.round((0.5 * charSimilarity(q, c) + 0.5 * wordOverlap(q, c)) * 1000) / 1000;
}

/** phrases: {text, english, nepali, ...}. lang: 'en' | 'ne'. Returns up to 3 new objects, best first. */
export function lookup(query, lang, phrases) {
  if (!normalize(query)) return [];
  const field = lang === 'ne' ? 'nepali' : 'english';
  return phrases
    .filter((p) => p[field])
    .map((p) => ({ ...p, score: score(query, p[field]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

const meaningKeys = (phrases) => new Set(phrases.flatMap((p) => [p.english, p.nepali]).filter(Boolean).map(normalize));

/** True when some phrase (original or visitor) already has this English/Nepali meaning. */
export function hasRecording(phrases, phrase) {
  return meaningKeys(phrases).has(normalize(phrase));
}

/**
 * Add visitor recordings (Supabase rows) to the phrase list as audio-only phrases.
 * - Phrases worded like an existing (original) meaning are skipped: originals are never replaced.
 * - For a non-original phrase, the newest non-rejected recording goes live immediately, no approval
 *   needed (temporary: for now every re-recording auto-applies; only originals still need the owner's
 *   sign-off, via waitingSubmissions below).
 * Returns a new array; inputs are untouched.
 * @param {Array<object>} phrases
 * @param {Array<{phrase: string, lang: 'en'|'ne', audio_path: string, status: string, created_at: string}>} submissions
 * @param {(path: string) => string} audioUrl
 */
function shownByPhrase(phrases, submissions) {
  const originals = meaningKeys(phrases);
  const byPhrase = new Map();
  for (const s of [...submissions].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = normalize(s.phrase);
    if (!key || originals.has(key) || s.status === 'rejected') continue;
    byPhrase.set(key, s); // ascending order, so the newest non-rejected take always wins
  }
  return byPhrase;
}

export function mergeSubmissions(phrases, submissions, audioUrl, prompts = []) {
  const promptById = new Map(prompts.map((p) => [p.pid, p]));
  const added = [...shownByPhrase(phrases, submissions).values()].map((s) => {
    const prompt = promptById.get(s.prompt_id); // prompt-list recordings know both meanings
    return {
      text: '', spelling: '',
      english: prompt ? prompt.english : s.lang === 'en' ? s.phrase : '',
      nepali: prompt ? prompt.nepali : s.lang === 'ne' ? s.phrase : '',
      audio: audioUrl(s.audio_path), source: 'visitor', clip: s.audio_path,
    };
  });
  return [...phrases, ...added];
}

/**
 * Prompts still worth asking a contributor for: not recorded in the local studio, not already a phrase,
 * and no live or pending visitor recording of it (a rejected take doesn't count). List order kept.
 * @param {Array<{pid: string, english: string, nepali: string, recorded: boolean}>} prompts
 */
export function openPrompts(prompts, submissions, phrases) {
  const live = submissions.filter((s) => s.status !== 'rejected');
  const covered = new Set([...meaningKeys(phrases), ...live.map((s) => normalize(s.phrase))]);
  const submittedIds = new Set(live.map((s) => s.prompt_id).filter(Boolean));
  const isCovered = (p) => [p.english, p.nepali].some((m) => m && covered.has(normalize(m)));
  return prompts.filter((p) => !p.recorded && !submittedIds.has(p.pid) && !isCovered(p));
}

/**
 * Pending recordings the phrasebook is not showing: a second recording of a visitor phrase, or a
 * recording of one of the originals. Each gets `replaces`: 'visitor' | 'original'. Oldest first.
 */
export function waitingSubmissions(phrases, submissions) {
  const originals = meaningKeys(phrases);
  const shown = shownByPhrase(phrases, submissions);
  // waiting only if newer than what is shown: an older take an approved one replaced is not "waiting"
  const isWaiting = (s) => {
    const key = normalize(s.phrase);
    if (originals.has(key)) return true;
    const current = shown.get(key);
    return current !== s && s.created_at > current.created_at;
  };
  return submissions
    .filter((s) => s.status === 'pending' && normalize(s.phrase) && isWaiting(s))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((s) => ({ ...s, replaces: originals.has(normalize(s.phrase)) ? 'original' : 'visitor' }));
}
