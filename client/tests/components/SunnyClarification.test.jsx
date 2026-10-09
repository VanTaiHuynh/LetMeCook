import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SunnyClarification from '../../src/features/sunny/SunnyClarification';
describe('Sunny follow-up', () => {
  it('requires both bounded answers, keeps constraints visible, and submits only asked IDs', async () => {
    const submit = vi.fn(); const user = userEvent.setup();
    render(<SunnyClarification clarification={{ questions: [{ id: 'diet', question: 'Which diet?', choices: ['Vegan', 'Vegetarian'] }, { id: 'dish', question: 'Which dish?' }, { id: 'ignored', question: 'Never render third question' }] }} onSubmit={submit} onEdit={vi.fn()} />);
    expect(screen.queryByText('Never render third question')).not.toBeInTheDocument();
    expect(screen.getByText(/original exclusions and time limit/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm and find recipes' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Which diet?'), 'Vegan');
    const dish = screen.getByLabelText('Which dish?'); expect(dish).toHaveAttribute('maxlength', '200'); await user.type(dish, 'Soup');
    await user.click(screen.getByRole('button', { name: 'Confirm and find recipes' }));
    expect(submit).toHaveBeenCalledWith({ diet: 'Vegan', dish: 'Soup' });
  });
  it('preserves answers on retry guidance and prevents duplicate submissions while busy', async () => {
    const submit = vi.fn(); const user = userEvent.setup(); const props = { clarification: { questions: [{ id: 'dish', question: 'Which dish?' }] }, onSubmit: submit, onEdit: vi.fn() };
    const view = render(<SunnyClarification {...props} />); await user.type(screen.getByLabelText('Which dish?'), 'Rice');
    view.rerender(<SunnyClarification {...props} busy error="Edit your request to resolve the contradiction." />);
    expect(screen.getByRole('alert')).toHaveTextContent('contradiction'); expect(screen.getByLabelText('Which dish?')).toHaveValue('Rice');
    expect(screen.getByRole('button', { name: 'Checking your answers…' })).toBeDisabled();
  });
});
