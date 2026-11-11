# Demo video

Cut: **2:56**, 1920×1080, 30 fps, silent (voice-over goes on top). Opens with the problem and three sourced statistics (Rabbet 2024 and 2025 Construction Payments Reports: 82% of contractors wait 30+ days, 88% declined to bid for slow payers, $299B cost in 2025). The walkthrough was recorded live on Nov 11, 2026 against PayPal sandbox and Claude: work order wo-1043, $220 offer, $245 counter accepted, $49 deposit and $196 balance paid by PayPal Payouts after a logged PM override (the Verifier failed the sample proof at 85%: no EXIF, cabinet not confirmed).

- `punchlist-pay.mp4`: step labels and guide captions burned in
- `punchlist-pay-clean.mp4`: step labels only, for a cut with your own captions
- `narration.txt`: the voice-over script with start times; `captions.srt`: the same as subtitles
- `timeline.json`: shots, speeds and the take's facts

## Voice-over

Read `narration.txt` against the clean cut, starting each paragraph at its timestamp. If the delivery drifts, upload `captions.srt` to YouTube and let it re-time, or re-time and re-run the assembler. No third-party music.

## Rebuild

Needs `pip install playwright` (Chromium) and ffmpeg. With the app running on :3000 with live keys:

```sh
python scripts/video/record.py --out <take-dir>              # pauses at PayPal: approve the printed link as the PM
python scripts/video/record.py --out <take-dir> --part tail  # optional: re-record only the ending
python scripts/video/assemble.py --take <take-dir>           # writes docs/video/*
```

Start from a fresh database (`PGLITE_DIR=<empty dir>`) so the ledger shows only the seed and the new job. Record during the day: the agents write the deadline into the contract ("today, 6 PM").
