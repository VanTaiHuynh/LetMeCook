import { createTimerCue } from './timerCue';
import { cancelAiRequest } from '../../utils/aiControl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { kitchenRequest } from '../../utils/kitchenApi';
import { timerEvents } from './guidedCooking';

/** One local audio channel for source steps and timer alerts. Cache lives only in this mounted session. */
export default function useGuidedCooking({ identity, sessionId, available = true, text, stepIndex, timers = [], now, householdId, request = kitchenRequest, makeAudio = url => new Audio(url), makeCue = createTimerCue, onStepRead, onStepInterrupted }) {
  const [guided, setGuided] = useState(false);
  const [state, setState] = useState('idle');
  const [notice, setNotice] = useState('');
  const [alerts, setAlerts] = useState([]);
  const queue = useRef([]); const current = useRef(null); const cache = useRef(new Map());
  const cue = useRef(null); const cueBusy = useRef(false); const cueGeneration = useRef(0);
  const seen = useRef(new Set()); const enabled = useRef(false); const active = useRef(true);
  const pumpRef = useRef(null); const context = useRef({ identity, householdId, request, makeAudio, makeCue, sessionId, stepIndex, onStepRead, onStepInterrupted });
  context.current = { identity, householdId, request, makeAudio, makeCue, sessionId, stepIndex, onStepRead, onStepInterrupted };
  const interruptStep = useCallback((job, reason) => {
    if (job?.kind === 'step' && active.current && job.identity === context.current.identity) context.current.onStepInterrupted?.({ identity: job.identity, stepIndex: job.stepIndex, text: job.text, reason });
  }, []);
  const invalidateCue = useCallback(() => { cueGeneration.current++; }, []);
  const stop = useCallback(() => {
    const job = current.current; current.current = null;
    job?.controller.abort(); job?.audio?.pause();
    queue.current = []; setState('idle');
  }, []);
  const pump = useCallback(async () => {
    if (!active.current || current.current || cueBusy.current || !enabled.current || !queue.current.length) return;
    const entry = queue.current.shift(); const controller = new AbortController();
    const job = { ...entry, controller, identity: context.current.identity }; current.current = job; setState('preparing');
    try {
      if (!entry.text || entry.text.length > (entry.kind === 'step' && context.current.sessionId ? 3000 : 2000)) throw new Error('This step is too long for audio. Read the full source step below.');
      let url = cache.current.get(entry.text);
      if (!url) {
        const response = await context.current.request(entry.kind === 'step' && context.current.sessionId ? `/sessions/${context.current.sessionId}/speak` : '/voice/speak', { householdId: context.current.householdId, body: entry.kind === 'step' && context.current.sessionId ? { stepIndex: entry.stepIndex, language: 'en' } : { text: entry.text, language: 'en' }, signal: controller.signal });
        if (controller.signal.aborted || !active.current || current.current !== job || job.identity !== context.current.identity) return;
        if (response.local !== true || !response.audioBase64) throw new Error('Local audio is unavailable. You can continue using the written step.');
        const bytes = Uint8Array.from(atob(response.audioBase64), value => value.charCodeAt(0));
        if (cache.current.size >= 32) { const oldest = cache.current.keys().next().value; URL.revokeObjectURL(cache.current.get(oldest)); cache.current.delete(oldest); }
        url = URL.createObjectURL(new Blob([bytes], { type: response.mimeType || 'audio/wav' })); cache.current.set(entry.text, url);
      }
      if (controller.signal.aborted || !active.current || current.current !== job) return;
      const audio = context.current.makeAudio(url); job.audio = audio;
      const finish = natural => {
        if (current.current !== job || !active.current || job.identity !== context.current.identity) return;
        current.current = null; setState('idle');
        if (natural && !job.paused && job.kind === 'step') context.current.onStepRead?.({ identity: job.identity, stepIndex: job.stepIndex, text: job.text });
        pumpRef.current?.();
      };
      audio.onended = () => finish(true);
      audio.onerror = () => { if (current.current !== job || !active.current) return; setNotice('Could not play local audio. The written instruction and timers still work.'); interruptStep(job, 'audio-error'); finish(false); };
      try { await audio.play(); if (current.current === job && active.current && !job.paused) setState('playing'); }
      catch { if (current.current === job && active.current) { job.paused = true; setState('paused'); setNotice('Press Play to allow audio in this browser.'); interruptStep(job, 'autoplay-blocked'); } }
    } catch (error) {
      if (!controller.signal.aborted && active.current && current.current === job) { setNotice(error.message); interruptStep(job, 'audio-unavailable'); current.current = null; setState('idle'); pumpRef.current?.(); }
    }
  }, [interruptStep]);
  pumpRef.current = pump;
  useEffect(() => {
    const urls = cache.current;
    active.current = true; enabled.current = false; setGuided(false); setAlerts([]); seen.current.clear();
    return () => { active.current = false; enabled.current = false; invalidateCue(); cue.current?.close(); cue.current = null; cueBusy.current = false; stop(); for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); };
  }, [identity, stop, invalidateCue]);
  useEffect(() => {
    if (!enabled.current) return;
    setNotice('');
    const job = current.current;
    if (job?.kind === 'step') { job.controller.abort(); job.audio?.pause(); current.current = null; }
    queue.current = queue.current.filter(entry => entry.kind !== 'step');
    queue.current.push({ kind: 'step', text, stepIndex }); pump();
  }, [stepIndex, text, pump]);
  useEffect(() => {
    const validAlert = entry => entry.kind === 'step' || timers.some(timer => timer.id === entry.timerId && timer.running && !timer.acknowledged && entry.key.startsWith(`${timer.id}:${timer.endsAt}:`)
      && (entry.kind !== 'near' || Date.parse(timer.endsAt) > now));
    queue.current = queue.current.filter(validAlert);
    let invalidated = false;
    if (current.current && !validAlert(current.current)) { current.current.controller.abort(); current.current.audio?.pause(); current.current = null; setState('idle'); invalidated = true; }
    const events = timerEvents(timers, now, seen.current);
    if (events.length) setAlerts(old => [...old, ...events.filter(entry => entry.kind === 'due')]);
    if (!enabled.current || !events.length) { if (invalidated) pump(); return; }
    const due = events.filter(entry => entry.kind === 'due');
    const near = events.filter(entry => entry.kind !== 'due');
    if (due.length) {
      const interrupted = current.current;
      if (interrupted) { interrupted.controller.abort(); interrupted.audio?.pause(); current.current = null; setState('idle'); if (interrupted.kind === 'step') { setNotice('Timer reminder interrupted reading. Replay the step when you are ready.'); interruptStep(interrupted, 'timer'); } }
      queue.current = [...due, ...(interrupted && interrupted.kind !== 'step' ? [{kind:interrupted.kind,key:interrupted.key,timerId:interrupted.timerId,text:interrupted.text}] : []), ...queue.current.filter(entry => entry.kind !== 'step'), ...near];
      const owner = context.current.identity; const generation = cueGeneration.current; cueBusy.current = true;
      Promise.resolve().then(() => cue.current?.beep()).catch(() => { if (active.current && context.current.identity === owner && cueGeneration.current === generation) setNotice('The cue could not play. Written reminders and local spoken reminders are still available.'); }).finally(() => { if (active.current && context.current.identity === owner && cueGeneration.current === generation) { cueBusy.current = false; pumpRef.current?.(); } });
    } else { queue.current.push(...near); pump(); }
  }, [timers, now, pump, interruptStep]);
  const start = () => { if (!available) return; cueGeneration.current++; cue.current?.close(); try { cue.current = context.current.makeCue(); } catch { cue.current = null; } enabled.current = true; setGuided(true); setNotice(''); queue.current.push(...alerts.filter(entry => timers.some(timer => timer.id === entry.timerId && timer.running && !timer.acknowledged)), { kind: 'step', text, stepIndex }); pump(); };
  const pause = () => { const job = current.current; if (job) { job.paused = true; job.audio?.pause(); if (!job.audio) { job.controller.abort(); current.current = null; } } setState('paused'); };
  const play = async () => {
    if (!current.current?.audio) { pump(); return; }
    const job = current.current;
    try { await job.audio.play(); if (current.current === job && active.current) { job.paused = false; setState('playing'); setNotice(''); } }
    catch { if (current.current === job && active.current) { setNotice('Audio could not start. Try Play again, or use the written step.'); interruptStep(job, 'autoplay-blocked'); } }
  };
  const replay = () => {
    const job = current.current;
    if (job?.kind === 'step') { job.controller.abort(); job.audio?.pause(); current.current = null; setState('idle'); }
    queue.current = queue.current.filter(entry => entry.kind !== 'step'); setNotice('');
    queue.current.push({ kind: 'step', text, stepIndex });
    if (job?.kind !== 'step' && job?.paused) void play();
    pump();
  };
  const end = useCallback(() => { cueGeneration.current++; cue.current?.close(); cue.current = null; cueBusy.current = false; void cancelAiRequest(current.current?.controller.signal); enabled.current = false; setGuided(false); stop(); }, [stop]);
  useEffect(() => { if (!available) end(); }, [available, end]);
  return { guided, state, notice, alerts: alerts.filter(item => timers.some(timer => timer.id === item.timerId && timer.running && !timer.acknowledged)), start, pause, play, replay, end };
}
