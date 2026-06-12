# Product-tour video assets

The first-run onboarding popover (`components/ProductTour.tsx`) plays a short,
GIF-like clip demoing the **compile → live PDF preview** flow. Drop the real
files here — no code change needed; until then a tasteful placeholder shows.

Expected files (all optional; add what you have):

- `compile.webm`  — preferred (smaller). `type="video/webm"`
- `compile.mp4`   — fallback for Safari/iOS. `type="video/mp4"`
- `compile-poster.png` — first-frame poster shown before playback.

The `<video>` is rendered with `autoplay loop muted playsinline preload="metadata"`
so it behaves like a GIF. Keep the clip:

- **short** (~4–8 s, seamless loop) and **silent** (it's always muted),
- **small** (a few hundred KB–~2 MB; H.264 mp4 + VP9 webm),
- roughly **16:9** (the card reserves an `aspect-video` box).

`prefers-reduced-motion: reduce` users get the poster with manual controls
instead of autoplay.

Preview the tour anytime (ignoring the once-per-user flag) with `…/studio?tour=1`.
