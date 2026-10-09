import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useCookingFlow from '../../src/features/cooking/useCookingFlow';
import useGuidedCooking from '../../src/features/cooking/useGuidedCooking';
vi.mock('../../src/utils/kitchenApi', () => ({ kitchenRequest: vi.fn() }));
vi.mock('../../src/utils/aiControl', () => ({ cancelAiRequest: vi.fn() }));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let audios, request, makeAudio, props;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); audios = [];
  request = vi.fn(async () => ({ local: true, audioBase64: 'UklGRg==', mimeType: 'audio/wav' }));
  makeAudio = vi.fn(() => { const audio = { play: vi.fn(async () => {}), pause: vi.fn() }; audios.push(audio); return audio; });
  props = { now: 0, timers: [] };
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:fixture-${Math.random()}`), revokeObjectURL: vi.fn() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const steps = ['Stir.', 'Rest.', 'Serve.'];
const makeCue = () => ({ beep: vi.fn(async () => {}), close: vi.fn() });
function useSequence({ now, timers }) {
  const [index, setIndex] = useState(0), flowRef = useRef(null);
  const guided = useGuidedCooking({ identity: 'guest:recipe:v1', sessionId: 'recipe', text: steps[index], stepIndex: index, now, timers, request, makeAudio, makeCue,
    onStepRead: event => flowRef.current?.onStepRead(event), onStepInterrupted: event => flowRef.current?.onStepInterrupted(event) });
  const flow = useCookingFlow({ identity: 'guest:recipe:v1', steps, stepIndex: index, available: true, now, guided, durations: [2, 1, 0], onAdvance: (next, { signal }) => { if (signal.aborted) return false; setIndex(next); return true; } });
  flowRef.current = flow;
  return { guided, flow, index };
}
const clock = async (view, now, changes = {}) => { vi.setSystemTime(now); props = { ...props, ...changes, now }; await act(async () => { view.rerender(props); await flush(); }); };
describe('source narration and timed flow integration', () => {
  it('reads each new step only after its predecessor narration and wait, without automatically confirming a meal', async () => {
    const view = renderHook(useSequence, { initialProps: props }); await act(async () => { view.result.current.flow.start(); await flush(); });
    expect(audios).toHaveLength(1); await clock(view, 10000); expect(view.result.current.index).toBe(0);
    act(() => audios[0].onended()); await clock(view, 11999); expect(view.result.current.index).toBe(0);
    await clock(view, 12000); expect(view.result.current.index).toBe(1); expect(view.result.current.flow.phase).toBe('reading'); expect(audios).toHaveLength(2);
    expect(request.mock.calls[1][1].body.stepIndex).toBe(1);
    act(() => audios[1].onended()); await clock(view, 13000); expect(view.result.current.index).toBe(2); expect(audios).toHaveLength(3);
    await act(async () => { audios[2].onended(); await flush(); }); expect(view.result.current.flow.phase).toBe('completed');
    expect(request).toHaveBeenCalledTimes(3); expect(request.mock.calls.every(([path]) => path.endsWith('/speak'))).toBe(true);
  });
  it('pauses flow when a due timer interrupts a source, and resumes the source after the alarm finishes', async () => {
    props.timers = [{ id: 'rest', label: 'Rest', endsAt: new Date(1000).toISOString(), running: true, durationSeconds: 1 }];
    const view = renderHook(useSequence, { initialProps: props }); await act(async () => { view.result.current.flow.start(); await flush(); });
    await clock(view, 2000); expect(view.result.current.flow.phase).toBe('paused'); expect(audios).toHaveLength(2);
    act(() => audios[0].onended()); expect(view.result.current.flow.phase).toBe('paused');
    await act(async () => { view.result.current.flow.resume(); await flush(); }); expect(audios).toHaveLength(2); expect(audios[1].pause).not.toHaveBeenCalled();
    await act(async () => { audios[1].onended(); await flush(); }); expect(audios).toHaveLength(3); expect(view.result.current.flow.phase).toBe('reading');
    act(() => audios[2].onended()); await clock(view, 3999); expect(view.result.current.index).toBe(0);
    await clock(view, 4000); expect(view.result.current.index).toBe(1);
  });
});
