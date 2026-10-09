import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useRecipeStepTiming from '../../src/features/cooking/useRecipeStepTiming';

const steps = ['Boil for 10 minutes. Grill for 5 minutes on each side.', 'Grill for about 5 minutes.'];
const setup = () => renderHook(({ identity, source }) => useRecipeStepTiming(identity, source), {
  initialProps: { identity: 'guest:recipe:v1', source: steps },
});

describe('automatic source waits with optional cooking edits', () => {
  it('starts with source durations without a manual edit or network request', () => {
    const view = setup();
    expect(view.result.current.durations).toEqual([1200, 300]);
    expect(view.result.current.overridden).toEqual([false, false]);
  });
  it('changes one step, preserves the other automatic time, and resets to source timing', () => {
    const view = setup();
    act(() => view.result.current.change(0, 60));
    expect(view.result.current.durations).toEqual([60, 300]);
    expect(view.result.current.overridden).toEqual([true, false]);
    act(() => view.result.current.reset(0));
    expect(view.result.current.durations).toEqual([1200, 300]);
    expect(view.result.current.overridden).toEqual([false, false]);
  });
  it('preserves explicit zero and invalid edit values for validation rather than replacing them', () => {
    const view = setup();
    act(() => { view.result.current.change(0, 0); view.result.current.change(1, NaN); });
    expect(view.result.current.durations[0]).toBe(0);
    expect(view.result.current.durations[1]).toBeNaN();
    expect(view.result.current.overridden).toEqual([true, true]);
  });
  it('discards an edit when the instructions or the cook identity change', () => {
    const view = setup();
    act(() => view.result.current.change(0, 60));
    view.rerender({ identity: 'guest:recipe:v1', source: ['Bake for 30 minutes.'] });
    expect(view.result.current.durations).toEqual([1800]);
    act(() => view.result.current.change(0, 90));
    view.rerender({ identity: 'account:recipe:v1', source: ['Bake for 30 minutes.'] });
    expect(view.result.current.durations).toEqual([1800]);
    expect(view.result.current.overridden).toEqual([false]);
  });
  it('does not invent a duration for an untimed step and ignores non-step edits', () => {
    const view = renderHook(() => useRecipeStepTiming('guest:recipe:v1', ['Serve warm.']));
    expect(view.result.current.durations).toEqual([0]);
    expect(view.result.current.sources[0].kind).toBe('unknown');
    act(() => { view.result.current.change(-1, 60); view.result.current.change(1, 60); });
    expect(view.result.current.overridden).toEqual([false]);
  });
});
