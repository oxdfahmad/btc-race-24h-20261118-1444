/**
 * "Dipcatcher" — a dip mean-reversion bot for btc-race-24h-20261118-1444.
 *
 * The dev window (24 h of cbBTC/USDC 1-minute bars, 2026-11-18 14:44 UTC to
 * 2026-11-19 14:44 UTC) is a falling day: BTC ends -280 bps, deepest
 * drawdown 324 bps, no single minute moves more than 64 bps. Holding
 * through it loses about $28, and trend-following bleeds on the whipsaws
 * inside the fall. The window still has real snap-backs: only 14 bars sit
 * 80+ bps below the 90-bar average, and the dips that do form recover
 * 150+ bps within a few hours. So the bot does almost nothing most of the
 * day and only buys a genuine dip, then banks the snap-back.
 *
 * Rules, all deterministic (integer arithmetic on bar closes, no clock,
 * no network, no randomness):
 *   - Reference: a 120-bar simple moving average of the close, kept as an
 *     exact integer ring buffer. A dip is a close at least 90 bps below it.
 *   - Entry, full cash, one position at a time: on the first bar whose
 *     close is 90+ bps below the 120-bar average, provided the bot is flat,
 *     at least 20 bars have passed since its last exit, and at least 60
 *     bars of the window remain (a late entry cannot outrun the ~26 bps
 *     round-trip cost before the final flatten).
 *   - Exit, the whole position: the first close at least 200 bps above
 *     the average fill price (take profit), or at least 90 bps below it
 *     (hard stop). The average fill comes from the harness's own position
 *     cost (fees included), so the exit lines are anchored on what was
 *     actually paid, not on the close the order was decided on.
 *   - Orders cap slippage at 150 bps from the latest close, far above the
 *     usual 1-minute move, so fills are almost never refused for slipping.
 *     A buy never spends more than the weight room the caps allow.
 *
 * Dev-window result (kit harness, process driver): net PnL +$18.39,
 * 2 trades, max drawdown 0.68%, fees $0.81 (at 2x fees the net is still
 * +$17.58); buy-and-hold on the same window: -$31.63. See README.md for
 * the parameter-neighbour checks.
 */

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const TICKER = 'CBBTC';

/** Bars in the moving-average reference. */
const REF_BARS = 120;
/** Buy when the close sits this far (bps) below the reference average. */
const DIP_BPS = 90;
/** Take profit this far (bps) above the average fill price. */
const PROFIT_BPS = 200;
/** Hard stop this far (bps) below the average fill price. */
const LOSS_BPS = 90;
/** Bars to wait after an exit before looking for a new entry. */
const COOLDOWN_BARS = 20;
/** No new entries once this many scored bars have passed. */
const ENTRY_CUTOFF = 1380;
/** Window length: never order on the final batch. */
const TOTAL_BARS = 1440;
/** Slippage cap on every order, in bps from the latest close. */
const SLIP_CAP_BPS = 150;

/** Ring buffer of closes behind the reference average. */
const ring: number[] = new Array(REF_BARS).fill(0);
let ringHead = 0;
let ringFilled = 0;
let ringTotal = 0;
/** Bars fed so far (warm-up included). */
let barsSeen = 0;
/** Bar count when the last position emptied (-inf before the first). */
let exitBar = -1_000_000_000;
/** Whether the previous batch still held the position. */
let heldLastBatch = false;

/** Average fill price of the held position, in the bar price scale. */
function entryPrice(state: BarsState): number {
  const slot = state.positions.get(TICKER);
  if (slot === undefined || slot.qty === 0n) return 0;
  // cost is quote units (fees included); qty is at qty_scale 8 and the
  // price at price_scale 5 against a quote at scale 6, so the average
  // price is cost * 10^13 / (qty * 10^6), truncated like the harness.
  return Number((slot.cost * 10n ** 13n) / (slot.qty * 10n ** 6n));
}

/** The sell order that closes the whole position, or null to hold. */
function exitOrder(state: BarsState, close: number): SellInput | null {
  const slot = state.positions.get(TICKER);
  if (slot === undefined || slot.qty === 0n) return null;
  const fill = entryPrice(state);
  if (fill <= 0) return null;
  const profitLine = Math.floor((fill * (10_000 + PROFIT_BPS)) / 10_000);
  const lossLine = Math.floor((fill * (10_000 - LOSS_BPS)) / 10_000);
  if (close >= profitLine || close <= lossLine) {
    return { side: 'sell', symbol: TICKER, qty: slot.qty, max_slippage_bps: SLIP_CAP_BPS };
  }
  return null;
}

/** The buy order that opens a full-cash position on a dip, or null. */
function entryOrder(state: BarsState, close: number, reference: number, scored: number): BuyInput | null {
  if (barsSeen - exitBar < COOLDOWN_BARS) return null;
  if (scored >= ENTRY_CUTOFF) return null;
  if (ringFilled < REF_BARS) return null;
  const dipLine = Math.floor((reference * (10_000 - DIP_BPS)) / 10_000);
  if (close > dipLine) return null;
  const room = state.weightRoom(TICKER);
  const stake = state.cash < room ? state.cash : room;
  if (stake <= 0n) return null;
  return { side: 'buy', symbol: TICKER, notional_quote_units: stake, max_slippage_bps: SLIP_CAP_BPS };
}

await runBars({
  onBatch(state, batch) {
    let bar = null;
    for (const candidate of batch.bars) {
      if (candidate.symbol === TICKER) {
        bar = candidate;
        break;
      }
    }
    if (bar === null) return [];
    const close = Number(bar.c);

    // Fold the close into the reference average on every bar, warm-up
    // included, so the average is already seeded when trading starts.
    ringTotal += close - ring[ringHead];
    ring[ringHead] = close;
    ringHead = (ringHead + 1) % REF_BARS;
    if (ringFilled < REF_BARS) ringFilled += 1;
    barsSeen += 1;
    if (state.warmingUp) return [];

    const scored = barsSeen - state.warmupBars;
    if (scored >= TOTAL_BARS) return [];

    const slot = state.positions.get(TICKER);
    const holding = slot !== undefined && slot.qty > 0n;
    if (!holding && heldLastBatch) exitBar = barsSeen;
    heldLastBatch = holding;

    if (holding) {
      const exit = exitOrder(state, close);
      return exit === null ? [] : [exit];
    }
    const reference = Math.floor(ringTotal / REF_BARS);
    const entry = entryOrder(state, close, reference, scored);
    return entry === null ? [] : [entry];
  },
});
