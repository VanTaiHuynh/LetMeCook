import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Features from '../../src/pages/Features';
import HowItWorks from '../../src/pages/HowItWorks';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it('a feature deep link reaches the requested experience after the page mounts', () => {
  render(<MemoryRouter initialEntries={['/features#your-kitchen']}><Features /></MemoryRouter>);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  const target = Element.prototype.scrollIntoView.mock.instances[0];
  expect(target.id).toBe('your-kitchen');
  expect(target).toHaveTextContent('Your kitchen, your way.');
  expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
});

it('the guide keeps questions compact and opens an answer on request', async () => {
  render(<MemoryRouter initialEntries={['/how-it-works']}><HowItWorks /></MemoryRouter>);
  const summary = screen.getByText('Do I have to use voice?', { selector: 'summary' });
  const disclosure = summary.closest('details');
  expect(disclosure).not.toHaveAttribute('open');
  await userEvent.click(summary);
  expect(disclosure).toHaveAttribute('open');
  expect(disclosure).toHaveTextContent('You choose when to start spoken guidance');
  expect(screen.getByRole('link', { name: 'Find a recipe' })).toHaveAttribute('href', '/recipes');
});

it('choosing a household goal changes the real action while preserving the feature stories', async () => {
  render(<MemoryRouter><Features /></MemoryRouter>);
  await userEvent.selectOptions(screen.getByLabelText('What would you like to do?'), 'household');
  const nextStep = within(screen.getByRole('complementary', { name: 'Your next step' }));
  expect(nextStep.getByRole('heading')).toHaveTextContent('Bring everyone into one kitchen.');
  expect(nextStep.getByRole('link', { name: 'Open my household kitchen' })).toHaveAttribute('href', '/household');
  expect(nextStep.getByRole('link', { name: 'Read the short guide' })).toHaveAttribute('href', '/how-it-works#guide-household');
  expect(nextStep.getByText('Log in to use your saved kitchen.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Dinner ideas that feel like you.' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'A week with room for real life.' })).toBeVisible();
});

it('a selected leftover journey opens its practical guide and the user can close it', async () => {
  render(<MemoryRouter initialEntries={['/features']}><Routes><Route path="/features" element={<Features />} /><Route path="/how-it-works" element={<HowItWorks />} /></Routes></MemoryRouter>);
  await userEvent.selectOptions(screen.getByLabelText('What would you like to do?'), 'leftovers');
  await userEvent.click(screen.getByRole('link', { name: 'Read the short guide' }));
  const summary = screen.getByText('Remember the taste, save the leftovers', { selector: 'summary' });
  const disclosure = summary.closest('details');
  expect(disclosure).toHaveAttribute('open');
  expect(disclosure).toHaveTextContent('Save confirmed leftovers');
  expect(within(disclosure).getByRole('link', { name: 'Manage your pantry and leftovers' })).toHaveAttribute('href', '/pantry');
  expect(Element.prototype.scrollIntoView.mock.instances.at(-1)).toBe(disclosure);
  await userEvent.click(summary);
  expect(disclosure).not.toHaveAttribute('open');
});
