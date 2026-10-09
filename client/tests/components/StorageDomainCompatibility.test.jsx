import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RecipeImage from '../../src/components/RecipeImage';
import { ownProfile } from '../../src/utils/accountApi';

const fixture = vi.hoisted(() => ({
  auth: { user: { id: 'domain-reader' }, loading: false },
  normalize: vi.fn(), sign: vi.fn(), bucket: vi.fn(), json: vi.fn(),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../src/utils/httpClient', () => ({ httpClient: { json: fixture.json } }));
vi.mock('../../src/utils/supabaseClient', () => ({
  supabaseUrl: 'https://letmecook.ca',
  publicStorageUrl: fixture.normalize,
  supabase: { storage: { from: fixture.bucket } },
}));

beforeEach(() => {
  fixture.auth = { user: { id: 'domain-reader' }, loading: false };
  fixture.normalize.mockReset(); fixture.sign.mockReset(); fixture.bucket.mockReset(); fixture.json.mockReset();
  fixture.normalize.mockImplementation(value => value);
  fixture.bucket.mockReturnValue({ createSignedUrl: fixture.sign });
});

describe('existing storage URLs on the public domain', () => {
  it('normalizes an old recipe photo before checking its private storage bucket', async () => {
    const original = 'http://127.0.0.1:56421/storage/v1/object/public/recipe-images/chef/domain-photo.webp';
    const normalized = 'https://letmecook.ca/storage/v1/object/public/recipe-images/chef/domain-photo.webp';
    const signed = 'https://letmecook.ca/storage/v1/object/sign/recipe-images/chef/domain-photo.webp?token=test';
    fixture.normalize.mockReturnValue(normalized);
    fixture.sign.mockResolvedValue({ data: { signedUrl: signed }, error: null });
    render(<RecipeImage src={original} alt="Dinner" />);
    expect(fixture.normalize).toHaveBeenCalledWith(original);
    expect(fixture.bucket).toHaveBeenCalledWith('recipe-images');
    expect(fixture.sign).toHaveBeenCalledWith('chef/domain-photo.webp', 300);
    expect(await screen.findByRole('img', { name: 'Dinner' })).toHaveAttribute('src', signed);
    expect(document.querySelector(`img[src="${normalized}"]`)).toBeNull();
  });

  it('keeps a failed private photo unavailable instead of falling back to a public object URL', async () => {
    const original = 'http://127.0.0.1:56421/storage/v1/object/public/recipe-images/chef/restricted.webp';
    fixture.normalize.mockReturnValue('https://letmecook.ca/storage/v1/object/public/recipe-images/chef/restricted.webp');
    fixture.sign.mockResolvedValue({ data: null, error: new Error('Denied') });
    render(<RecipeImage src={original} alt="Restricted recipe" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Image unavailable'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('adapts a saved public profile photo without changing the account response', async () => {
    const original = 'http://127.0.0.1:56421/storage/v1/object/public/profile-images/chef/profile.webp';
    const normalized = 'https://letmecook.ca/storage/v1/object/public/profile-images/chef/profile.webp';
    const account = { id: 'chef', firstName: 'Alex', dietaryPreferences: [], allergyNames: [], imageUrl: original };
    fixture.json.mockResolvedValue(account); fixture.normalize.mockReturnValue(normalized);
    const result = await ownProfile();
    expect(fixture.json).toHaveBeenCalledWith('/account/profile', expect.objectContaining({ auth: 'required', contractVersion: 'account.v1' }));
    expect(fixture.normalize).toHaveBeenCalledWith(original);
    expect(result).toMatchObject({ id: 'chef', first_name: 'Alex', image_url: normalized });
    expect(account.imageUrl).toBe(original);
  });
});
