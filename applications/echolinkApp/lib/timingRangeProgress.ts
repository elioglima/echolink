export function timingRangeProgress(
  value: number,
  min: number,
  max: number
): string {
  if (max <= min) return "0%";
  const p = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, p))}%`;
}
