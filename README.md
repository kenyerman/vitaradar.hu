# vitaradar.ai

The public website of Vitaradar: the Hungarian Parliament's live stream with automatic fact-checks. Below the video,
each claim appears with its verdict (true, false, unverifiable, fallacy) the moment it is said in the video, and the
current speaker's photo is shown beside them.

Plain HTML, CSS and JavaScript, no build step, hosted on GitHub Pages. Two libraries load from public CDNs:
[hls.js](https://github.com/video-dev/hls.js) for the video and the
[Firebase web SDK](https://firebase.google.com/docs/web/setup) for the live feed.

## How it works

```
parliament's stream ──► fact-check pipeline (GPU VM) ──► HLS video pieces ──► Cloud Storage ──► the player
                                   │
                                   └──► Firestore: facts + speaker turns ──► this page (live updates)
```

- **Video:** an HLS stream (`live/current.hls_url`), a fixed broadcast delay behind the sitting.
- **Facts and speakers:** Firestore documents the pipeline writes as it goes:
  - `live/current`: the running session, the stream address, whether it is live;
  - `sessions/{session}/claims/{id}`: one fact each, with `show_at` / `verdict_at`;
  - `sessions/{session}/state/floor`: the speaker turns, with `start_at`.
- **In sync with the picture:** every time is on the stream's own clock (the playlist's
  `EXT-X-PROGRAM-DATE-TIME`). The page compares it with the date of the frame on screen, so a fact appears when the
  viewer's video reaches it, not when the server found it.
- **Read-only:** the [security rules](firestore.rules) let anyone read the live feed and nobody write it from a
  browser. The Firebase config in `js/config.js` is public by design.

## Run locally

```bash
python3 -m http.server 8099
```

Then open http://localhost:8099/.

## License

The code is [MIT](LICENSE). The stream, the fact-check texts and the Vitaradar name and logo are not covered by it:
© vitaradar.ai, all rights reserved. The footage is the Hungarian Parliament's (Országgyűlés).
