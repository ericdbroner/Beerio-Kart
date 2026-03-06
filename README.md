# Beerio Kart Redemption

Realtime Beerio Kart bracket app with:
- lobby-first flow,
- random seeding at tournament start,
- single or double elimination,
- password-protected admin controls.

## Run

No build step required.

1. Open `/Users/ericb/Beerio-Kart/index.html` directly, or
2. Serve locally:

```bash
cd /Users/ericb/Beerio-Kart
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## One-Time Setup (Required For Shared Global Bracket)

1. Create a Firebase project.
2. Enable **Realtime Database**.
3. Edit `/Users/ericb/Beerio-Kart/firebase-config.js`:
   - replace all `REPLACE_ME` values with your Firebase web config
   - keep/change `window.BEERIO_ADMIN_PASSWORD` as desired (currently `B33r10k@rt`)
4. Deploy to GitHub Pages.

Without Firebase config, the app still works in local-only mode.

## Use Flow

1. Share the tournament link (`?t=<tournament-id>`).
2. Each participant enters their name in **Join Lobby** and taps **Join**.
3. Admin unlocks with the password, sets player count/format if needed, then taps **Seed Players and Begin Tournament**.
   - joined players are shuffled and seeded randomly.
4. Admin records winners with **Win** buttons.

## Notes

- Byes are automatic for non-power-of-2 player counts.
- Double elimination includes winners bracket, losers bracket, grand final, and reset final.
- Non-admin viewers can join the lobby, but only admin can start/update/report matches.
- Mobile uses a dedicated stacked bracket layout that fits phone browser width.
