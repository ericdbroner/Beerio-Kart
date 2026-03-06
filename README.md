# Beerio Kart Redemption

A lightweight single-page web app for running a Beerio Kart tournament bracket.

## Run

No build or install needed.

1. Open `/Users/ericb/Beerio-Kart/index.html` in a browser.
2. Or serve it locally:

```bash
cd /Users/ericb/Beerio-Kart
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Use

1. Use the always-visible top controls to set:
   - player count (with `-` / `+`)
   - elimination format (single or double)
2. Click **Update Bracket** to apply settings.
3. Enter player names directly in the first-round slots.
4. Click **Win** on each match winner to advance them.

## Notes

- Bracket is win/loss only (no scoring).
- Supports single and double elimination.
- Non-power-of-2 player counts are supported with automatic seeded byes.
- After names are entered, settings changes require explicit **Update Bracket** confirmation.
- Bracket view auto-scales match cards to fit inside the main bracket card on different displays.
- State is auto-saved in browser local storage.
- Headings use `assets/mario_kart_f2.ttf`.
