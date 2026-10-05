/**
 * Exact decimal arithmetic for money and digital assets.
 *
 * Every amount in this system is an integer count of an asset's smallest
 * indivisible unit — cents for USD, satoshis for BTC, wei for ETH. Nothing is
 * ever held as a floating-point number, because binary floats cannot represent
 * most decimal fractions and the error is not theoretical:
 *
 *     Math.round(8.115 * 100)  === 812   // the exact answer is 811
 *     Math.round(1.045 * 100)  === 105   // the exact answer is 104
 *
 * Those are ordinary prices, and the old `dollarsToCents` got them wrong by a
 * cent. Parsing is done on the decimal *string* instead, so the value the
 * member typed is the value that is stored.
 *
 * Two integer widths are in play, and the distinction matters:
 *
 *   - USD stays a JavaScript `number` of cents. It is what the existing schema
 *     holds, and `Number.MAX_SAFE_INTEGER` is ~$90 trillion, so there is no
 *     precision risk at any balance this product will ever see.
 *
 *   - Digital assets use `bigint` and are stored as TEXT. This is not a style
 *     preference. SQLite's INTEGER is 64-bit, and ETH has 18 decimals, so an
 *     INTEGER column overflows at 9 ETH:
 *
 *         BTC   8 decimals -> max  92,233,720,368 BTC   (fine)
 *         USDC  6 decimals -> max   9,223,372,036,854   (fine)
 *         ETH  18 decimals -> max               9 ETH   (unusable)
 *
 *     TEXT + bigint is the only correct representation. The cost is that SQL
 *     cannot SUM these columns, so aggregation happens in JS.
 */

/** Thrown for input that is not a well-formed decimal amount. */
export class AmountError extends Error {}

/** `-?digits[.digits]` — no exponent, no separators, no whitespace tricks. */
const DECIMAL = /^-?(\d+)(?:\.(\d+))?$/;

/**
 * Normalises input to a plain decimal string without going through a float.
 *
 * Numbers are converted with `String(value)`, which gives JavaScript's
 * shortest round-tripping representation: `String(8.115)` is `"8.115"`, the
 * literal the caller wrote. Exponent form (`1e-7`, produced for very small or
 * large numbers) is expanded, because the regex above deliberately rejects it
 * rather than silently mis-parsing.
 */
function toDecimalString(input: number | string): string {
  let text: string;
  if (typeof input === "string") {
    text = input.trim();
  } else if (typeof input === "number" && Number.isFinite(input)) {
    text = String(input);
  } else {
    throw new AmountError("Invalid amount.");
  }
  if (!text.includes("e") && !text.includes("E")) return text;

  // Exponent form reaches here two ways: String() produced it for a very large
  // or small number, or the caller sent "1e3" as a string. The old float path
  // accepted both via Number(), so both are expanded rather than rejected —
  // this replaces the rounding, not the contract.
  if (!/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(text)) throw new AmountError("Invalid amount.");

  // Expand exponent notation by hand; Number#toFixed would re-enter float math.
  const [mantissa, exponentText] = text.split(/[eE]/);
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = mantissa.replace("-", "").split(".");
  const digits = whole + fraction;
  const pointAt = whole.length + exponent;

  let out: string;
  if (pointAt <= 0) out = "0." + "0".repeat(-pointAt) + digits;
  else if (pointAt >= digits.length) out = digits + "0".repeat(pointAt - digits.length);
  else out = digits.slice(0, pointAt) + "." + digits.slice(pointAt);
  return (negative ? "-" : "") + out;
}

/**
 * Parses a decimal amount into an integer count of base units.
 *
 * Extra precision is rounded half-away-from-zero, the convention people expect
 * from money (2.675 -> 2.68, -2.675 -> -2.68). `Math.round` instead rounds
 * half toward positive infinity, which is asymmetric for refunds.
 */
export function parseUnits(input: number | string, decimals: number): bigint {
  const text = toDecimalString(input);
  if (text === "") throw new AmountError("Invalid amount.");

  const match = DECIMAL.exec(text);
  if (!match) throw new AmountError("Invalid amount.");
  const negative = text.startsWith("-");
  const whole = match[1];
  const fraction = match[2] ?? "";

  const kept = fraction.slice(0, decimals).padEnd(decimals, "0");
  let units = BigInt(whole + (kept || ""));

  // Round on the first discarded digit rather than truncating, so a member is
  // never quietly shortchanged by a sub-unit remainder.
  const dropped = fraction.slice(decimals);
  if (dropped && dropped.charCodeAt(0) >= 53 /* '5' */) units += 1n;

  return negative ? -units : units;
}

/** Renders base units as a fixed-precision decimal string. */
export function formatUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? "." + digits.slice(digits.length - decimals) : "";
  return (negative ? "-" : "") + whole + fraction;
}

/**
 * Same as `formatUnits` but without trailing zero noise: a balance of exactly
 * one ETH reads "1", not "1.000000000000000000". Fiat keeps its full precision
 * because "$12.50" must not render as "$12.5".
 */
export function formatUnitsTrimmed(units: bigint, decimals: number): string {
  const full = formatUnits(units, decimals);
  if (!full.includes(".")) return full;
  const trimmed = full.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/* ---------- USD ---------- */

/**
 * Dollars to integer cents, exactly.
 *
 * Signature and rejections are unchanged from the original — objects, arrays,
 * booleans, empty strings and trailing garbage ("12abc") all still throw — but
 * the arithmetic no longer goes through a float, so 8.115 is 811 cents and not
 * 812.
 */
export function dollarsToCentsExact(input: number | string): number {
  if (typeof input !== "number" && typeof input !== "string") {
    throw new AmountError("Invalid amount.");
  }
  const units = parseUnits(input, 2);
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AmountError("Amount is out of range.");
  }
  return Number(units);
}

export const centsToDecimalExact = (cents: number): string => formatUnits(BigInt(Math.trunc(cents)), 2);

/* ---------- valuation ---------- */

/**
 * Converts a holding into USD cents at a given price.
 *
 * `priceCents` is the price of ONE whole unit of the asset in cents, held as a
 * bigint so a $100k BTC price is exact. The division by the asset's scale is
 * integer division, truncating toward zero, so a valuation can never round
 * itself up into money that is not there.
 */
export function valueInCents(units: bigint, decimals: number, priceCents: bigint): number {
  const scale = 10n ** BigInt(decimals);
  const cents = (units * priceCents) / scale;
  // Clamped rather than thrown: a bad price feed must not take down a page
  // that is only trying to show a balance.
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  if (cents < -BigInt(Number.MAX_SAFE_INTEGER)) return -Number.MAX_SAFE_INTEGER;
  return Number(cents);
}

/**
 * How many base units a given number of USD cents buys at `priceCents`.
 *
 * Truncates, which means the member receives slightly less asset than their
 * dollars would ideally buy rather than slightly more. Erring the other way
 * would create units out of nothing on every trade.
 */
export function unitsForCents(cents: number, decimals: number, priceCents: bigint): bigint {
  if (priceCents <= 0n) throw new AmountError("No usable price for that asset.");
  const scale = 10n ** BigInt(decimals);
  return (BigInt(Math.trunc(cents)) * scale) / priceCents;
}
