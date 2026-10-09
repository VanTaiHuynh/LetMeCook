import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import useCookingMicrophone from '../../src/features/cooking/useCookingMicrophone';
vi.mock('../../src/utils/sunny', () => ({ readPhoto: vi.fn(async () => 'YQ==') }));
vi.mock('../../src/utils/aiControl', () => ({ cancelAiRequest: vi.fn() }));
let getUserMedia, track, instances;
const props = () => ({ transcribe: vi.fn(async () => ({ local: true, text: 'How long?' })), onText: vi.fn(), setError: vi.fn(), setNotice: vi.fn() });
beforeEach(() => {
  track = { stop: vi.fn() }; getUserMedia = vi.fn(async () => ({ getTracks: () => [track] })); instances = [];
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; instances.push(this); } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['a']) }); this.onstop(); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('cancels a pending permission prompt and releases a late microphone without recording', async () => {
  let resolve; getUserMedia.mockImplementation(() => new Promise(done => { resolve = done; })); const options = props();
  const view = renderHook(() => useCookingMicrophone(options)); act(() => { void view.result.current.start(); });
  expect(view.result.current.busy).toBe('Requesting microphone access'); act(() => view.result.current.cancel());
  await act(async () => { resolve({ getTracks: () => [track] }); });
  expect(track.stop).toHaveBeenCalledTimes(1); expect(instances).toHaveLength(0); expect(view.result.current.recording).toBe(false); expect(options.transcribe).not.toHaveBeenCalled();
});
it('returns a local transcript for review without automatically asking the cooking model', async () => {
  const options = props(); const view = renderHook(() => useCookingMicrophone(options)); await act(async () => view.result.current.start());
  expect(view.result.current.recording).toBe(true); await act(async () => { view.result.current.stop(); await Promise.resolve(); await Promise.resolve(); });
  expect(track.stop).toHaveBeenCalled(); expect(options.transcribe).toHaveBeenCalledWith({ audioBase64: 'YQ==', mimeType: 'audio/webm' }, expect.any(AbortSignal));
  expect(options.onText).toHaveBeenCalledWith('How long?'); expect(options.setNotice).toHaveBeenCalledWith('Check the transcript, then ask Sunny.');
});
it('declined access leaves typed questions available', async () => {
  getUserMedia.mockRejectedValue(Object.assign(new Error('declined'), { name: 'NotAllowedError' })); const options = props();
  const view = renderHook(() => useCookingMicrophone(options)); await act(async () => view.result.current.start());
  expect(options.setError).toHaveBeenCalledWith('Microphone access was declined. You can still type your question.'); expect(view.result.current.busy).toBe(''); expect(options.transcribe).not.toHaveBeenCalled();
});
