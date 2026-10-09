import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MealPlanner from '../../src/pages/MealPlanner';

const fixture = vi.hoisted(() => ({ auth: { user: null, loading: false }, planner: vi.fn(), kitchen: vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../src/utils/plannerApi', () => ({ plannerRequest: fixture.planner }));
vi.mock('../../src/utils/kitchenApi', () => ({ kitchenRequest: fixture.kitchen }));
vi.mock('../../src/utils/aiControl', () => ({ cancelAiRequest: vi.fn() }));
vi.mock('../../src/utils/supabaseClient', () => ({ supabase: { storage: { from: vi.fn() } } }));

beforeEach(() => {
  sessionStorage.clear(); fixture.auth = { user: null, loading: false };
  fixture.planner.mockReset(); fixture.kitchen.mockReset();
  window.matchMedia = vi.fn(() => ({ matches: true }));
  Element.prototype.scrollIntoView = vi.fn();
  fixture.kitchen.mockResolvedValue({ pantry: [], households: [], features: {} });
  fixture.planner.mockImplementation(async (path, options) => {
    if (path === '/preferences') return { dietaryPreferences: [], allergies: [] };
    if (path.startsWith('?')) return { plan: null };
    if (path !== '/generate') throw new Error(`Unexpected fixture route: ${path}`);
    return {
      weekStart: options.body.weekStart, servings: options.body.servings,
      settings: { ...options.body }, intent: { _signature: 'fixture-only-not-a-real-signature', ingredients: [], allergies: [], dietaryPreferences: [], cuisines: [], categories: [], maxCookingTime: 45 },
      personalization: { usedProfile: Boolean(fixture.auth.user && options.body.useProfile) }, warnings: [], alternatives: [],
      meals: [{ dayIndex: 0, recipe: { id: 'public-source-fixture', title: 'Source rice dinner', cookingTime: 20 } }],
      shoppingList: [{ key: 'rice:g', name: 'Rice', quantityText: '200 g' }], checkedItems: [],
    };
  });
});

describe('actual MealPlanner page smoke', () => {
  it.each(['guest', 'authenticated'])('renders the real empty-state icon and generated plan for %s', async mode => {
    if (mode === 'authenticated') fixture.auth = { user: { id: 'owner-fixture' }, loading: false };
    render(<MemoryRouter><MealPlanner /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Plan your dinners' })).toBeVisible();
    expect(await screen.findByText('Your dinners and grocery list will appear here.')).toBeVisible();
    const generate = screen.getByRole('button', { name: 'Plan my week' });
    await waitFor(() => expect(generate).toBeEnabled());
    const profileChoice = screen.getByRole('checkbox', { name: 'Use my saved preferences, allergies and favorites' });
    if (mode === 'authenticated') {
      expect(profileChoice).toBeChecked();
      expect(profileChoice).toBeEnabled();
    } else {
      expect(profileChoice).not.toBeChecked();
      expect(profileChoice).toBeDisabled();
    }
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Dinners'), '1');
    await user.click(generate);
    expect(await screen.findByRole('link', { name: 'Source rice dinner' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Groceries' })).toBeVisible();
    expect(screen.getByText('200 g')).toBeVisible();
    expect(screen.queryByText(/You changed the preferences above/)).not.toBeInTheDocument();
    if (mode === 'authenticated') expect(screen.getByRole('button', { name: 'Save plan & list' })).toBeEnabled();
    else expect(screen.getByRole('link', { name: 'Log in to save' })).toBeVisible();
    expect(fixture.planner.mock.calls.find(([path]) => path === '/generate')[1].body).toMatchObject({ mealCount: 1, useProfile: mode === 'authenticated', usePantry: false, useLeftovers: false, useHouseholdPreferences: false });
  });

  it('respects an authenticated saved-profile opt-out without marking the generated plan as edited', async () => {
    fixture.auth = { user: { id: 'owner-fixture' }, loading: false };
    render(<MemoryRouter><MealPlanner /></MemoryRouter>);
    const generate = screen.getByRole('button', { name: 'Plan my week' });
    await waitFor(() => expect(generate).toBeEnabled());
    const profileChoice = screen.getByRole('checkbox', { name: 'Use my saved preferences, allergies and favorites' });
    const user = userEvent.setup();
    await user.click(profileChoice);
    expect(profileChoice).not.toBeChecked();
    await user.selectOptions(screen.getByLabelText('Dinners'), '1');
    await user.click(generate);
    expect(await screen.findByRole('link', { name: 'Source rice dinner' })).toBeVisible();
    expect(fixture.planner.mock.calls.find(([path]) => path === '/generate')[1].body.useProfile).toBe(false);
    expect(screen.queryByText(/You changed the preferences above/)).not.toBeInTheDocument();
  });
});
