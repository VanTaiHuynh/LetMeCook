import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RouteErrorBoundary from '../../src/components/RouteErrorBoundary.jsx';
import { recoverStaleAssetError } from '../../src/utils/staleAssetRecovery.js';

vi.mock('../../src/utils/staleAssetRecovery.js', () => ({ recoverStaleAssetError: vi.fn(() => false) }));

function FailingPage({ error }) { throw error; }
const mount = (children) => render(<MemoryRouter><RouteErrorBoundary>{children}</RouteErrorBoundary></MemoryRouter>);

beforeEach(() => {
  recoverStaleAssetError.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('route error recovery', () => {
  it('passes rejected lazy imports to the same bounded recovery used by Vite', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/Sunny-old.js');
    mount(<FailingPage error={error} />);
    expect(recoverStaleAssetError).toHaveBeenCalledTimes(1);
    expect(recoverStaleAssetError).toHaveBeenCalledWith(error);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });

  it('keeps a manual error screen and recipe link when bounded recovery declines', () => {
    mount(<FailingPage error={new TypeError('Cannot read properties of null')} />);
    expect(screen.getByRole('heading', { name: 'Let’s try that again' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse recipes' })).toHaveAttribute('href', '/recipes');
  });

  it('renders a healthy route without requesting recovery', () => {
    mount(<p>Your recipe is ready.</p>);
    expect(screen.getByText('Your recipe is ready.')).toBeVisible();
    expect(recoverStaleAssetError).not.toHaveBeenCalled();
  });
});
