// vitaradar.hu: a page's title, description and share tags, set once it knows what it shows (an MP, a replay).
//
// Share crawlers (Facebook, X, LinkedIn, Messenger, Viber) don't run scripts: they read the static tags in the HTML,
// a generic version for the page type with the share image. This is for browsers (the tab, bookmarks) and for Google,
// which renders the page. The canonical URL and og:url of an mp.html?id= or watch.html?s= page are set here only:
// a static one would point every share and search result of them to the bare page, without its id.

const SITE = "https://vitaradar.hu/";

function meta(attr, key, value) {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!m) {
    m = document.createElement("meta");
    m.setAttribute(attr, key);
    document.head.append(m);
  }
  m.setAttribute("content", value);
}

// path: the page's own address, without the parameters that only seek or scroll (t, c), e.g. "mp.html?id=…"
export function setPageMeta({ title, description, path }) {
  if (title) {
    document.title = title;
    meta("property", "og:title", title);
    meta("name", "twitter:title", title);
  }
  if (description) {
    meta("name", "description", description);
    meta("property", "og:description", description);
    meta("name", "twitter:description", description);
  }
  if (path) {
    const url = new URL(path, SITE).href;
    meta("property", "og:url", url);
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.append(link);
    }
    link.href = url;
  }
}
