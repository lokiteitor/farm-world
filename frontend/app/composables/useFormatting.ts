// Presentation of the units of the domain.
//
// Owner: W3-C. Used by the shell and by every panel.
//
// Formatting is centralised for one reason: the units of this domain are not the units the
// player sees, and the conversion is where a figure silently becomes wrong. Money is a
// decimal string with four places and is shown with two; a percentage is stored in basis
// points and is shown out of a hundred; wood is stored in cubic decimetres and is shown in
// cubic metres; a duration is game milliseconds and is shown as hours and days of game
// time. Each of those conversions has exactly one implementation here, and none of them is
// ever applied twice.
//
// Nothing here rounds a value that goes back into a calculation. `Money.toDisplay` exists
// for the interface and the server never returns a formatted amount (plan section 5.3).

import { GAME_HOURS_PER_GAME_DAY, MS_PER_GAME_HOUR, Money, type GameMs } from '~/shared/index';

/** An amount with two decimals and a thousands separator, for the interface only. */
export function formatMoney(amount: Money): string {
  const display = Money.toDisplay(amount);
  const negative = display.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? display.slice(1) : display).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped},${fraction}`;
}

/** An amount as a rate per game hour, which is how every cost of the GDD is expressed. */
export function formatRatePerGameHour(amount: Money): string {
  return `${formatMoney(amount)} / h`;
}

/** A percentage from basis points, with one decimal. */
export function formatBp(value: number, decimals = 1): string {
  return `${(value / 100).toFixed(decimals)} %`;
}

/** A count with a thousands separator. */
export function formatCount(value: number): string {
  return Math.trunc(value).toLocaleString('es-ES');
}

/**
 * A quantity in its display unit. The divisor comes from the catalogue and travels with
 * the inventory line, so the caller passes it rather than knowing it.
 */
export function formatQuantity(units: number, divisor: number, unit: string): string {
  const value = divisor === 1 ? units : units / divisor;
  const decimals = divisor === 1 ? 0 : 2;
  return `${value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${unit}`;
}

/** A duration in game milliseconds, as game hours with one decimal. */
export function formatGameHours(durationGameMs: bigint): string {
  const hours = Number(durationGameMs) / Number(MS_PER_GAME_HOUR);
  return `${hours.toFixed(1)} h`;
}

/**
 * A duration as a countdown of game time: days, hours and minutes, dropping the parts that
 * are zero from the left. A countdown is the most read figure of this interface, so it is
 * kept short rather than complete.
 */
export function formatGameDuration(durationGameMs: bigint): string {
  if (durationGameMs <= 0n) {
    return 'ahora';
  }
  const totalMinutes = Number(durationGameMs / (MS_PER_GAME_HOUR / 60n));
  const days = Math.floor(totalMinutes / (60 * GAME_HOURS_PER_GAME_DAY));
  const hours = Math.floor((totalMinutes % (60 * GAME_HOURS_PER_GAME_DAY)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  }
  return `${minutes} min`;
}

/** The day of the game the instant falls on, counted from an origin (GDD section 61). */
export function formatGameDay(atGameMs: GameMs, startedAtGameMs: GameMs): string {
  const elapsed = atGameMs - startedAtGameMs;
  if (elapsed <= 0n) {
    return 'Dia 1';
  }
  const hours = elapsed / MS_PER_GAME_HOUR;
  const day = Number(hours / BigInt(GAME_HOURS_PER_GAME_DAY)) + 1;
  const hourOfDay = Number(hours % BigInt(GAME_HOURS_PER_GAME_DAY));
  return `Dia ${day} · ${String(hourOfDay).padStart(2, '0')}:00`;
}

/**
 * The time multiplier, read only (GDD section 61, plan section 2.2). It is a server
 * setting and not a control of the player, and a paused world has to say so: a stopped
 * clock and a broken client look the same otherwise.
 */
export function formatRate(rateNum: number, rateDen: number): string {
  if (rateNum === 0) {
    return 'pausado';
  }
  const value = rateNum / rateDen;
  return Number.isInteger(value) ? `${value}x` : `${value.toFixed(2)}x`;
}

/** Everything above, as one object, for a template that wants it in scope. */
export function useFormatting() {
  return {
    formatMoney,
    formatRatePerGameHour,
    formatBp,
    formatCount,
    formatQuantity,
    formatGameHours,
    formatGameDuration,
    formatGameDay,
    formatRate,
  };
}
