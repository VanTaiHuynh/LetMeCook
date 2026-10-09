import { expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Terms from '../../src/pages/Terms';
import Privacy from '../../src/pages/Privacy';
import Contact from '../../src/pages/Contact';
import Newsletter from '../../src/pages/Newsletter';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/utils/platform', () => ({ platformRequest: request }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

it.each([[Terms, 'Terms & Conditions', 8], [Privacy, 'Privacy Policy', 11]])('policy %s keeps every section directly accessible from its contents', (Page, title, count) => {
  const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  const contents = screen.getByRole('navigation', { name: 'On this page' });
  const links = within(contents).getAllByRole('link');
  expect(links).toHaveLength(count);
  for (const link of links) {
    const target = container.querySelector(link.getAttribute('href'));
    expect(target?.tagName).toBe('H2');
    expect(target?.textContent).toBe(link.textContent);
  }
  if (Page === Privacy) {
    expect(container).toHaveTextContent('not intended for children under 13');
    expect(container).toHaveTextContent('physically removed in scheduled batches');
    expect(container).toHaveTextContent('not microphone recordings');
  } else {
    expect(container).toHaveTextContent('without explicit permission');
    expect(container).toHaveTextContent('laws of the jurisdiction where Let Me Cook operates');
  }
});

it('narrow-screen policy contents are collapsible while every legal section remains readable', async () => {
  const previous = window.matchMedia;
  window.matchMedia = () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  try {
    const { container } = render(<MemoryRouter><Terms /></MemoryRouter>);
    const contentsToggle = screen.getByText('On this page', { selector: 'summary' });
    const contentsDisclosure = contentsToggle.closest('details');
    expect(contentsDisclosure).not.toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Use of the Website', level: 2 })).toBeVisible();
    expect(container).toHaveTextContent('without explicit permission');
    await userEvent.click(contentsToggle);
    expect(contentsDisclosure).toHaveAttribute('open');
    expect(within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')).toHaveLength(8);
  } finally {
    window.matchMedia = previous;
  }
});

it('contact saves the labelled fields and shows confirmation after the response', async () => {
  request.mockResolvedValueOnce({});
  render(<MemoryRouter><Contact /></MemoryRouter>);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your name'), 'Kitchen User');
  await user.type(screen.getByLabelText('Email address'), 'cook@example.test');
  await user.type(screen.getByLabelText('Message'), 'Please help with my account.');
  await user.click(screen.getByRole('button', { name: 'Save message' }));
  expect(request).toHaveBeenCalledWith('contact', expect.objectContaining({ body: { name: 'Kitchen User', email: 'cook@example.test', message: 'Please help with my account.' } }));
  expect(await screen.findByRole('status')).toHaveTextContent('saved to the local team inbox');
  expect(screen.getByLabelText('Your name')).toHaveValue('');
});

it('newsletter requires explicit subscription consent and preserves the reset action', async () => {
  request.mockResolvedValueOnce({ message: 'Open your confirmation email.' });
  render(<MemoryRouter initialEntries={['/newsletter']}><Newsletter /></MemoryRouter>);
  const user = userEvent.setup();
  expect(request).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Email address'), 'cook@example.test');
  const subscribe = screen.getByRole('button', { name: 'Subscribe' });
  await user.click(subscribe);
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox'));
  await user.click(subscribe);
  expect(request).toHaveBeenCalledWith('newsletter', expect.objectContaining({ body: { email: 'cook@example.test', consent: true } }));
  expect(await screen.findByRole('status')).toHaveTextContent('Open your confirmation email.');
  expect(subscribe).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Subscribe another email' }));
  expect(subscribe).toBeEnabled();
});

it.each([['confirm', 'Confirm subscription', 'newsletter/confirm'], ['unsubscribe', 'Unsubscribe', 'newsletter/unsubscribe']])('newsletter %s waits for its explicit action', async (action, label, endpoint) => {
  request.mockResolvedValueOnce({ message: 'Preferences updated.' });
  render(<MemoryRouter initialEntries={[`/newsletter?${action}=local-token`]}><Newsletter /></MemoryRouter>);
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: label }));
  expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ body: { token: 'local-token' } }));
  expect(await screen.findByRole('status')).toHaveTextContent('Preferences updated.');
});

it('newsletter rejects conflicting token actions without making a request', () => {
  render(<MemoryRouter initialEntries={['/newsletter?confirm=one&unsubscribe=two']}><Newsletter /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('two different actions');
  expect(screen.getByRole('link', { name: 'Back to newsletter' })).toHaveAttribute('href', '/newsletter');
  expect(request).not.toHaveBeenCalled();
});

it('leaving a contact page cancels its pending request', async () => {
  request.mockImplementationOnce(() => new Promise(() => {}));
  const { unmount } = render(<MemoryRouter><Contact /></MemoryRouter>);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Your name'), 'Kitchen User');
  await user.type(screen.getByLabelText('Email address'), 'cook@example.test');
  await user.type(screen.getByLabelText('Message'), 'Please help.');
  await user.click(screen.getByRole('button', { name: 'Save message' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const signal = request.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
});
