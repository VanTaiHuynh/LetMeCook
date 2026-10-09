import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import RecipeReviews from '../../src/components/RecipeReviews';

const fixture = vi.hoisted(() => ({ auth: { user: null, loading: false }, ratings: vi.fn(), reviews: vi.fn(), save: vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../src/utils/recipeReadClient', () => ({ recipeReadClient: { ratings: fixture.ratings, reviews: fixture.reviews } }));
vi.mock('../../src/utils/httpClient', () => ({ httpClient: { json: fixture.save } }));
const recipe = { id: '0002f382-79dd-5527-8060-f9f7685ce5dd' };
const zero = { cost: null, time: null, difficulty: null, overall: null, overallCount: 0 };
function Location() { const location = useLocation(); return <output aria-label="Review location">{JSON.stringify(location)}</output>; }
const mount = () => render(<MemoryRouter><div className="product-recipe-detail-page"><RecipeReviews recipe={recipe} /><Location /></div></MemoryRouter>);

beforeEach(() => {
  fixture.auth = { user: null, loading: false };
  fixture.ratings.mockReset().mockResolvedValue({ [recipe.id]: zero });
  fixture.reviews.mockReset().mockResolvedValue({ content: [], page: 0, totalElements: 0, totalPages: 0 });
  fixture.save.mockReset().mockResolvedValue({});
});

it('shows one guest action and an honest empty state without useless sorting or fabricated stars', async () => {
  mount();
  expect(await screen.findByText('No ratings yet')).toBeVisible();
  expect(await screen.findByRole('heading', { name: 'Made this recipe?' })).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/out of 5/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Sign in to review' })).toHaveLength(1);
  await userEvent.click(screen.getByRole('link', { name: 'Sign in to review' }));
  const location = JSON.parse(screen.getByLabelText('Review location').textContent);
  expect(location.pathname).toBe('/login');
  expect(location.state.from).toEqual({ pathname: `/recipes/${recipe.id}`, hash: '#recipe-reviews' });
});

it('preserves all review scores and the draft on failure, then refreshes verified data after saving', async () => {
  fixture.auth = { user: { id: 'cook-a' }, loading: false };
  fixture.save.mockRejectedValueOnce(new Error('Your review could not be saved. Please try again.')).mockResolvedValueOnce({});
  mount();
  expect(screen.queryByRole('textbox', { name: 'Your review' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Write a review' }));
  const comment = screen.getByRole('textbox', { name: 'Your review' });
  expect(comment).toHaveFocus();
  await userEvent.type(comment, 'Crisp potatoes, lovely dressing.');
  for (const label of ['Cost', 'Time', 'Difficulty', 'Overall']) await userEvent.selectOptions(screen.getByLabelText(label), '4');
  await userEvent.click(screen.getByRole('button', { name: 'Save review' }));
  expect(await screen.findByText('Your review could not be saved. Please try again.')).toBeVisible();
  expect(comment).toHaveValue('Crisp potatoes, lovely dressing.');
  expect(screen.getByLabelText('Overall')).toHaveValue('4');
  await userEvent.click(screen.getByRole('button', { name: 'Save review' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Your review' })).not.toBeInTheDocument());
  expect(fixture.save.mock.lastCall[1]).toMatchObject({ auth: 'required', method: 'POST', body: { recipeId: recipe.id, comment: 'Crisp potatoes, lovely dressing.', ratings: { cost: 4, time: 4, difficulty: 4, overall: 4 } } });
  await waitFor(() => expect(fixture.ratings).toHaveBeenCalledTimes(2));
  expect(fixture.reviews).toHaveBeenCalledTimes(2);
});

it('displays only recorded ratings and retains all four server sort orders and pagination', async () => {
  fixture.ratings.mockResolvedValue({ [recipe.id]: { ...zero, overall: 4.2, overallCount: 17 } });
  fixture.reviews.mockImplementation(async (_id, options) => ({ content: [{ id: String(options.page), comment: `Review page ${options.page}`, created_at: '2024-01-01', review_ratings: [{ category: 'overall', value: 4 }, { category: 'cost', value: 3 }] }], page: options.page, totalElements: 17, totalPages: 2 }));
  mount();
  expect(await screen.findByText('17 ratings')).toBeVisible();
  expect(screen.getByText('4.2')).toBeVisible();
  expect(await screen.findByText('Review page 0')).toBeVisible();
  expect(screen.getByLabelText('4 out of 5')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Review page 1')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Sort reviews'), 'rating-asc');
  await waitFor(() => expect(fixture.reviews.mock.lastCall[1]).toMatchObject({ page: 0, sort: 'rating', order: 'asc' }));
});

it('shows a retry for unavailable summaries instead of reporting zero ratings', async () => {
  fixture.ratings.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ [recipe.id]: zero });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Retry ratings' }));
  expect(await screen.findByText('No ratings yet')).toBeVisible();
});

it('handles a partial positive count without fabricating or formatting an unavailable average', async () => {
  fixture.ratings.mockResolvedValue({ [recipe.id]: { ...zero, overallCount: 3 } });
  mount();
  expect(await screen.findByText('3 ratings')).toBeVisible();
  expect(screen.queryByText('No ratings yet')).not.toBeInTheDocument();
  expect(screen.queryByText('/ 5')).not.toBeInTheDocument();
});
