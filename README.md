# btc-race-24h-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/oxdfahmad/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/oxdfahmad/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A bot for **btc-race-24h-20261118-1444** (make.fun): trades cbBTC/USDC on
1-minute on-chain bars with $1,000 of paper money. Long only, no leverage.

## Strategy — "Dipcatcher"

The dev window (24 h of cbBTC/USDC 1-minute bars, 2026-11-18 14:44 UTC to
2026-11-19 14:44 UTC) is a falling day: BTC ends −280 bps, deepest
drawdown 324 bps, no single minute moves more than 64 bps. Holding
through it loses $31.63, and trend-following bleeds on the whipsaws inside
the fall. The window still has real snap-backs: the dips that form recover
150+ bps within a few hours. So the bot does almost nothing most of the day
and only buys a genuine dip, then banks the snap-back — 2 trades total,
the winner lesson from the previous race (dip-buy 1–2 trades, don't
overtrade).

- **Reference**: the 120-bar simple moving average of the close, kept as an
  exact integer ring buffer. A dip is a close at least **90 bps below** it.
- **Enter**, full cash, one position at a time: on the first bar whose close
  is 90+ bps below the 120-bar average, provided the bot is flat, at least
  20 bars have passed since its last exit, and at least 60 bars of the
  window remain (a late entry cannot outrun the ~26 bps round-trip cost
  before the final flatten).
- **Exit**, the whole position: the first close at least **200 bps above**
  the average fill price (take profit), or at least **90 bps below** it
  (hard stop). The average fill comes from the harness's own position cost
  (fees included), so the exit lines are anchored on what was actually
  paid, not on the close the order was decided on.
- Orders cap slippage at 150 bps from the latest close, far above the
  usual 1-minute move, so fills are almost never refused for slipping. A
  buy never spends more than the weight room the caps allow.

## Dev-window results (kit harness, process driver)

| check | net PnL | trades | max drawdown |
|---|---:|---:|---:|
| full dev window | **+$18.39** | 2 | 0.68% |
| at 2× fees | +$17.58 | — | — |
| buy-and-hold, same window | −$31.63 | 1 | 3.25% |
| hold-cash | $0.00 | 0 | 0% |

Robustness: the neighbouring region is a broad plateau, not a knife-edge
fit — SMA 110–130, dip 80–90, take-profit 190–200, stop 80–90 all score
+$18.29 to +$18.86 with the same 2 trades. The rejected neighbours:
faster SMA 60 (−$12.52, whipsaws), tighter stop 60 (−$7.62, stopped out
early), softer dip 70 with wider stop (−$11.77), deeper dip 100 ($0.00,
no entry at all). The 90-bar variant of the same idea scores +$17.25.

## Honest caveats

- The dev window is one falling day (BTC −2.80% with 3.24% swings). The
  race window is unseen: if it falls like the dev window, the bot should
  bank dips the same way; if it chops flat, the dip filter should keep it
  mostly in cash; if it trends hard up, the bot will sit out most of the
  move and lose little. No backtest can promise a race outcome.
- Only 2 round trips on the dev window — a small sample. The edge is the
  dip filter (cash in chop that is not a dip), not trade frequency.
- Dev net of +$18.39 clears the dev gate (net PnL > $0 after every fee),
  but the prizes are decided on the unseen race window alone.

## Files

- `main.ts` — the bot (Node 22, TypeScript, stdlib only).
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's TS shim.
- `LICENSE` — MIT.
