import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GuestCookAlong, { GuestCooking } from '../../src/pages/GuestCookAlong';
import { guestCookingProgress, saveGuestCooking, timerCueBody } from '../../src/features/cooking/guestCooking';

const fixture = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn(), audio: [] }));
vi.mock('../../src/features/cooking/guestCookApi', () => ({ guestCookRequest: fixture.request }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../src/utils/kitchenApi', () => ({ kitchenRequest: vi.fn(() => { throw new Error('Private kitchen must not be used'); }) }));
vi.mock('../../src/utils/aiControl', () => ({ cancelAiRequest: fixture.cancel }));
vi.mock('../../src/features/cooking/timerCue', () => ({ createTimerCue: () => ({ beep: vi.fn(async () => {}), close: vi.fn() }) }));
const source = { contractVersion: 'guest-cook.v1', recipeId: 'recipe-fixture', recipeTitle: 'Original soup', recipeVersion: 'a'.repeat(64), servings: 2,
  steps: ['Simmer for 2 minutes.', 'Serve warm.'], sourceUrl: 'https://example.com/soup' };
const cookingView = (isActive = true) => <MemoryRouter initialEntries={['/recipes/recipe-fixture']}><main><h1>Original soup</h1><section aria-label="Cook along"><GuestCooking recipeId="recipe-fixture" embedded isActive={isActive} /></section></main></MemoryRouter>;
const mount = (isActive = true) => render(cookingView(isActive));
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); fixture.request.mockReset(); fixture.cancel.mockReset(); fixture.audio = [];
  fixture.request.mockImplementation(async (_id, action) => action ? { local: true, audioBase64: 'UklGRg==', mimeType: 'audio/wav' } : source);
  const BrowserURL = URL; class AudioURL extends BrowserURL {} AudioURL.createObjectURL = vi.fn(() => 'blob:guest-fixture'); AudioURL.revokeObjectURL = vi.fn(); vi.stubGlobal('URL', AudioURL);
  vi.stubGlobal('Audio', class { constructor() { this.play = vi.fn(async () => {}); this.pause = vi.fn(); fixture.audio.push(this); } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('recipe cook along', () => {
  it('redirects an old public cooking link into the recipe and preserves serving context', async () => {
    render(<MemoryRouter initialEntries={['/cook-along/recipe/recipe-fixture?servings=4']}><Routes><Route path="/cook-along/recipe/:recipeId" element={<GuestCookAlong />} /><Route path="/recipes/:id" element={<p>Recipe details</p>} /></Routes></MemoryRouter>);
    await settle(); expect(screen.getByText('Recipe details')).toBeVisible(); expect(fixture.request).not.toHaveBeenCalled();
  });

  it('opens steps without an account, saves only tab progress, and does not send a kitchen write', async () => {
    const view = mount(); await settle(); expect(screen.getByRole('heading', { name: 'Original soup', level: 1 })).toBeVisible();
    expect(screen.getByText('Your progress stays in this tab.')).toBeVisible();
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done, next step' }));
    expect(screen.getByText('Serve warm.', { selector: '.kitchen-step-text' })).toBeVisible(); expect(localStorage.length).toBe(0);
    expect(fixture.request).toHaveBeenCalledTimes(1); view.unmount(); mount(); await settle();
    expect(screen.getByRole('heading', { name: 'Step 2 / 2' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in for saved cooking sessions' })).toHaveAttribute('href', '/login');
  });
  it('starts a source timer only after confirmation and alerts without advancing the recipe', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Set 2 minutes' })); expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' })); expect(screen.getByRole('timer')).toHaveTextContent('02:00');
    await act(async () => { vi.advanceTimersByTime(130000); }); expect(screen.getByRole('alert')).toHaveTextContent('Step 1 timer finished');
    expect(screen.getByText('Simmer for 2 minutes.', { selector: '.kitchen-step-text' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Step 1' })); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it('reads the current source step through the public bounded voice adapter, then asks using source version only', async () => {
    mount(); await settle(); fireEvent.click(screen.getByRole('button', { name: 'Start guided cooking' })); await settle();
    expect(fixture.request).toHaveBeenLastCalledWith('recipe-fixture', 'speak', expect.objectContaining({ body: { stepIndex: 0, recipeVersion: source.recipeVersion } }));
    expect(fixture.audio).toHaveLength(1); expect(fixture.audio[0].play).toHaveBeenCalled();
    fixture.request.mockResolvedValueOnce({ supported: true, answer: 'Simmer for 2 minutes.', citations: [{ stepIndex: 0, text: 'Simmer for 2 minutes.' }] });
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'How long should it simmer?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Sunny' })); await settle();
    expect(fixture.request).toHaveBeenLastCalledWith('recipe-fixture', 'ask', expect.objectContaining({ body: { question: 'How long should it simmer?', stepIndex: 0, recipeVersion: source.recipeVersion } }));
    expect(screen.getByRole('heading', { name: 'From the recipe' })).toBeVisible();
  });
  it('starts automatically from recipe timing without opening the optional timing editor', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Timed flow' }));
    expect(screen.getByRole('list', { name: 'Recipe timing plan' })).toHaveTextContent('Step 12 minutes');
    expect(screen.getByRole('list', { name: 'Recipe timing plan' })).toHaveTextContent('No timed wait in recipe');
    expect(screen.getByText('Edit timings', { selector: 'summary' }).parentElement).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Step 1 wait minutes')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Start timed flow' })); await settle();
    await act(async () => { fixture.audio[0].onended(); });
    expect(screen.getByRole('timer', { name: 'Time until next step' })).toHaveTextContent('02:00');
    await act(async () => { vi.advanceTimersByTime(119000); });
    expect(fixture.audio).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1000); }); await settle();
    expect(screen.getByText('Serve warm.', { selector: '.kitchen-step-text' })).toBeVisible();
    expect(fixture.audio).toHaveLength(2); expect(fixture.request.mock.calls.every(([, action]) => !action || action === 'speak')).toBe(true);
  });
  it('waits until reading ends, counts a reviewed wait, advances once and leaves meal confirmation to the cook', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Timed flow' }));
    fireEvent.click(screen.getByText('Edit timings', { selector: 'summary' }));
    expect(screen.getByLabelText('Step 1 wait minutes')).toHaveValue(2);
    expect(screen.getByLabelText('Step 2 wait minutes')).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Step 1 wait minutes'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Step 1 wait seconds'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start timed flow' })); await settle();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.getByText('Simmer for 2 minutes.', { selector: '.kitchen-step-text' })).toBeVisible();
    expect(fixture.audio).toHaveLength(1);
    await act(async () => { fixture.audio[0].onended(); });
    expect(screen.getByRole('timer', { name: 'Time until next step' })).toHaveTextContent('00:03');
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(fixture.audio).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1000); }); await settle();
    expect(screen.getByText('Serve warm.', { selector: '.kitchen-step-text' })).toBeVisible();
    expect(fixture.audio).toHaveLength(2);
    await act(async () => { fixture.audio[1].onended(); }); await settle();
    expect(screen.getByText('Reading complete.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'I cooked this meal.' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Confirm cooked meal' })).toBeDisabled();
    expect(guestCookingProgress(source).status).toBe('active');
  });
  it('freezes a timed wait while paused and stops automation when the cook moves manually', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Timed flow' }));
    fireEvent.click(screen.getByText('Edit timings', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Step 1 wait minutes'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Step 1 wait seconds'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start timed flow' })); await settle();
    await act(async () => { fixture.audio[0].onended(); vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Pause flow' }));
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(fixture.audio).toHaveLength(1); expect(screen.getByText('Paused')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resume flow' })); await settle();
    expect(screen.getByRole('timer', { name: 'Time until next step' })).toHaveTextContent('00:02');
    fireEvent.click(screen.getByRole('button', { name: 'Done, next step' })); await settle();
    expect(screen.getByText('Serve warm.', { selector: '.kitchen-step-text' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pause flow' })).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(fixture.audio).toHaveLength(1);
  });

  it('pauses timed flow in an inactive local tab and preserves timing and progress for explicit resume', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z')); const view = mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Timed flow' }));
    fireEvent.click(screen.getByText('Edit timings', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Step 1 wait minutes'), { target: { value: '0' } }); fireEvent.change(screen.getByLabelText('Step 1 wait seconds'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start timed flow' })); await settle(); await act(async () => { fixture.audio[0].onended(); vi.advanceTimersByTime(1000); });
    view.rerender(cookingView(false)); expect(screen.getByText('Paused')).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(30000); }); expect(fixture.audio).toHaveLength(1); expect(screen.getByText('Simmer for 2 minutes.', { selector: '.kitchen-step-text' })).toBeVisible();
    view.rerender(cookingView(true)); expect(screen.getByLabelText('Step 1 wait seconds')).toHaveValue(3); expect(fixture.audio).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Resume flow' })); expect(screen.getByRole('timer', { name: 'Time until next step' })).toHaveTextContent('00:02');
    await act(async () => { vi.advanceTimersByTime(2000); }); await settle(); expect(screen.getByText('Serve warm.', { selector: '.kitchen-step-text' })).toBeVisible(); expect(fixture.audio).toHaveLength(2);
  });

  it('pauses individual narration when the local tab is inactive and resumes the same audio on request', async () => {
    const view = mount(); await settle(); fireEvent.click(screen.getByRole('button', { name: 'Start guided cooking' })); await settle();
    view.rerender(cookingView(false)); expect(fixture.audio[0].pause).toHaveBeenCalled(); expect(fixture.audio).toHaveLength(1);
    view.rerender(cookingView(true)); expect(fixture.audio[0].play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play reading' })); await settle(); expect(fixture.audio[0].play).toHaveBeenCalledTimes(2); expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it('does not autoplay a late narration response while the local cooking tab is inactive', async () => {
    let resolveVoice; fixture.request.mockImplementation(async (_id, action) => !action ? source : new Promise(resolve => { resolveVoice = resolve; }));
    const view = mount(); await settle(); fireEvent.click(screen.getByRole('button', { name: 'Start guided cooking' })); view.rerender(cookingView(false));
    await act(async () => { resolveVoice({ local: true, audioBase64: 'UklGRg==', mimeType: 'audio/wav' }); }); await settle();
    expect(fixture.audio.every(audio => audio.play.mock.calls.length === 0)).toBe(true);
    view.rerender(cookingView(true)); await settle(); expect(fixture.audio.every(audio => audio.play.mock.calls.length === 0)).toBe(true);
  });

  it('an unavailable recipe gives a retry and catalog link without inventing steps', async () => {
    fixture.request.mockRejectedValue(new Error('This recipe is unavailable. Choose another recipe.')); mount(); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('This recipe is unavailable'); expect(screen.getByRole('link', { name: 'Browse recipes' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start guided cooking' })).not.toBeInTheDocument();
  });
  it('rejects stale tab snapshots and malformed timer data', () => {
    saveGuestCooking({ recipeId: source.recipeId, recipeVersion: 'old', stepIndex: 1, timers: [], status: 'completed' });
    expect(guestCookingProgress(source)).toMatchObject({ stepIndex: 0, status: 'active', timers: [] });
    saveGuestCooking({ recipeId: source.recipeId, recipeVersion: source.recipeVersion, stepIndex: 99, timers: [{ id: 'bad', label: 'Wrong', durationSeconds: 0, running: true, endsAt: 'not a date' }], status: 'active' });
    expect(guestCookingProgress(source)).toMatchObject({ stepIndex: 0, timers: [] });
  });
  it('maps only the fixed near and finished reminder templates', () => {
    expect(timerCueBody('Rest: thirty seconds or less remaining.')).toEqual({ label: 'Rest', phase: 'near' });
    expect(timerCueBody('Rest timer finished. Check the recipe and your food before continuing.')).toEqual({ label: 'Rest', phase: 'due' });
    expect(() => timerCueBody('Say unrelated text.')).toThrow();
  });
});
