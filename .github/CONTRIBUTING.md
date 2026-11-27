# Contributing to vitaradar.hu

Thanks for helping! This repository is the website of [vitaradar.hu](https://vitaradar.hu/): plain HTML, CSS and
JavaScript on GitHub Pages, with no build step. The fact-check pipeline and the backend are in a private repository,
so verdicts can't be changed here by a pull request; report them instead (below).

## Language

English is this repository's language: write bug reports, suggestions, pull requests, commit messages and reviews in
English. The one exception is fact checking: a report about a wrong verdict, speaker, quote or time may be written in
Hungarian, and its form is in Hungarian. Other issues written in Hungarian may be closed with a request to reopen them
in English.

## Reporting

- **A wrong fact check** (verdict, speaker, quote or time), in Hungarian or English: use the flag on the fact's card
  on the site, which fills in the
  [Tényellenőrzés helyesbítése](https://github.com/kenyerman/vitaradar.hu/issues/new?template=fact-correction.yml)
  form for you. Please add sources.
- **Something broken**, in English: [bug report](https://github.com/kenyerman/vitaradar.hu/issues/new?template=bug-report.yml).
- **An idea**, in English: [suggestion](https://github.com/kenyerman/vitaradar.hu/issues/new?template=suggestion.yml).
- **A security problem:** don't open an issue; see [SECURITY.md](SECURITY.md).
- **Anything private** (your account, your data): e-mail help@vitaradar.hu.

Issues are public. Leave out personal data you don't want to share.

## Pull requests

1. For anything bigger than a small fix, or anything that changes the look, open an issue first so we can agree on it.
2. Fork the repository, branch from `master`, and keep one pull request per issue.
3. Run it locally and check it at phone (about 375 px) and desktop width, with no errors in the console:

   ```bash
   python3 -m http.server 8099
   ```

   Then open http://localhost:8099/. The pages read the live data from Firestore, so you see real sittings.
4. Add screenshots (phone and desktop) to the pull request for anything visible.

### House rules

- **No build step, no frameworks.** Plain ES modules, loaded straight by the pages.
- **Cache keys.** Every script, stylesheet and image is named with a `?v=` key (`js/app.js?v=202611291437`), and GitHub
  Pages serves the latest bytes for any key. When you change a JS or CSS file, give it a key newer than any on
  `master`, in every page and module that names it, and give those modules new keys too. One module has one key
  everywhere.
- **Offline page.** If you change `offline.html`, raise `VERSION` in `sw.js`.
- **Site text.** Text visitors see on the site is Hungarian. Ids, classes, query parameters, storage keys and code
  comments are English.
- **Safety.** Put user text on the page as text (`textContent`), never as HTML.
- **Privacy.** No new trackers, cookies, local storage or third-party scripts without an issue first: the impresszum
  lists everything the site stores.

## Commit messages

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): what changes
```

- **type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` or `revert`;
- **scope** (optional, lower case): the part of the site, such as `mobile`, `profile`, `archive`, `share`;
- a `!` before the colon marks a breaking change: `feat(api)!: …`.

For example `fix(share): keep the quote under the URL limit` or `chore: new ?v= for js/app.js and its importers`.
Write the subject in English. Merge commits (merging `master` into your branch) are left as Git writes them.

A check on every pull request (`.github/workflows/commit-messages.yml`) fails when the title or a commit's first line
doesn't follow this. To fix a commit message, reword it (`git commit --amend` for the last one, `git rebase -i` for
older ones) and force-push your branch; to fix the title, edit it on the pull request.

## License

By contributing code you agree that it is released under the repository's [MIT license](../LICENSE).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind, including to the people whose
statements are being checked.
