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
  (`text-multilingual-embedding-002`) and stored in `chunks/` with a Firestore vector index. The
  [search function](functions/search/main.py) embeds the visitor's question with the same model and returns that
  MP's nearest passages.
- **Read-only:** the [security rules](firestore.rules) let anyone read the live feed, the MPs and their speeches,
  and nobody write from a browser; the passages with their vectors are read only by the search function. The
  Firebase config in `js/config.js` is public by design.

## Run locally

```bash
python3 -m http.server 8099
```

Then open http://localhost:8099/.

## License

- The code in this repository is [MIT](LICENSE).
- The fact-check texts, the Vitaradar name and logo, and the video stream: © vitaradar.hu, all rights reserved.
- The footage is the Hungarian Parliament's (Országgyűlés).
