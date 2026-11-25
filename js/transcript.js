// A speech's Gemini transcript (pfc's speech transcriber): sessions/{session}/transcripts/{speech id}, written about a
// minute after the speech ends. Its words carry their times from the speech's start (s, e in seconds), so the MP
// page links each paragraph into the replay and the replay follows the video word by word. The speaker is the
// floor's (who the picture showed), never the transcription's; the text is automatic and can be wrong.
//
// The document: {text, words: [{w, s, e}], t0, t1, duration_s, model, word_times, ...}.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611250130";

export const AI_NOTE = "automatikus (AI) leirat – tévedhet";

const cache = new Map();  // `${session}/${id}` -> Promise<document or null>

export function loadTranscript(session, id) {
  const key = `${session}/${id}`;
  if (!cache.has(key)) {
    cache.set(key, getDoc(doc(db, "sessions", session, "transcripts", id))
      .then((snap) => (snap.exists() ? snap.data() : null))
      .catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

// The words as paragraphs: a new one at a sentence's end once the paragraph is minS long, or at maxS whatever comes.
export function paragraphs(words, minS = 20, maxS = 45) {
  const out = [];
  let cur = null;
  for (const w of words || []) {
    if (!cur) { cur = { s: w.s, words: [] }; out.push(cur); }
    cur.words.push(w);
    const long = w.e - cur.s;
    if ((long >= minS && /[.?!…]["”»)]*$/.test(w.w)) || long >= maxS) cur = null;
  }
  return out;
}

// The transcript as paragraphs, each starting with `timeLink(seconds from the speech's start)`.
export function transcriptBody(tr, timeLink) {
  const box = el("div", "gtranscript");
  const ps = paragraphs(tr.words);
  if (!ps.length) {
    box.append(el("p", "gtranscript-p", tr.text || ""));
    return box;
  }
  for (const p of ps) {
    const para = el("p", "gtranscript-p");
    para.append(timeLink(p.s), " ", p.words.map((w) => w.w).join(" "));
    box.append(para);
  }
  return box;
}

export function wordCount(tr) {
  return (tr.words && tr.words.length) || (tr.text ? tr.text.split(/\s+/).filter(Boolean).length : 0);
}
