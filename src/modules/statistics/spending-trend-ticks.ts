/** A zero-based USD scale with at most six ticks, including cent-sized and empty ranges. */
export function pickMoneyTicks(maxValue: number): number[] {
  const maximum = Number.isFinite(maxValue) ? Math.max(0.04, maxValue) : 0.04;
  const targetStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const multiplier = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= targetStep) ?? 10;
  const step = multiplier * magnitude;
  const intervals = Math.ceil(maximum / step);

  // At the edge of Number's range, a rounded-up domain can overflow even for finite data.
  if (!Number.isFinite(intervals * step)) {
    return [0, maximum / 4, maximum / 2, maximum * 0.75, maximum];
  }

  const ticks = Array.from({ length: intervals + 1 }, (_, index) =>
    Number((index * step).toPrecision(15)),
  );
  ticks[ticks.length - 1] = Math.max(ticks[ticks.length - 1], maximum);
  return ticks;
}
