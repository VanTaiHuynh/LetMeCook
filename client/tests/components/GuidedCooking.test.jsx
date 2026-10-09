import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import useGuidedCooking from '../../src/features/cooking/useGuidedCooking';
import { sourceDurations, timerEvents } from '../../src/features/cooking/guidedCooking';
vi.mock('../../src/utils/kitchenApi', () => ({ kitchenRequest: vi.fn() }));
vi.mock('../../src/utils/aiControl', () => ({ cancelAiRequest: vi.fn() }));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let audios; let request; let makeAudio;
beforeEach(() => {
  audios = []; request = vi.fn(async () => ({ local: true, audioBase64: 'UklGRg==', mimeType: 'audio/wav' }));
  makeAudio = vi.fn(() => { const audio = { play: vi.fn(async () => {}), pause: vi.fn() }; audios.push(audio); return audio; });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:fixture-${Math.random()}`), revokeObjectURL: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('guided local cooking', () => {
  it('emits source completion only for natural step audio ending, never a failed audio or alert', async () => {
    const onStepRead = vi.fn(), onStepInterrupted = vi.fn();
    const props = { identity: 'guest:recipe:v1', text: 'Stir the sauce.', stepIndex: 0, timers: [], now: 0, request, makeAudio, onStepRead, onStepInterrupted };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props });
    await act(async () => { view.result.current.start(); await flush(); });
    act(() => audios[0].onerror()); expect(onStepRead).not.toHaveBeenCalled(); expect(onStepInterrupted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'audio-error', stepIndex: 0 }));
    await act(async () => { view.result.current.replay(); await flush(); }); act(() => audios[1].onended());
    expect(onStepRead).toHaveBeenCalledTimes(1); expect(onStepRead).toHaveBeenCalledWith({ identity: props.identity, text: props.text, stepIndex: 0 });
    view.rerender({ ...props, now: 2000, timers: [{ id: 'rest', label: 'Rest', endsAt: new Date(1000).toISOString(), running: true, durationSeconds: 1 }] }); await act(flush);
    act(() => audios.at(-1).onended()); expect(onStepRead).toHaveBeenCalledTimes(1);
  });
  it('blocks source completion on autoplay rejection and reports narration fetch failures', async () => {
    const onStepRead = vi.fn(), onStepInterrupted = vi.fn();
    const rejectedAudio = vi.fn(() => { const audio = { play: vi.fn(async () => { throw new Error('Blocked'); }), pause: vi.fn() }; audios.push(audio); return audio; });
    const props = { identity: 'guest:recipe:v1', text: 'Stir.', stepIndex: 0, timers: [], now: 0, request, makeAudio: rejectedAudio, onStepRead, onStepInterrupted };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props }); await act(async () => { view.result.current.start(); await flush(); });
    expect(onStepInterrupted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'autoplay-blocked' }));
    act(() => audios[0].onended()); expect(onStepRead).not.toHaveBeenCalled();
    view.rerender({ ...props, text: 'New instruction.', stepIndex: 1, request: vi.fn(async () => { throw new Error('Voice unavailable'); }) }); await act(flush);
    expect(onStepInterrupted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'audio-unavailable', stepIndex: 1 })); expect(onStepRead).not.toHaveBeenCalled();
  });
  it('replays an interrupted source behind a current alarm instead of dropping or overlapping its speech', async () => {
    const onStepRead = vi.fn(), onStepInterrupted = vi.fn();
    const props = { identity: 'guest:recipe:v1', text: 'Stir.', stepIndex: 0, timers: [{ id: 'rest', label: 'Rest', endsAt: new Date(1000).toISOString(), running: true, durationSeconds: 1 }], now: 0, request, makeAudio, onStepRead, onStepInterrupted };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props }); await act(async () => { view.result.current.start(); await flush(); });
    view.rerender({ ...props, now: 2000 }); await act(flush); expect(audios).toHaveLength(2); expect(onStepInterrupted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timer' }));
    act(() => audios[0].onended()); expect(onStepRead).not.toHaveBeenCalled();
    await act(async () => { view.result.current.replay(); await flush(); }); expect(audios).toHaveLength(2); expect(audios[1].pause).not.toHaveBeenCalled();
    await act(async () => { audios[1].onended(); await flush(); }); expect(audios).toHaveLength(3); expect(onStepRead).not.toHaveBeenCalled();
    act(() => audios[2].onended()); expect(onStepRead).toHaveBeenCalledTimes(1);
  });
  it('requires Start, caches source audio per mounted session, and advances only on a supplied step change', async () => {
    const props = { identity: 'actor:session', text: 'Stir for 5 minutes.', stepIndex: 0, timers: [], now: 0, request, makeAudio };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props }); expect(request).not.toHaveBeenCalled();
    await act(async () => { view.result.current.start(); await flush(); }); expect(audios).toHaveLength(1);
    act(() => audios[0].onended()); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { view.result.current.replay(); await flush(); }); expect(request).toHaveBeenCalledTimes(1);
    expect(view.result.current.guided).toBe(true); expect(audios).toHaveLength(2);
    view.rerender({ ...props, text: 'Serve the food.', stepIndex: 1 }); await act(flush);
    expect(audios[1].pause).toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(2);
    view.unmount(); expect(audios[2].pause).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('queues simultaneous timer speech without overlapping and emits each due alert once after background time jump', async () => {
    const timers = [1,2].map(id => ({ id: String(id), label: `Timer ${id}`, endsAt: new Date(100000).toISOString(), running: true, durationSeconds: 100 }));
    const props = { identity: 'actor:session', text: 'Start stirring.', stepIndex: 0, timers, now: 0, request, makeAudio };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props }); await act(async () => { view.result.current.start(); await flush(); });
    view.rerender({ ...props, now: 200000 }); await act(flush); expect(view.result.current.alerts).toHaveLength(2); expect(audios[0].pause).toHaveBeenCalled(); expect(audios).toHaveLength(2);
    await act(async () => { audios[1].onended(); await flush(); }); expect(audios).toHaveLength(3);
    await act(async () => { audios[2].onended(); await flush(); }); view.rerender({ ...props, now: 201000 }); await act(flush);
    expect(request).toHaveBeenCalledTimes(3); expect(view.result.current.alerts).toHaveLength(2);
    view.rerender({ ...props, now: 202000, timers: timers.map(item => ({ ...item, acknowledged: true, running: false })) }); expect(view.result.current.alerts).toHaveLength(0);
  });
  it('cancels pending source work on identity change and ignores a late resolved voice result', async () => {
    let resolve; const pending = vi.fn((_path, options) => { pending.signal = options.signal; return new Promise(done => { resolve = done; }); });
    const props = { identity: 'actor-a:session', text: 'Private recipe step', stepIndex: 0, timers: [], now: 0, request: pending, makeAudio };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props }); act(() => view.result.current.start());
    view.rerender({ ...props, identity: 'actor-b:session' }); expect(pending.signal.aborted).toBe(true);
    await act(async () => { resolve({ local: true, audioBase64: 'UklGRg==' }); await flush(); }); expect(audios).toHaveLength(0); expect(view.result.current.guided).toBe(false);
  });
  it('due alarms interrupt a paused source reading and leave the source step in place', async () => {
    const beep = vi.fn(async () => {}); const props = { identity: 'actor:session', text: 'A long source instruction.', stepIndex: 4,
      timers: [{id:'x',label:'Rest',endsAt:new Date(10000).toISOString(),running:true,durationSeconds:10}], now:0, request, makeAudio, makeCue:()=>({beep,close:vi.fn()}) };
    const view=renderHook(value=>useGuidedCooking(value),{initialProps:props}); await act(async()=>{view.result.current.start();await flush();});
    act(()=>view.result.current.pause()); view.rerender({...props,now:20000}); await act(flush);
    expect(beep).toHaveBeenCalledTimes(1); expect(audios[0].pause).toHaveBeenCalled(); expect(audios).toHaveLength(2);
    expect(request.mock.lastCall[1].body.text).toContain('Rest timer finished'); expect(view.result.current.notice).toContain('Replay the step');
    expect(props.stepIndex).toBe(4);
  });
  it('a later timer interrupts alert speech before its cue, then serializes both pending alerts',async()=>{
    const beep=vi.fn(async()=>{});const timers=[{id:'one',label:'First',endsAt:new Date(10000).toISOString(),running:true,durationSeconds:10},{id:'two',label:'Second',endsAt:new Date(20000).toISOString(),running:true,durationSeconds:20}];
    const props={identity:'actor:session',text:'Source step',stepIndex:0,timers,now:0,request,makeAudio,makeCue:()=>({beep,close:vi.fn()})};const view=renderHook(value=>useGuidedCooking(value),{initialProps:props});await act(async()=>{view.result.current.start();await flush();});
    view.rerender({...props,now:11000});await act(flush);expect(audios).toHaveLength(2);view.rerender({...props,now:21000});await act(flush);
    expect(audios[1].pause).toHaveBeenCalled();expect(beep).toHaveBeenCalledTimes(2);expect(audios).toHaveLength(3);
    await act(async()=>{audios[2].onended();await flush();});expect(audios).toHaveLength(4);expect(view.result.current.alerts).toHaveLength(2);
  });
  it('a rejected local cue still permits spoken timer reminders without a stuck queue',async()=>{
    const props={identity:'actor:session',text:'Source step',stepIndex:0,timers:[{id:'x',label:'Rest',endsAt:new Date(10000).toISOString(),running:true}],now:0,request,makeAudio,makeCue:()=>({beep:()=>Promise.reject(new Error('Audio context closed')),close:vi.fn()})};
    const view=renderHook(value=>useGuidedCooking(value),{initialProps:props});await act(async()=>{view.result.current.start();await flush();});view.rerender({...props,now:20000});await act(async()=>{await flush();await flush();});
    expect(audios).toHaveLength(2);expect(view.result.current.notice).toContain('cue could not play');expect(view.result.current.state).toBe('playing');
  });
  it.each(['queued', 'playing'])('discards a %s near reminder when its timer becomes due', async nearState => {
    const props = { identity: 'actor:session', text: 'A source instruction.', stepIndex: 0,
      timers: [{ id: 'rest', label: 'Rest', endsAt: new Date(60000).toISOString(), running: true, durationSeconds: 60 }],
      now: 0, request, makeAudio, makeCue: () => ({ beep: vi.fn(async () => {}), close: vi.fn() }) };
    const view = renderHook(value => useGuidedCooking(value), { initialProps: props });
    await act(async () => { view.result.current.start(); await flush(); });
    if (nearState === 'playing') act(() => audios[0].onended());
    view.rerender({ ...props, now: 31000 }); await act(flush);
    expect(audios).toHaveLength(nearState === 'playing' ? 2 : 1);
    const interrupted = audios.at(-1);
    view.rerender({ ...props, now: 61000 }); await act(flush);
    expect(interrupted.pause).toHaveBeenCalled();
    expect(request.mock.lastCall[1].body.text).toContain('Rest timer finished');
    const dueAudioCount = audios.length;
    await act(async () => { audios.at(-1).onended(); await flush(); });
    expect(audios).toHaveLength(dueAudioCount);
    expect(request.mock.calls.filter(([, options]) => options.body.text?.includes('thirty seconds'))).toHaveLength(nearState === 'playing' ? 1 : 0);
    expect(view.result.current.state).toBe('idle');
  });
  it('reads only explicit duration units, never temperatures, ranges or missing times', () => {
    expect(sourceDurations('Bake at 180 C for 20-30 minutes.')).toEqual([]);
    expect(sourceDurations('Cook until ready.')).toEqual([]);
    expect(sourceDurations('Rest for 1.5 hours, then stir for 15 seconds.')).toEqual([{seconds:5400,label:'1.5 hours'},{seconds:15,label:'15 seconds'}]);
    const seen = new Set(); const due = [{ id:'x',label:'Rest',endsAt:new Date(1000).toISOString(),running:true,durationSeconds:60 }];
    expect(timerEvents(due,5000,seen)[0].kind).toBe('due'); expect(timerEvents(due,6000,seen)).toEqual([]);
  });
  it('does not turn fraction denominators or either range endpoint into a timer', () => {
    for (const duration of ['1/2 hour', '1 1/2 hours', '1 ⁄ 2 hour', '20 minutes to30minutes', '20—30minutes', '20 minutes to 30 minutes', '20 to 30 minutes', '20 mins – 30 mins'])
      expect(sourceDurations(`Rest for ${duration}.`)).toEqual([]);
    expect(sourceDurations('Rest for 20 minutes to 30 minutes, then stir for 15 seconds.')).toEqual([{ seconds: 15, label: '15 seconds' }]);
    expect(sourceDurations('Rest for 1/2 hour, then cook for 5 minutes.')).toEqual([{ seconds: 300, label: '5 minutes' }]);
    expect(sourceDurations('Stir for 5 minutes, 15 seconds.')).toEqual([{ seconds: 300, label: '5 minutes' }, { seconds: 15, label: '15 seconds' }]);
  });
});
