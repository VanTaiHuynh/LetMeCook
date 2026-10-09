import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CookingModeControls from '../../src/features/cooking/CookingModeControls';
import useRecipeStepTiming from '../../src/features/cooking/useRecipeStepTiming';

const steps = ['Boil for 10 minutes. Grill for 5 minutes on each side.', 'Grill for about 5 minutes.'];
const flow = { phase: 'idle', active: false, notice: '', start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn() };
const guided = { guided: false, state: 'idle', notice: '', start: vi.fn(), end: vi.fn() };
function Harness({ source = steps, withSourceProps = true }) {
  const [mode, setMode] = useState('timed');
  const timing = useRecipeStepTiming('guest:fixture:v1', source);
  return <CookingModeControls mode={mode} onModeChange={setMode} guided={guided} flow={flow}
    steps={source} stepIndex={0} durations={timing.durations} onDurationChange={timing.change}
    {...(withSourceProps ? { timingSources: timing.sources, overridden: timing.overridden, onDurationReset: timing.reset } : {})} />;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
const edit = () => fireEvent.click(screen.getByText('Edit timings', { selector: 'summary' }));
const plan = () => within(screen.getByRole('list', { name: 'Recipe timing plan' }));

describe('compact automatic cooking timings', () => {
  it('shows source waits and starts without opening the optional editor', () => {
    render(<Harness />);
    expect(plan().getByText('20 minutes')).toBeVisible();
    expect(plan().getByText('5 minutes')).toBeVisible();
    expect(screen.getByText('Edit timings', { selector: 'summary' }).parentElement).not.toHaveAttribute('open');
    for (const field of screen.getAllByRole('spinbutton')) expect(field).not.toBeVisible();
    expect(plan().queryByText('Adjusted')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start timed flow' }));
    expect(flow.start).toHaveBeenCalledOnce();
  });

  it('presets editable minutes and seconds, marks an adjustment and resets to the recipe wait', () => {
    render(<Harness />); edit();
    expect(screen.getByRole('spinbutton', { name: 'Step 1 wait minutes' })).toHaveValue(20);
    expect(screen.getByRole('spinbutton', { name: 'Step 1 wait seconds' })).toHaveValue(0);
    fireEvent.change(screen.getByLabelText('Step 1 wait minutes'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Step 1 wait seconds'), { target: { value: '30' } });
    expect(plan().getByText('1 minute 30 seconds')).toBeVisible(); expect(plan().getByText('Adjusted')).toBeVisible();
    expect(plan().getByText('5 minutes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset step 1 to recipe timing' }));
    expect(screen.getByLabelText('Step 1 wait minutes')).toHaveValue(20); expect(screen.getByLabelText('Step 1 wait seconds')).toHaveValue(0);
    expect(plan().getByText('20 minutes')).toBeVisible(); expect(plan().queryByText('Adjusted')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset step 1 to recipe timing' })).not.toBeInTheDocument();
  });

  it('explains untimed and unclear steps without inventing a wait or requiring an edit', () => {
    render(<Harness source={['Serve warm.', 'Cook each batch for 5 minutes.']} />);
    expect(plan().getByText('No timed wait in recipe')).toBeVisible();
    expect(plan().getByText('Timing is unclear in the recipe')).toBeVisible();
    expect(screen.getByText(/Steps without a clear time continue after reading/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start timed flow' })).toBeEnabled();
    edit(); expect(screen.getByLabelText('Step 1 wait minutes')).toHaveValue(0); expect(screen.getByLabelText('Step 2 wait minutes')).toHaveValue(0);
  });

  it('validates optional edits and resets correctly when source metadata props are omitted', () => {
    render(<Harness withSourceProps={false} />); expect(plan().queryByText('Adjusted')).not.toBeInTheDocument(); edit();
    fireEvent.change(screen.getByLabelText('Step 1 wait seconds'), { target: { value: '' } });
    expect(screen.getByLabelText('Step 1 wait seconds')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Start timed flow' })).toBeDisabled();
    expect(screen.getByText('Choose a wait between 0 and 24 hours.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset step 1 to recipe timing' }));
    expect(screen.getByLabelText('Step 1 wait minutes')).toHaveValue(20); expect(screen.getByLabelText('Step 1 wait seconds')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Start timed flow' })).toBeEnabled(); expect(plan().queryByText('Adjusted')).not.toBeInTheDocument();
  });
});
