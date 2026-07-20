# HIT.GG v7 — Integration Guide

## What's in v7

**New: Live P/L graph** — `js/pl.js`
Docked bottom-right widget. Minimized: glass pill with a live sparkline + session P/L. Expanded: canvas chart (Session / 24h / 7d tabs), Session & Lifetime P/L, win rate, biggest win/loss, streak, and session wagered — all GC/SC aware and fed instantly by every game's settle path via `PLGraph.roundSettled(bet, payout)` (one call per settled round, AutoPlay turbo included). Session + lifetime persist in localStorage (`hitgg_pl_v1`); hourly buckets back the 24h/7d views. Reset-session button keeps lifetime intact.
`// TODO: Backend` — replace with a server ledger (`/api/me/pnl`).

**New: Vault** — `js/vault.js`
Lock part of your GC/SC behind a password. Vaulted coins leave `balances` entirely, so the topbar, `takeBet()` and AutoPlay only ever see unlocked funds — over-betting fails the normal way (the insufficient-funds alert now hints at vaulted coins). Deposits are always open; withdrawals need the password (salted SHA-256 via Web Crypto, localStorage `hitgg_vault_v1`, in-memory unlock that relocks on reload). Topbar lock button + sidenav entry; balances show `••••` while sealed.
`// TODO: Backend` — server-side vault, argon2/bcrypt, 2FA, rate-limited unlocks.

**Rakeback rebalance (Shuffle/Rainbet-competitive)**
Rakeback is now a share **of the ~1% house edge**, not of turnover, credited instantly. The headline rate comes from VIP tier: Bronze 5% → Silver 6.5% → Gold 8% → Platinum 10% → Diamond 12%, plus the existing permanent level perks (+0.5% / +1%), capped at 15%. 2x boost weekends unchanged. Modal + VIP copy updated; claim UX, progress and lifetime stats untouched.

**Polish pass**
- CSS: the two duplicate `.auto-panel` blocks are merged — the later v6 layer is now the single source of truth (unique rules from the deleted block were folded in: progress show/hide, summary pointer-events, crash-chip radius). New `v7` layer at the end of `style.css` holds all `.plx-*` / `.vault-*` styles.
- Micro-interactions: tighter `:active` press feedback on buttons/pills, focus-ring consistency, modal card snap-in.
- Mobile (≤900 / ≤640): wallet cluster compaction for the new Vault button, roulette table horizontal scroll + wrapping chip picker/outside bets, tighter keno grid & tower tiles, P/L card goes full-width, Vault move rows stack.
- Script order: `wallet → pl → vault → autoplay → …` (P/L + Vault ride right behind the wallet; every game references `PLGraph` optionally).

---

## v3 recap

**v3 games**

**New games**
| File | Game | Notes |
|---|---|---|
| `js/dice.js` | **Dice** | Roll 0.00–100.00, bet Over/Under a slider-set target. Multiplier = 99 ÷ win chance (1% edge). Scramble readout animation, near-miss screen shake, win-zone track. |
| `js/tower.js` | **Tower** | 8 floors, one safe pick per floor. Risks: Low 4×1💣 (~9x top) · Medium 3×1 (~24x) · High 2×1 (~236x) · Extreme 3×2💣 (~5,900x). Per-floor mult = 0.99 ÷ P(safe). Cash out any floor; topping auto-cashes with confetti. |
| `js/roulette.js` | **Roulette** | European single-zero canvas wheel with orbiting ball that decays into the winning pocket (outcome decided up front, animation lands exactly). Chip picker, straight/red/black/odd/even/low/high/dozens. 36x / 3x / 2x. |

**Overhauls**
| File | Change |
|---|---|
| `js/keno.js` | Four difficulties (Low/Medium/High/Extreme) changing draw count (10/10/9/8) and paytable shape. Tables generated at load from exact hypergeometric probabilities, shaped per difficulty, normalized to ~99% RTP, 10,000x line cap. Live paytable strip + "Top pay" stat. |
| `js/blackjack.js` + `index.html` | Layout overhaul: dealer total badge sits directly **below** dealer cards, player total directly **above** player cards, felt tightened. Badges color by state — teal 17–20, gold glow on 21, red on bust — with a bump animation on every change. |
| `js/challenges.js` | Tracking cases `dice_roll`, `tower_result`, `roulette_spin`; 5 new pool challenges; 9 new achievements (First Roll → Needle Threader, First Ascent → Summit, Table Service → Wheel Regular). |
| `js/app.js` | Routing + lazy init for the three views, lobby tiles, favorites + hot-strip + ticker entries. |
| `css/style.css` | v3 block (~300 lines): dice stage/track/slider, tower board + risk grid, roulette wheel/table/chip badges, keno difficulty pills + paytable strip, blackjack badge system. Mobile breakpoints at 900px. |

## v2 recap (already integrated)

`js/sound.js` (WebAudio SFX + mute toggle) · `js/fx.js` (shake, particles, floatWin, `celebrateWin`, big-win overlay) · `js/plinko.js` (guided-physics Plinko, 9 tables ~99% RTP) · `js/profile.js` (21 rank avatars, 12 titles, VIP borders, profile modal) · lobby hot strip, favorites, wins ticker.

## Script load order (already set in index.html)

```
sound → fx → wallet → challenges → retention → profile
→ app → keno → blackjack → crash → mines → plinko → dice → tower → roulette
```

`sound`/`fx` first (games call them); `profile` after `wallet`/`challenges`; game modules last — each self-inits lazily on first `showView`.

## Backend TODO map

Search `// TODO` — the important hooks:

- **Dice** — `diceRoll()`: replace `Math.random()` with provably-fair server rolls (serverSeed + clientSeed + nonce → HMAC); settle server-side.
- **Tower** — `towerStart()`: bomb layout must be server-generated and hash-committed before the run; validate each pick server-side.
- **Roulette** — `rlSpin()`: winning number from certified server RNG or live wheel feed; settle bets server-side. The animation already accepts any predetermined outcome.
- **Keno** — draws from a provably-fair server RNG; serve + settle paytables server-side.
- **Plinko** — same pattern in `dropBall()`.
- **Ticker / hot strip / referral / cosmetics / sounds** — see the v2 notes in `js/app.js`, `js/wallet.js`, `js/profile.js`, `js/sound.js` (`SOUND_FILES` overrides synthesized SFX with real audio URLs).

## Extending

- **New dice edge**: change `DICE_EDGE_RTP` (99 = 1% edge).
- **New tower risk**: add to `TOWER_RISKS` — `{label, cols, bombs}`; the ladder and top-of-tower stat derive automatically.
- **New keno difficulty**: add to `KENO_DIFFICULTIES` — `{label, draws, minFrac, exp}`; tables regenerate at load, always ~99% RTP.
- **Roulette bet types**: add a key to `rlSpotWins()` + `rlSpotMult()` and a button in `buildRouletteTable()` (splits/corners would follow the same pattern).
- **Juice**: call `playSound()`, `popEl()`, `particleBurstAtEl()`, finish wins with `celebrateWin({mult, payout, anchorEl})` — overlay, ticker, and confetti all hang off that one call.
