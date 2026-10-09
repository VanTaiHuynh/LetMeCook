import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useCookingFlow from '../../src/features/cooking/useCookingFlow';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let props;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  props = { identity: 'guest:recipe-a:v1', steps: ['Simmer.', 'Stir.', 'Serve.'], stepIndex: 0, available: true, now: 0, durations: [10, 5, 0],
    guided: { start: vi.fn(), end: vi.fn(), pause: vi.fn(), play: vi.fn(async () => {}), replay: vi.fn() }, onAdvance: vi.fn(async () => true) };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = () => renderHook(value => useCookingFlow(value), { initialProps: props });
const read = (view, stepIndex = props.stepIndex, identity = props.identity) => act(() => view.result.current.onStepRead({ identity, stepIndex }));
const clock = async (view, now, changes = {}) => { vi.setSystemTime(now); props = { ...props, ...changes, now }; await act(async () => { view.rerender(props); await flush(); }); };

describe('reviewed timed cooking flow', () => {
  it('waits for natural source narration, then its full duration, and never skips unheard steps after a background jump', async () => {
    const view = mount(); act(() => view.result.current.start());
    await clock(view, 20000); expect(props.onAdvance).not.toHaveBeenCalled(); expect(view.result.current.phase).toBe('reading');
    read(view); expect(view.result.current.remaining).toBe(10);
    await clock(view, 29999); expect(props.onAdvance).not.toHaveBeenCalled(); expect(view.result.current.remaining).toBe(1);
    await clock(view, 30000); expect(props.onAdvance).toHaveBeenCalledTimes(1); expect(props.onAdvance.mock.calls[0][0]).toBe(1);
    expect(view.result.current.phase).toBe('advancing');
    await clock(view, 30000, { stepIndex: 1 }); expect(view.result.current.phase).toBe('reading');
    await clock(view, 300000); expect(props.onAdvance).toHaveBeenCalledTimes(1);
    read(view); await clock(view, 304999); expect(props.onAdvance).toHaveBeenCalledTimes(1);
    await clock(view, 305000); expect(props.onAdvance).toHaveBeenCalledTimes(2); expect(props.onAdvance.mock.calls[1][0]).toBe(2);
  });
  it('starts the wait from the actual audio-ended time rather than a stale one-second display clock', async () => {
    const view = mount(); act(() => view.result.current.start()); vi.setSystemTime(750); read(view);
    await clock(view, 10000); expect(props.onAdvance).not.toHaveBeenCalled();
    await clock(view, 10750); expect(props.onAdvance).toHaveBeenCalledTimes(1);
  });
  it('freezes the exact remaining wait during pause and resumes without counting paused time', async () => {
    const view = mount(); act(() => view.result.current.start()); read(view); await clock(view, 4250);
    act(() => view.result.current.pause()); expect(view.result.current.phase).toBe('paused'); expect(view.result.current.remaining).toBe(6);
    await clock(view, 300000); expect(props.onAdvance).not.toHaveBeenCalled(); expect(view.result.current.remaining).toBe(6);
    act(() => view.result.current.resume()); await clock(view, 305749); expect(props.onAdvance).not.toHaveBeenCalled();
    await clock(view, 305750); expect(props.onAdvance).toHaveBeenCalledTimes(1);
  });
  it('halts on an interrupted reading and only a replayed natural completion restarts its wait', async () => {
    const view = mount(); act(() => view.result.current.start());
    act(() => view.result.current.onStepInterrupted({ identity: props.identity, stepIndex: 0, reason: 'timer' }));
    expect(view.result.current.phase).toBe('paused'); expect(view.result.current.notice).toContain('timer');
    read(view); await clock(view, 100000); expect(props.onAdvance).not.toHaveBeenCalled();
    act(() => view.result.current.resume()); expect(props.guided.replay).toHaveBeenCalledTimes(1); expect(view.result.current.phase).toBe('reading');
    read(view); await clock(view, 110000); expect(props.onAdvance).toHaveBeenCalledTimes(1);
  });
  it.each([false, undefined, { stepIndex: 0 }])('halts an unsuccessful or conflicting advance (%j) without retrying another step', async response => {
    props.onAdvance = vi.fn(async () => response); const view = mount(); act(() => view.result.current.start()); read(view);
    await clock(view, 10000); expect(view.result.current.phase).toBe('error'); expect(view.result.current.active).toBe(false);
    await clock(view, 100000); expect(props.onAdvance).toHaveBeenCalledTimes(1); expect(props.guided.end).toHaveBeenCalledTimes(2);
  });
  it('reports an advance exception and never confirms a cooked meal', async () => {
    props.onAdvance = vi.fn(async () => { throw new Error('Session changed. Reload it.'); }); const view = mount(); act(() => view.result.current.start()); read(view);
    await clock(view, 10000); expect(view.result.current.phase).toBe('error'); expect(view.result.current.notice).toBe('Session changed. Reload it.');
    expect(Object.keys(view.result.current)).not.toContain('completeMeal');
  });
  it('cancels in-flight advance when identity changes and ignores its late result and old narration', async () => {
    let resolve; props.onAdvance = vi.fn(() => new Promise(done => { resolve = done; })); const view = mount(); act(() => view.result.current.start()); read(view);
    await clock(view, 10000); const signal = props.onAdvance.mock.calls[0][1].signal; const oldIdentity = props.identity;
    await clock(view, 10001, { identity: 'signed-in:other-household:recipe-b' }); expect(signal.aborted).toBe(true); expect(view.result.current.phase).toBe('idle');
    await act(async () => { resolve({ stepIndex: 1 }); await flush(); }); read(view, 0, oldIdentity);
    expect(view.result.current.phase).toBe('idle'); await clock(view, 200000); expect(props.onAdvance).toHaveBeenCalledTimes(1);
  });
  it('stops pending work on unmount and never schedules a following step from a late result', async () => {
    let resolve; props.onAdvance = vi.fn(() => new Promise(done => { resolve = done; })); const view = mount(); act(() => view.result.current.start()); read(view); await clock(view, 10000);
    const signal = props.onAdvance.mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(true); await flush(); }); expect(props.onAdvance).toHaveBeenCalledTimes(1);
  });
  it('finishes the final reviewed wait without advancing or confirming meal or pantry', async () => {
    props.stepIndex = 2; props.durations = [10, 5, 3]; const view = mount(); act(() => view.result.current.start()); read(view);
    await clock(view, 2999); expect(view.result.current.phase).toBe('waiting');
    await clock(view, 3000); expect(view.result.current.phase).toBe('completed'); expect(view.result.current.notice).toContain('Reading complete'); expect(props.onAdvance).not.toHaveBeenCalled(); expect(view.result.current.active).toBe(false);
  });
  it('zero wait advances only after narration; invalid or incomplete reviewed timings cannot start', async () => {
    props.durations = [0, 5, 0]; const view = mount(); act(() => view.result.current.start()); expect(props.onAdvance).not.toHaveBeenCalled();
    await act(async () => { view.result.current.onStepRead({ identity: props.identity, stepIndex: 0 }); await flush(); }); expect(props.onAdvance).toHaveBeenCalledTimes(1);
    act(() => view.result.current.stop()); await clock(view, 1, { durations: [0, -1] }); act(() => view.result.current.start()); expect(view.result.current.phase).toBe('error'); expect(props.guided.start).toHaveBeenCalledTimes(1);
  });
  it('keeps manual guidance intact when no timed flow is active, and stops when its source changes', async () => {
    const view = mount(); act(() => view.result.current.stop()); expect(props.guided.end).not.toHaveBeenCalled();
    act(() => view.result.current.start()); await clock(view, 1, { steps: ['Changed instruction.', 'Stir.', 'Serve.'] }); expect(view.result.current.phase).toBe('error'); expect(props.onAdvance).not.toHaveBeenCalled();
  });
});
