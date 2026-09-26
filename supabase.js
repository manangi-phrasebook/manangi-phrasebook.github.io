// Visitor recordings live in Supabase (same project as the Tibetan Translator). The publishable key is
// meant to be public: row-level security lets visitors add recordings and read non-rejected ones only.
export const SUPABASE_URL = 'https://eymrhjuzmsnhlgyysckt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_7fq6FmQ3EnH9t8rexhcgHw_BG6ZbtsL';
export const BUCKET = 'manangi-submissions';
export const TABLE = 'manangi_submissions';
// Bump when the consent wording changes; the database refuses recordings without a version.
export const CONSENT_VERSION = 'v1-2026-09-25';
const EXTENSION = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

let client = null;
export async function getClient() {
  if (!client) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return client;
}

export const audioUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`;

const FETCH_TIMEOUT_MS = 5000; // a slow Supabase must never hold the phrasebook hostage

/** Visitor recordings Supabase lets the public see (rejected ones are hidden by row-level security).
 * Plain REST read: no client library on the page-load path. */
export async function fetchSubmissions() {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=phrase,lang,audio_path,status,created_at,prompt_id,spelling&limit=5000`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

/** Save one visitor recording: audio into the bucket, then its row. */
export async function uploadSubmission({ phrase, lang, blob, promptId = null, speaker = null, spelling = null }) {
  const sb = await getClient();
  const type = blob.type.split(';')[0]; // "audio/webm;codecs=opus" -> "audio/webm"
  const path = `${crypto.randomUUID()}.${EXTENSION[type] || 'webm'}`;
  const upload = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
  if (upload.error) throw new Error(upload.error.message);
  const insert = await sb.from(TABLE).insert({
    phrase, lang, audio_path: path, prompt_id: promptId, speaker: speaker || null,
    spelling: spelling || null, consent_version: CONSENT_VERSION,
  });
  if (insert.error) throw new Error(insert.error.message);
}
