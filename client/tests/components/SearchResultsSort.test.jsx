import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import SearchResults from '../../src/pages/SearchResults';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/utils/catalogApi', () => ({ catalogRequest: transport.request }));
vi.mock('../../src/utils/api', () => ({ apiUrl: path => `/api${path}` }));
// Keep the page and real sort control; unrelated card/image requests are outside this contract.
vi.mock('../../src/components/RecipeList', () => ({ default: ({ recipes }) => <div>{recipes.map(recipe => <p key={recipe.id}>{recipe.title}</p>)}</div> }));

function RouteState() {
  const location = useLocation();
  return <output aria-label="Search URL">{location.search}</output>;
}

const mount = path => render(<MemoryRouter initialEntries={[path]}><SearchResults /><RouteState /></MemoryRouter>);
const requestParams = () => new URL(transport.request.mock.lastCall[0], 'http://localhost').searchParams;

beforeEach(() => {
  transport.request.mockReset();
  transport.request.mockImplementation(async url => {
    const highestRated = new URL(url, 'http://localhost').searchParams.get('sort') === 'ratingAverage,desc';
    return { content: [{ id: 'original-source-recipe', title: highestRated ? 'Highest-rated source soup' : 'Recent source soup' }], totalElements: 72, totalPages: 3 };
  });
});

describe('SearchResults sorting through the real rendered control', () => {
  it('keeps Highest rated selected, requests that order and resets pagination without losing conditions', async () => {
    mount('/search?keyword=potato%20%26%20leek&ingredients=potato&allergies=peanut&page=2&sort=createdAt');
    expect(await screen.findByText('Recent source soup')).toBeVisible();
    expect(requestParams().get('page')).toBe('2');

    const control = screen.getByRole('combobox', { name: 'Sort recipes' });
    await userEvent.selectOptions(control, 'ratingAverage');
    expect(await screen.findByText('Highest-rated source soup')).toBeVisible();
    expect(control).toHaveValue('ratingAverage');
    expect(requestParams().get('sort')).toBe('ratingAverage,desc');
    expect(requestParams().get('page')).toBe('0');
    expect(requestParams().get('keyword')).toBe('potato & leek');
    expect(requestParams().getAll('ingredients')).toEqual(['potato']);
    expect(requestParams().getAll('allergies')).toEqual(['peanut']);
    const location = new URLSearchParams(screen.getByLabelText('Search URL').textContent);
    expect(location.get('sort')).toBe('ratingAverage');
    expect(location.get('page')).toBe('0');
  });

  it('preserves the meaning of an existing rating-sort link with the canonical selected label and request', async () => {
    mount('/search?keyword=soup&sort=rating&page=1');
    expect(await screen.findByText('Highest-rated source soup')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Sort recipes' })).toHaveValue('ratingAverage');
    expect(requestParams().get('sort')).toBe('ratingAverage,desc');
    expect(requestParams().get('page')).toBe('1');
  });
});
