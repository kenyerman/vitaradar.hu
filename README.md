# vitaradar.hu

The public website of Vitaradar: the Hungarian Parliament's live stream with automatic fact-checks. Below the video,
each claim appears with its verdict (true, false, unverifiable, fallacy) the moment it is said in the video, and the
current speaker's photo is shown beside them.

Plain HTML, CSS and JavaScript, no build step, hosted on GitHub Pages. Two libraries load from public CDNs:
[hls.js](https://github.com/video-dev/hls.js) for the video and the
[Firebase web SDK](https://firebase.google.com/docs/web/setup) for the live feed.

## Pages

- **Élő adás** (`index.html`): the stream, the facts as they are said (left) and the current speaker (right).
- **Képviselők** (`mps.html`): every MP whose speeches were fact-checked, with their totals.
- **Képviselő** (`mp.html?id=…`): one MP's overall scores, their speeches grouped by sitting day with each speech's
  claims and verdicts (and transcript, where the run saved one), and a search over what they said.

## How it works

```
parliament's stream ──► fact-check pipeline (GPU VM) ──► HLS video pieces ──► Cloud Storage ──► the player
                                   │
                                   ├──► Firestore: live facts + speaker turns ──► live page (live updates)
                                   └──► Firestore: speeches, MP totals, passage vectors ──► MP pages, search
```

- **Video:** an HLS stream (`live/current.hls_url`), a fixed broadcast delay behind the sitting.
- **Live facts and speakers:** Firestore documents the pipeline writes as it goes:
  - `live/current`: the running session, the stream address, whether it is live;
  - `sessions/{session}/claims/{id}`: one fact each, with `show_at` / `verdict_at`;
  - `sessions/{session}/state/floor`: the speaker turns, with `start_at`.
- **In sync with the picture:** every time is on the stream's own clock (the playlist's
  `EXT-X-PROGRAM-DATE-TIME`). The page compares it with the date of the frame on screen, so a fact appears when the
  viewer's video reaches it, not when the server found it.
- **MP history:** when a run ends, the pipeline groups it into speeches (one MP's consecutive turns, the chair's
  remarks left out) and writes `speeches/{id}` (claims, verdicts, transcript) and `mps/{id}` (totals).
- **Search:** each speech is cut into ~120-word passages, embedded with Vertex AI's multilingual model
  (`text-multilingual-embedding-002`) and stored with a Firestore vector index. A small search function embeds the
  visitor's question with the same model and returns that MP's nearest passages.
- **Accounts** (`js/account.js`): Google sign-in only; a profile (name, nick, picture) after a one-time registration,
  16+ only. E-mail and birth date are visible to their owner only. The sign-in popup runs on `auth.vitaradar.hu`
  (Firebase Hosting, connected to the project, DNS a CNAME at DotRoll), so Google's account chooser names our domain.
- **Votes and comments** (`js/social.js`): thumbs up/down on every fact check and comment; comments (250 characters,
  replies two levels deep) for registered users, who can delete their own, flag others' and block users. Every
  write goes through the backend's user API, which checks rate limits and decides whether a comment is published.
  User text is put on the page as text, never HTML, and links ask before leaving the site.
- **Live chat** (`js/chat.js`): for registered users over 18, through Firestore; messages are deleted after an hour.
- **Games** (`js/game.js`): now and then, on a fact the pipeline is sure of, a 5-second "true or false?" or a 7-second
  "which fallacy?" question pops up as the claim is said; the fact itself stays "being checked" until the answer
  window is over, then everyone sees the result and how the other players answered. At the start of a speech, players
  have 20 seconds to tip its number of true, false and fallacious claims. Right answers and close tips earn points
  (`users/{uid}.points`). The answer key never reaches the browser before the window closes: the pipeline keeps it,
  the user API accepts answers only in time, and the pipeline settles each game. Visitors can play along, unscored.
- **Protected:** the page uses Firebase App Check with reCAPTCHA Enterprise (invisible, score-based), so only this
  site, not scripts, can use the search; Firestore's security rules make the public data read-only for browsers. The
  Firebase config and the reCAPTCHA site key in `js/config.js` are public by design.
- **Backend:** the search function, the user API, the profile-picture service, the security rules and the fact-check
  pipeline are in a private repository; this repository is the website only.

## Run locally

```bash
python3 -m http.server 8099
```

Then open http://localhost:8099/.

## License

- The code in this repository is [MIT](LICENSE).
- The fact-check texts, the Vitaradar name and logo, and the video stream: © vitaradar.hu, all rights reserved.
- The footage is the Hungarian Parliament's (Országgyűlés).
- The MP portraits in `img/mps/` are the Hungarian Parliament's official photos (parlament.hu), with the
  background removed by [backgroundremover](https://github.com/nadermx/backgroundremover).
