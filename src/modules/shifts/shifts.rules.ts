export function shiftInterval(date: string, startTime: string, endTime: string) {
  const start = new Date(`${date}T${startTime}:00-03:00`).getTime();
  let end = new Date(`${date}T${endTime}:00-03:00`).getTime();
  if (end <= start) end += 86_400_000;
  return { start, end };
}

export function shiftsOverlap(
  a: { date: string; startTime: string; endTime: string },
  b: { date: string; startTime: string; endTime: string },
) {
  const first = shiftInterval(a.date, a.startTime, a.endTime);
  const second = shiftInterval(b.date, b.startTime, b.endTime);
  return first.start < second.end && second.start < first.end;
}
