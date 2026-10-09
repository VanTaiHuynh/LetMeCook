/** Read explicit numeric durations only. Ranges and temperatures are never converted to a guessed timer. */
export function sourceDurations(text = '') {
  const found = [];
  const source = String(text);
  const units = '(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)';
  // Unsupported fractions and complete ranges stay in the source instruction;
  // neither a fraction denominator nor a range endpoint becomes a timer.
  const unsupported = [
    /\b(?:\d+\s+)?\d+\s*[/⁄]\s*\d+/g,
    new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*(?:${units}\\s*)?(?:[-–—]|to\\s*)\\s*\\d+(?:\\.\\d+)?\\s*(?:${units}\\b)?`, 'gi'),
  ].flatMap(pattern => [...source.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length })));
  const pattern = /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  for (const match of source.matchAll(pattern)) {
    if (unsupported.some(span => match.index < span.end && match.index + match[0].length > span.start)
        || /[-–—/⁄]\s*$|(?:\d[.,]|\.)$/.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
    const multiplier = /^h/i.test(match[2]) ? 3600 : /^m/i.test(match[2]) ? 60 : 1;
    const seconds = Number(match[1]) * multiplier;
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 && !found.some(item => item.seconds === seconds)) found.push({ seconds, label: match[0] });
  }
  return found.slice(0, 4);
}

export function timerEvents(timers, now, seen) {
  const events = [];
  for (const timer of timers || []) {
    if (!timer.running || timer.acknowledged || !timer.endsAt) continue;
    const end = Date.parse(timer.endsAt);
    if (!Number.isFinite(end)) continue;
    const remaining = Math.ceil((end - now) / 1000);
    const key = `${timer.id}:${timer.endsAt}`;
    const phase = remaining <= 0 ? 'due' : remaining <= 30 && timer.durationSeconds >= 60 ? 'near' : null;
    if (!phase || seen.has(`${key}:${phase}`)) continue;
    seen.add(`${key}:${phase}`);
    // Returning from a suspended tab emits the due alert, never a stale near alert.
    if (phase === 'due') seen.add(`${key}:near`);
    events.push({ key: `${key}:${phase}`, kind: phase, timerId: timer.id,
      text: phase === 'due' ? `${timer.label} timer finished. Check the recipe and your food before continuing.` : `${timer.label}: thirty seconds or less remaining.` });
  }
  return events;
}
