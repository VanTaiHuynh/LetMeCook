import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import FilterBar from '../../src/components/FilterBar';

const fixtures = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/utils/catalogApi', () => ({ catalogRequest: fixtures.request }));
vi.mock('../../src/utils/api', () => ({ apiUrl: path => `/api${path}` }));

function CollectionFilters() {
  const [filters, setFilters] = useState({ categories: ['Dinner'], cuisines: [], dietaryPreferences: [] });
  const [sort, setSort] = useState('viewCount');
  return <FilterBar filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />;
}

beforeEach(() => { fixtures.request.mockReset(); });

it('recovers unavailable filters while retaining the selected filter and sort', async () => {
  fixtures.request.mockRejectedValue(new Error('Connection lost'));
  render(<CollectionFilters />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Recipe filters are unavailable.');
  expect(screen.getByRole('button', { name: 'Remove Dinner filter' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('viewCount');

  const retryRequests = [];
  fixtures.request.mockImplementation((url, options) => new Promise(resolve => {
    retryRequests.push({ url, signal: options.signal, resolve });
  }));
  await userEvent.click(screen.getByRole('button', { name: 'Retry filters' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading recipe filters…');
  expect(screen.queryByRole('button', { name: 'Retry filters' })).not.toBeInTheDocument();
  expect(retryRequests).toHaveLength(3);
  retryRequests.forEach(({ url, resolve }) => resolve([{ name: url.endsWith('/categories') ? 'Dinner' : 'Other' }]));

  const category = await screen.findByRole('button', { name: 'Category 1 selected' });
  await userEvent.click(category);
  expect(screen.getByRole('button', { name: 'Dinner', pressed: true })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(category).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('viewCount');
  expect(screen.getByRole('button', { name: 'Remove Dinner filter' })).toBeVisible();
});

it('aborts pending filter reads when the collection leaves the page', async () => {
  fixtures.request.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<CollectionFilters />);
  await waitFor(() => expect(fixtures.request).toHaveBeenCalledTimes(3));
  const signals = fixtures.request.mock.calls.map(([, options]) => options.signal);
  expect(signals.every(signal => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
  unmount();
  expect(signals.every(signal => signal.aborted)).toBe(true);
});
