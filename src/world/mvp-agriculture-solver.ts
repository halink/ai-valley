import type { SoilAmounts, SoilRates } from '../shared/mvp-soil.js';
import { SOIL_DENOMINATOR as D, SOIL_KEYS, soilPrefix } from './mvp-soil-solver.js';

type Amounts = SoilAmounts & { cropUse: string };
type Crop = { temperatureFactor: number; progress: string; target: string };
const CAP = 100n * D;
const min = (a: bigint, b: bigint): bigint => a < b ? a : b;
const max = (a: bigint, b: bigint): bigint => a > b ? a : b;

/** Sum max(base + step*k, 0), k=1..count, without visiting microsteps. */
function positiveSum(base: bigint, step: bigint, count: bigint): bigint {
  if (count === 0n) return 0n;
  if (step === 0n) return max(base, 0n) * count;
  let first = 1n, last = count;
  if (step > 0n && base < 0n) first = max(first, (-base) / step + 1n);
  if (step < 0n) {
    if (base <= 0n) return 0n;
    last = min(last, (base - 1n) / (-step));
  }
  if (last < first) return 0n;
  return (last - first + 1n) * (2n * base + step * (first + last)) / 2n;
}

/** Frozen-cell prefix with a still-growing crop throughout. Snow has at most
 * three phases. Soil is a saturated arithmetic progression within each phase.
 * Evaporation has priority over crop use, including the one depletion step. */
function growingPrefix(start: Amounts, rates: SoilRates, duration: bigint, factor: bigint): { amounts: Amounts; growth: bigint } {
  const keys = [...SOIL_KEYS, 'cropUse'] as const;
  const a = Object.fromEntries(keys.map(k => [k, BigInt(start[k])])) as Record<typeof keys[number], bigint>;
  const rain = BigInt(rates.rain), snow = BigInt(rates.snow), melt = BigInt(rates.melt), evap = BigInt(rates.evaporation);
  const use = 10000n * factor;
  let growth = 0n;
  const phase = (ticks: bigint, actualMelt: bigint): void => {
    if (ticks === 0n) return;
    const input = rain + actualMelt, delta = input - evap - use, old = a.water;
    const unbounded = old + delta * ticks;
    const water = min(CAP, max(0n, unbounded));
    let evaporation: bigint;
    if (delta >= 0n) evaporation = evap * ticks;
    else {
      const full = min(ticks, old / (-delta));
      const left = ticks - full;
      evaporation = full * evap;
      if (left > 0n) evaporation += min(evap, old + delta * full + input) + (left - 1n) * min(evap, input);
    }
    const drainage = max(0n, unbounded - CAP);
    a.cropUse += old + input * ticks - water - evaporation - drainage;
    a.evaporation += evaporation;
    a.drainage += drainage;
    a.water = water;
    a.snow += (snow - actualMelt) * ticks;
    a.snowIn += snow * ticks;
    a.rainIn += rain * ticks;
    a.melt += actualMelt * ticks;
    // Clipping water to [0,100D] does not change clamp(W-10D,0,20D).
    growth += factor * (positiveSum(old - 10n * D, delta, ticks) - positiveSum(old - 30n * D, delta, ticks));
  };
  if (snow >= melt) phase(duration, melt);
  else {
    const full = min(duration, a.snow / (melt - snow));
    phase(full, melt);
    let left = duration - full;
    if (left > 0n) { phase(1n, a.snow + snow); left--; }
    phase(left, snow);
  }
  return { amounts: Object.fromEntries(keys.map(k => [k, a[k].toString()])) as unknown as Amounts, growth };
}

/** Exact full-ledger prefix. Growth units have denominator 8000*D. A crop
 * consumes water on its first mature microstep, but never on subsequent ones.
 * The earliest mature offset is relative to this input state; an already mature
 * crop returns 0. No caller-dt approximation or loop proportional to duration.
 * Inputs are immutable; cropUse is cumulative, including when no crop exists. */
export function agriculturePrefix(start: Amounts, rates: SoilRates, duration: bigint, crop: Crop | null): {
  amounts: Amounts; progress: string | null; matureAtOffset: string | null;
} {
  // Reuse the established soil validation and no-crop recurrence.
  const plain = (): Amounts => ({ ...soilPrefix(start, rates, duration), cropUse: start.cropUse });
  if (BigInt(start.cropUse) < 0n) throw Error('agriculture_invalid_crop_use');
  if (crop === null) return { amounts: plain(), progress: null, matureAtOffset: null };
  if (!Number.isInteger(crop.temperatureFactor) || crop.temperatureFactor < 0 || crop.temperatureFactor > 400) throw Error('agriculture_invalid_temperature_factor');
  const progress = BigInt(crop.progress), target = BigInt(crop.target);
  if (progress < 0n || target <= 0n) throw Error('agriculture_invalid_progress');
  soilPrefix(start, rates, 0n);
  if (duration < 0n) throw Error('soil_negative_duration');
  if (progress >= target) return { amounts: plain(), progress: target.toString(), matureAtOffset: '0' };
  const factor = BigInt(crop.temperatureFactor);
  const full = growingPrefix(start, rates, duration, factor);
  if (progress + full.growth < target) return { amounts: full.amounts, progress: (progress + full.growth).toString(), matureAtOffset: null };
  // Growth is monotone. Locate the FIRST mature microstep, including plateaus.
  let low = 1n, high = duration;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (progress + growingPrefix(start, rates, middle, factor).growth >= target) high = middle;
    else low = middle + 1n;
  }
  const mature = growingPrefix(start, rates, low, factor).amounts;
  const tail = soilPrefix(mature, rates, duration - low);
  return { amounts: { ...tail, cropUse: mature.cropUse }, progress: target.toString(), matureAtOffset: low.toString() };
}
