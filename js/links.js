// Links into the archive's replay page: a past stream at a moment (seconds into its video).

export function watchHref(session, t) {
  return `watch.html?s=${encodeURIComponent(session)}${t ? `&t=${Math.max(0, Math.floor(t))}` : ""}`;
}
