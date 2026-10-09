import { useCallback, useEffect, useRef, useState } from 'react';

const RUNNING = new Set(['reading', 'waiting', 'advancing', 'paused']);
const fresh = () => ({ phase: 'idle', remaining: 0, notice: '', index: null, deadline: null, remainingMs: 0, pausedFrom: null, pending: null });
const timeNow = context => Math.max(Number.isFinite(context.now) ? context.now : 0, Date.now());

/** A reviewed timed sequence. Only a naturally completed source narration starts its wait. */
export default function useCookingFlow({ identity, steps = [], stepIndex = 0, available = true, now, guided, durations = [], onAdvance }) {
  const [state, setState] = useState(fresh);
  const model = useRef(state), generation = useRef(0), mounted = useRef(true);
  const context = useRef(null);
  const sourceKey = JSON.stringify(steps);
  context.current = { identity, steps, stepIndex, available, now, guided, durations, onAdvance, sourceKey };
  const publish = useCallback(next => { model.current = next; if (mounted.current) setState(next); }, []);
  const invalidate = useCallback(() => { generation.current++; model.current.pending?.controller.abort(); }, []);
  const fail = useCallback(message => {
    invalidate(); publish({ ...fresh(), phase: 'error', notice: message }); context.current.guided?.end();
  }, [invalidate, publish]);
  const stop = useCallback(() => {
    const wasRunning = RUNNING.has(model.current.phase); invalidate(); publish(fresh());
    if (wasRunning) context.current.guided?.end();
  }, [invalidate, publish]);
  useEffect(() => {
    mounted.current = true; publish(fresh());
    return () => { const wasRunning = RUNNING.has(model.current.phase); mounted.current = false; invalidate(); model.current = fresh(); if (wasRunning) context.current.guided?.end(); };
  }, [identity, invalidate, publish]);

  const start = useCallback(() => {
    const ctx = context.current;
    if (!ctx.available || !ctx.steps.length || !Number.isInteger(ctx.stepIndex) || ctx.stepIndex < 0 || ctx.stepIndex >= ctx.steps.length) return false;
    if (ctx.durations.length !== ctx.steps.length || ctx.durations.some(seconds => !Number.isInteger(seconds) || seconds < 0 || seconds > 86400)) { fail('Review each step time: zero to 24 hours.'); return false; }
    invalidate(); ctx.guided?.end();
    publish({ ...fresh(), phase: 'reading', index: ctx.stepIndex, owner: ctx.identity, sourceKey: ctx.sourceKey, times: [...ctx.durations] });
    ctx.guided?.start(); return true;
  }, [fail, invalidate, publish]);
  const onStepRead = useCallback(event => {
    const current = model.current, ctx = context.current;
    if (current.phase !== 'reading' || current.owner !== ctx.identity || event.identity !== ctx.identity || event.stepIndex !== current.index || ctx.stepIndex !== current.index || current.sourceKey !== ctx.sourceKey) return;
    const remainingMs = current.times[current.index] * 1000;
    publish({ ...current, phase: 'waiting', deadline: timeNow(ctx) + remainingMs, remainingMs, remaining: Math.ceil(remainingMs / 1000), notice: '' });
  }, [publish]);
  const onStepInterrupted = useCallback(event => {
    const current = model.current, ctx = context.current;
    if (current.phase !== 'reading' || event.identity !== current.owner || current.owner !== ctx.identity || event.stepIndex !== current.index) return;
    publish({ ...current, phase: 'paused', pausedFrom: 'reading', notice: event.reason === 'timer' ? 'A timer interrupted this step. Resume when you are ready.' : 'Reading stopped. Resume to replay this step.' });
  }, [publish]);
  const pause = useCallback(() => {
    const current = model.current;
    if (!RUNNING.has(current.phase) || current.phase === 'paused') return;
    const remainingMs = current.phase === 'waiting' ? Math.max(0, current.deadline - timeNow(context.current)) : current.remainingMs;
    publish({ ...current, phase: 'paused', pausedFrom: current.phase, deadline: null, remainingMs, remaining: Math.ceil(remainingMs / 1000), notice: '' });
    context.current.guided?.pause();
  }, [publish]);
  const resume = useCallback(() => {
    const current = model.current, ctx = context.current;
    if (current.phase !== 'paused' || !ctx.available || current.owner !== ctx.identity) return false;
    if (current.pausedFrom === 'advancing') { publish({ ...current, notice: 'Wait for the current step to save before resuming.' }); return false; }
    if (current.pausedFrom === 'waiting') {
      publish({ ...current, phase: 'waiting', deadline: timeNow(ctx) + current.remainingMs, pausedFrom: null, notice: '' });
      void ctx.guided?.play();
    } else {
      publish({ ...current, phase: 'reading', pausedFrom: null, notice: '' }); ctx.guided?.replay();
    }
    return true;
  }, [publish]);
  const advance = useCallback(async () => {
    const current = model.current, ctx = context.current;
    if (current.phase !== 'waiting' || current.owner !== ctx.identity || current.deadline > timeNow(ctx)) return;
    if (current.index === ctx.steps.length - 1) { publish({ ...current, phase: 'completed', remaining: 0, deadline: null, notice: 'Reading complete. Check your meal before confirming it.' }); ctx.guided?.end(); return; }
    const controller = new AbortController(), token = generation.current, nextIndex = current.index + 1;
    const pending = { controller, nextIndex, finished: false };
    publish({ ...current, phase: 'advancing', remaining: 0, deadline: null, pending });
    try {
      const response = await ctx.onAdvance?.(nextIndex, { signal: controller.signal, identity: ctx.identity, fromStepIndex: current.index });
      if (!mounted.current || controller.signal.aborted || generation.current !== token || context.current.identity !== ctx.identity || model.current.pending !== pending) return;
      if (!response || (Number.isInteger(response.stepIndex) && response.stepIndex !== nextIndex)) throw new Error('The next step could not be saved. Reload the session before restarting.');
      pending.finished = true;
      if (context.current.stepIndex === nextIndex) {
        const paused = model.current.phase === 'paused';
        publish({ ...model.current, phase: paused ? 'paused' : 'reading', pausedFrom: paused ? 'reading' : null, index: nextIndex, pending: null, notice: '' });
      } else publish({ ...model.current });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && generation.current === token && context.current.identity === ctx.identity && model.current.pending === pending) fail(error.message || 'The next step could not be saved. Restart after checking the session.');
    }
  }, [fail, publish]);

  useEffect(() => {
    const current = model.current, ctx = context.current;
    if (!RUNNING.has(current.phase)) return;
    if (!available) { fail('Cooking guidance is unavailable. Check the recipe before restarting.'); return; }
    if (current.owner !== identity || current.sourceKey !== sourceKey) { fail('Recipe instructions changed. Restart the timed flow.'); return; }
    if (current.pending && stepIndex === current.pending.nextIndex) {
      if (current.phase === 'paused') ctx.guided?.pause();
      if (current.pending.finished) { const paused = current.phase === 'paused'; publish({ ...current, phase: paused ? 'paused' : 'reading', pausedFrom: paused ? 'reading' : null, index: stepIndex, pending: null, notice: '' }); }
      return;
    }
    if (stepIndex !== current.index) { fail('The current step changed. Restart the timed flow from this step.'); return; }
    if (current.phase === 'waiting') {
      const remainingMs = Math.max(0, current.deadline - timeNow(ctx));
      const remaining = Math.ceil(remainingMs / 1000);
      if (remaining !== current.remaining) publish({ ...current, remaining, remainingMs });
      if (remainingMs === 0) void advance();
    }
  }, [now, identity, sourceKey, stepIndex, available, state.phase, state.pending, advance, fail, publish]);

  return { phase: state.phase, remaining: state.remaining, notice: state.notice, active: RUNNING.has(state.phase), start, pause, resume, stop, onStepRead, onStepInterrupted };
}
