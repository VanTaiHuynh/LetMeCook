import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import MainNav from '../../src/components/MainNav';

const fixtures = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owned-qa', app_metadata: {} } }) }));
vi.mock('../../src/utils/accountApi', () => ({ ownProfile: async () => ({ image_url: '' }) }));
vi.mock('../../src/utils/supabaseClient', () => ({ supabase: { auth: { signOut: fixtures.signOut } } }));

function Location() { return <output aria-label="Current route">{useLocation().pathname}</output>; }
beforeEach(() => {
  fixtures.signOut.mockReset();
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
function mount() { render(<MemoryRouter initialEntries={['/profile']}><MainNav /><Location /></MemoryRouter>); }

it('keeps sign-out failure visible and lets the user retry', async () => {
  fixtures.signOut.mockResolvedValueOnce({ error: new Error('Connection lost') }).mockResolvedValueOnce({ error: null });
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  await userEvent.click(screen.getByRole('button', { name: 'Log Out' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not log out. Try again.');
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/profile');
  await userEvent.click(screen.getByRole('button', { name: 'Log Out' }));
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/$/));
  expect(fixtures.signOut).toHaveBeenCalledTimes(2);
});

it('disables repeated sign-out while a request is pending', async () => {
  let resolve;
  fixtures.signOut.mockImplementation(() => new Promise(done => { resolve = done; }));
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  await userEvent.click(screen.getByRole('button', { name: 'Log Out' }));
  const pending = screen.getByRole('button', { name: 'Logging out…' });
  expect(pending).toBeDisabled();
  await userEvent.click(pending);
  expect(fixtures.signOut).toHaveBeenCalledTimes(1);
  resolve({ error: null });
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/$/));
});
