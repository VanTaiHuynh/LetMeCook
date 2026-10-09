import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Carousel from '../../src/components/Carousel';

vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../src/utils/httpClient', () => ({ httpClient: { json: async () => [{ id: 'dinner', title: 'Dinner' }] } }));
vi.mock('../../src/utils/useRecipeRatings', () => ({ useRecipeRatings: () => ({}) }));
vi.mock('../../src/components/RecipeCard', () => ({ default: ({ title }) => <a href="/recipes/dinner">{title}</a> }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const view = render(<MemoryRouter><Carousel dataSource="/recipes" label="Dinner ideas" /></MemoryRouter>);
  await screen.findByRole('link', { name: 'Dinner' });
  const region = screen.getByRole('region', { name: 'Dinner ideas' });
  const track = region.querySelector('.carousel-track');
  return { ...view, region, track };
}

it('ends an interrupted drag on window blur and allows the next tap', async () => {
  const { region, track } = await mount();
  fireEvent.mouseDown(track, { button: 0, clientX: 100 });
  fireEvent.mouseMove(window, { clientX: 60, buttons: 1 });
  expect(region).toHaveClass('dragging');
  expect(document.body).toHaveClass('grabbing-cursor');
  fireEvent.blur(window);
  expect(region).not.toHaveClass('dragging');
  expect(document.body).not.toHaveClass('grabbing-cursor');
  const stoppedAt = region.scrollLeft;
  fireEvent.mouseMove(window, { clientX: 20, buttons: 0 });
  expect(region.scrollLeft).toBe(stoppedAt);
  // Cancel the browser default locally while checking the carousel no longer
  // suppresses a fresh tap after the interrupted gesture.
  const link = screen.getByRole('link', { name: 'Dinner' });
  const tap = vi.fn(event => event.preventDefault());
  link.addEventListener('click', tap, { once: true });
  fireEvent.click(link);
  expect(tap).toHaveBeenCalledTimes(1);
});

it('removes drag state when the carousel unmounts mid-gesture', async () => {
  const { region, track, unmount } = await mount();
  fireEvent.mouseDown(track, { button: 0, clientX: 100 });
  fireEvent.mouseMove(window, { clientX: 60, buttons: 1 });
  expect(region).toHaveClass('dragging');
  unmount();
  expect(region).not.toHaveClass('dragging');
  expect(document.body).not.toHaveClass('grabbing-cursor');
});
