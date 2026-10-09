import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IndividualRecipe from '../../src/pages/IndividualRecipe';

const fixture = vi.hoisted(() => ({
  auth: { user: null, loading: false },
  detail: vi.fn(), account: vi.fn(), kitchen: vi.fn(), favorite: vi.fn(), activity: vi.fn(),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../src/utils/recipeReadClient', () => ({ recipeReadClient: { detail: fixture.detail } }));
vi.mock('../../src/utils/accountApi', () => ({ accountRequest: fixture.account }));
vi.mock('../../src/utils/kitchenApi', () => ({ kitchenRequest: fixture.kitchen }));
vi.mock('../../src/utils/accountMutations', () => ({ favoriteMutation: fixture.favorite }));
vi.mock('../../src/utils/recipeReads', () => ({ recordRecipeActivity: fixture.activity }));
vi.mock('../../src/utils/api', () => ({ apiUrl: path => `/api${path}` }));
vi.mock('../../src/utils/supabaseClient', () => ({ supabase: {} }));
vi.mock('../../src/components/SEO', () => ({ RecipeSEO: () => null }));
vi.mock('../../src/components/RecipeImage', () => ({ default: props => <img {...props} /> }));
vi.mock('../../src/components/CarouselSection', () => ({ default: () => null }));
vi.mock('../../src/components/RecipeReviews', () => ({ default: () => null }));
vi.mock('../../src/components/KitchenShell', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/pages/CookAlong', () => ({ CookContent: ({ id, embedded, isActive }) => <div data-session={id} data-embedded={embedded} data-active={isActive}>Saved cooking workspace</div> }));
vi.mock('../../src/pages/GuestCookAlong', () => ({ GuestCooking: ({ recipeId, embedded, isActive }) => <div data-recipe={recipeId} data-embedded={embedded} data-active={isActive}>Recipe cooking workspace</div> }));

const recipe = {
  id: 'source-recipe', title: 'Source soup', description: 'An original source recipe.',
  createdAt: '2024-01-01', authorName: 'Recipe author', servings: 3, cookingTime: 20,
  ingredients: [{ ingredientName: 'Potato', quantity: 2, unit: '' }],
  directions: 'Simmer the potatoes.\nServe the soup.',
  dietaryPreferences: [], categories: [], cuisines: [],
};
const householdId = '44444444-4444-4444-8444-444444444444';
const planId = '55555555-5555-4555-8555-555555555555';

function CurrentRoute() {
  const { pathname, search, state } = useLocation();
  return <output aria-label="Current route">{JSON.stringify({ pathname, search, state })}</output>;
}
function Harness({ entry = '/recipes/source-recipe' }) {
  return <MemoryRouter initialEntries={[entry]}><CurrentRoute /><Routes>
    <Route path="/recipes/:id" element={<IndividualRecipe />} />
    <Route path="*" element={<p>Destination page</p>} />
  </Routes></MemoryRouter>;
}
const route = () => JSON.parse(screen.getByLabelText('Current route').textContent);

beforeEach(() => {
  fixture.auth = { user: null, loading: false };
  for (const name of ['detail', 'account', 'kitchen', 'favorite', 'activity']) fixture[name].mockReset();
  fixture.detail.mockResolvedValue(recipe);
  fixture.account.mockResolvedValue({ owned: false, favorite: false });
  fixture.kitchen.mockResolvedValue({ id: 'cooking-session' });
  fixture.favorite.mockResolvedValue({}); fixture.activity.mockResolvedValue([]);
  window.scrollTo = vi.fn(); window.matchMedia = vi.fn(() => ({ matches: true }));
});

describe('recipe detail tabs and hero action rail', () => {
  it('places exactly one real Cook along action beside the description and keeps the source method', async () => {
    render(<Harness />);
    const cook = await screen.findByRole('button', { name: 'Cook along' });
    expect(cook.closest('.recipe-hero-copy')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Cook along' })).toHaveLength(1);
    const glance = screen.getByRole('tab', { name: /^at a glance$/i });
    const cookTab = screen.getByRole('tab', { name: /^cook along$/i });
    const panel = screen.getByRole('tabpanel', { name: /^at a glance$/i });
    expect(glance).toHaveAttribute('aria-selected', 'true'); expect(glance).toHaveAttribute('tabindex', '0');
    expect(cookTab).toHaveAttribute('aria-selected', 'false'); expect(cookTab).toHaveAttribute('tabindex', '-1');
    expect(panel.id).toBe(glance.getAttribute('aria-controls')); expect(panel).toHaveAttribute('aria-labelledby', glance.id);
    expect(screen.queryByRole('tabpanel', { name: /^cook along$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Simmer the potatoes.')).toBeVisible();
    expect(screen.getByText('Serve the soup.')).toBeVisible();
  });

  it('opens source-grounded guest cooking without creating a private session and keeps saving behind login', async () => {
    const entry = '/recipes/source-recipe?servings=4&householdId=kitchen-context';
    render(<Harness entry={entry} />);
    await screen.findByRole('button', { name: 'Cook along' });
    expect(screen.getByRole('link', { name: 'Log in to save' })).toHaveAttribute('href', '/login');
    await userEvent.click(screen.getByRole('button', { name: 'Cook along' }));
    expect(route()).toMatchObject({ pathname: '/recipes/source-recipe', search: '?servings=4&householdId=kitchen-context&cook=1' });
    expect(screen.getByText('Recipe cooking workspace').closest('[role=tabpanel]')).toBe(screen.getByRole('tabpanel', { name: /^cook along$/i }));
    expect(screen.getByRole('button', { name: 'Return to cooking' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('tab', { name: /^at a glance$/i }));
    expect(screen.getByText('Recipe cooking workspace')).not.toBeVisible();
    expect(screen.getByText('Recipe cooking workspace')).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('button', { name: 'Cook along' })).toHaveAttribute('aria-expanded', 'false');
    expect(fixture.kitchen).not.toHaveBeenCalled(); expect(fixture.account).not.toHaveBeenCalled();
  });

  it('creates one session while busy and preserves servings, household and saved dinner parameters', async () => {
    fixture.auth = { user: { id: 'actor-a' }, loading: false };
    let resolveSession;
    fixture.kitchen.mockImplementation(() => new Promise(resolve => { resolveSession = resolve; }));
    const entry = `/recipes/source-recipe?servings=4&householdId=${householdId}&planId=${planId}&dayIndex=3`;
    render(<Harness entry={entry} />);
    const cook = await screen.findByRole('button', { name: 'Cook along' });
    await userEvent.dblClick(cook);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(fixture.kitchen).toHaveBeenCalledTimes(1);
    const [path, options] = fixture.kitchen.mock.lastCall;
    expect(path).toBe('/sessions');
    expect(options).toMatchObject({ householdId, body: {
      recipeId: 'source-recipe', servings: 4, mealSlot: { planId, dayIndex: 3 },
    } });
    expect(options.signal.aborted).toBe(false);
    await act(async () => { resolveSession({ id: 'saved-dinner-session' }); });
    expect(route().pathname).toBe('/recipes/source-recipe');
    expect(screen.getByText('Saved cooking workspace')).toHaveAttribute('data-session', 'saved-dinner-session');
    expect(screen.getByText('Saved cooking workspace')).toHaveAttribute('data-embedded', 'true');
    expect(Object.fromEntries(new URLSearchParams(route().search))).toEqual({ servings: '4', householdId, planId, dayIndex: '3', cook: '1', cookSession: 'saved-dinner-session' });
    await userEvent.click(screen.getByRole('tab', { name: /^at a glance$/i }));
    await userEvent.click(screen.getByRole('tab', { name: /^cook along$/i }));
    expect(fixture.kitchen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saved cooking workspace')).toHaveAttribute('data-session', 'saved-dinner-session');
  });


  it('activates public cooking through its local tab and keeps the active tab selected on repeated clicks', async () => {
    render(<Harness />);
    const cookTab = await screen.findByRole('tab', { name: /^cook along$/i });
    await userEvent.click(cookTab);
    const panel = screen.getByRole('tabpanel', { name: /^cook along$/i });
    expect(cookTab).toHaveAttribute('aria-selected', 'true'); expect(panel.id).toBe(cookTab.getAttribute('aria-controls')); expect(panel).toHaveAttribute('aria-labelledby', cookTab.id);
    expect(screen.getByRole('tab', { name: /^at a glance$/i })).toHaveAttribute('aria-selected', 'false');
    expect(route().pathname).toBe('/recipes/source-recipe'); expect(new URLSearchParams(route().search).get('cook')).toBe('1');
    const workspace = screen.getByText('Recipe cooking workspace'); expect(workspace).toBeVisible(); expect(workspace).toHaveAttribute('data-active', 'true');
    await userEvent.click(cookTab); expect(screen.getByText('Recipe cooking workspace')).toBe(workspace); expect(cookTab).toHaveAttribute('aria-selected', 'true');
    expect(fixture.kitchen).not.toHaveBeenCalled(); expect(fixture.account).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: /^at a glance$/i })); expect(workspace).not.toBeVisible(); expect(workspace).toHaveAttribute('data-active', 'false');
    await userEvent.click(cookTab); expect(screen.getByText('Recipe cooking workspace')).toBe(workspace); expect(workspace).toBeVisible();
  });

  it('opens the cooking tab directly for existing cook links without creating private guest records', async () => {
    render(<Harness entry='/recipes/source-recipe?cook=1&servings=4' />);
    expect(await screen.findByRole('tab', { name: /^cook along$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /^cook along$/i })).toBeVisible(); expect(screen.queryByRole('tabpanel', { name: /^at a glance$/i })).not.toBeInTheDocument();
    expect(route().pathname).toBe('/recipes/source-recipe'); expect(fixture.kitchen).not.toHaveBeenCalled();
  });

  it('uses arrow and Home keys for focus, with Enter activating the local cooking tab', async () => {
    render(<Harness />); const glance = await screen.findByRole('tab', { name: /^at a glance$/i }); const cookTab = screen.getByRole('tab', { name: /^cook along$/i });
    glance.focus(); await userEvent.keyboard('{ArrowRight}'); expect(cookTab).toHaveFocus();
    expect(glance).toHaveAttribute('aria-selected', 'true'); expect(cookTab).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Enter}'); expect(cookTab).toHaveAttribute('aria-selected', 'true'); expect(cookTab).toHaveFocus();
    await userEvent.keyboard('{Home}'); expect(glance).toHaveFocus(); expect(cookTab).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}'); expect(glance).toHaveAttribute('aria-selected', 'true'); expect(screen.getByText('Recipe cooking workspace')).not.toBeVisible();
  });

  it('shows incomplete dinner context at the hero and permits retry after a session error', async () => {
    fixture.auth = { user: { id: 'actor-a' }, loading: false };
    const view = render(<Harness entry={`/recipes/source-recipe?planId=${planId}&dayIndex=9`} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cook along' }));
    expect(screen.getByRole('alert')).toHaveTextContent('saved dinner link is incomplete');
    expect(screen.getByRole('alert').closest('.recipe-hero-copy')).not.toBeNull();
    expect(fixture.kitchen).not.toHaveBeenCalled();
    view.unmount();
    fixture.kitchen.mockRejectedValueOnce(new Error('Cooking could not start.')).mockResolvedValueOnce({ id: 'retry-session' });
    render(<Harness entry="/recipes/source-recipe?servings=99" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cook along' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cooking could not start.');
    expect(screen.getByRole('button', { name: 'Cook along' })).toBeEnabled();
    expect(fixture.kitchen.mock.lastCall[1].body.servings).toBe(3);
    await userEvent.click(screen.getByRole('button', { name: 'Cook along' }));
    expect(route().pathname).toBe('/recipes/source-recipe');
    expect(screen.getByText('Saved cooking workspace')).toHaveAttribute('data-session', 'retry-session');
  });

  it('aborts old actor cooking and ownership requests and ignores late results after account change', async () => {
    fixture.auth = { user: { id: 'actor-a' }, loading: false };
    let resolveSession; let resolveOldAccount; let oldAccountSignal;
    fixture.account.mockImplementationOnce((_path, options) => {
      oldAccountSignal = options.signal;
      return new Promise(resolve => { resolveOldAccount = resolve; });
    }).mockResolvedValue({ owned: false, favorite: false });
    fixture.kitchen.mockImplementation(() => new Promise(resolve => { resolveSession = resolve; }));
    const view = render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cook along' }));
    const oldSessionSignal = fixture.kitchen.mock.lastCall[1].signal;
    fixture.auth = { user: { id: 'actor-b' }, loading: false };
    view.rerender(<Harness />);
    await screen.findByRole('button', { name: 'Cook along' });
    expect(oldSessionSignal.aborted).toBe(true); expect(oldAccountSignal.aborted).toBe(true);
    await waitFor(() => expect(fixture.account.mock.lastCall[1].actorId).toBe('actor-b'));
    await act(async () => {
      resolveOldAccount({ owned: true, favorite: true }); resolveSession({ id: 'actor-a-session' });
    });
    expect(route().pathname).toBe('/recipes/source-recipe');
    expect(screen.queryByRole('button', { name: 'Edit recipe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View favorites' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeEnabled();
  });

  it('retains actor-scoped saving, owner edit and printing in the same hero rail', async () => {
    fixture.auth = { user: { id: 'actor-a' }, loading: false };
    fixture.account.mockResolvedValue({ owned: true, favorite: false });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<Harness />);
    await screen.findByRole('button', { name: 'Edit recipe' });
    expect(fixture.account.mock.lastCall[1]).toMatchObject({ actorId: 'actor-a', contractVersion: 'account.v1' });
    await userEvent.click(screen.getByRole('button', { name: 'Save recipe' }));
    expect(fixture.favorite.mock.lastCall.slice(0, 2)).toEqual(['source-recipe', 'actor-a']);
    expect(await screen.findByRole('link', { name: 'View favorites' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Print recipe' }));
    expect(print).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Edit recipe' }));
    expect(route().pathname).toBe('/edit-recipe/source-recipe');
  });
});
