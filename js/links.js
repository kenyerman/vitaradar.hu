// Links into the archive's replay page: a past stream at a moment (seconds into its video).

export function watchHref(session, t) {
  return `watch.html?s=${encodeURIComponent(session)}${t ? `&t=${Math.max(0, Math.floor(t))}` : ""}`;
}

// A user's profile page (by uid, which stays the same when they change their nick); without a uid, one's own.
export function profileHref(uid) {
  return uid ? `profile.html?id=${encodeURIComponent(uid)}` : "profile.html";
}

// `href` with ?c=<comment id> added: that page scrolls to the comment and highlights it (js/social.js).
export function withComment(href, id) {
  return `${href}${href.includes("?") ? "&" : "?"}c=${encodeURIComponent(id)}`;
}
