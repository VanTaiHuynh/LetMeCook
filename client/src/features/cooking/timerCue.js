/** Short cue unlocked only by the user's Start action; no network or system notification permission. */
export function createTimerCue() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return { beep: async () => {}, close: () => {} };
  const context = new Context(); void context.resume().catch(() => {});
  let oscillator = null; let pending = null;
  return {
    beep() {
      if (pending) return pending;
      if (context.state !== 'running') return Promise.resolve();
      pending = new Promise(resolve => {
        oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.frequency.value = 740; gain.gain.value = .12; oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); oscillator = null; pending = null; resolve(); };
        oscillator.start(); oscillator.stop(context.currentTime + .25);
      });
      return pending;
    },
    close() { try { oscillator?.stop(); } catch { /* Already stopped. */ } void context.close().catch(() => {}); },
  };
}
