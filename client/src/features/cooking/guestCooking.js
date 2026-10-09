const prefix = 'letmecook.cooking.tab.v1.';

export function guestCookingProgress(source, storage = globalThis.sessionStorage) {
  let saved;
  try { saved = JSON.parse(storage.getItem(`${prefix}${source.recipeId}`)); } catch { /* An unavailable browser store still permits cooking. */ }
  const fresh = { recipeId: source.recipeId, recipeVersion: source.recipeVersion, stepIndex: 0, timers: [], status: 'active' };
  if (!saved || saved.recipeVersion !== source.recipeVersion) return fresh;
  const stepIndex = Number.isInteger(saved.stepIndex) && saved.stepIndex >= 0 && saved.stepIndex < source.steps.length ? saved.stepIndex : 0;
  const timers = Array.isArray(saved.timers) ? saved.timers.slice(0, 20).filter(timer => typeof timer.id === 'string' && timer.id.length <= 80
    && typeof timer.label === 'string' && timer.label.length <= 100 && Number.isInteger(timer.durationSeconds) && timer.durationSeconds > 0 && timer.durationSeconds <= 86400
    && (timer.endsAt === null || (typeof timer.endsAt === 'string' && Number.isFinite(Date.parse(timer.endsAt))))
    && typeof timer.running === 'boolean' && (!timer.running || timer.endsAt !== null)) : [];
  return { ...fresh, stepIndex, timers, status: saved.status === 'completed' ? 'completed' : 'active', completedAt: saved.completedAt };
}

export function saveGuestCooking(progress, storage = globalThis.sessionStorage) {
  try { storage.setItem(`${prefix}${progress.recipeId}`, JSON.stringify({ ...progress, updatedAt: Date.now() })); return true; }
  catch { return false; }
}

export function timerCueBody(text) {
  const due = ' timer finished. Check the recipe and your food before continuing.';
  const near = ': thirty seconds or less remaining.';
  if (text.endsWith(due)) return { label: text.slice(0, -due.length), phase: 'due' };
  if (text.endsWith(near)) return { label: text.slice(0, -near.length), phase: 'near' };
  throw new Error('Choose a cooking timer reminder.');
}
