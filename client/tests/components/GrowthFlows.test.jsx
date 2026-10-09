import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AfterCooking from '../../src/features/growth/AfterCooking';
import PreferenceSharing from '../../src/features/growth/PreferenceSharing';
import Leftovers from '../../src/features/growth/Leftovers';
const fixture = vi.hoisted(() => ({ context: {}, resources: {}, reload: vi.fn() }));
vi.mock('../../src/utils/useKitchen', () => ({ useKitchen: () => fixture.context,
  useKitchenResource: path => ({ data: fixture.resources[path], loading: false, error: '', reload: fixture.reload }) }));
beforeEach(() => {
  fixture.context = { householdId: 'household-fixture', canEdit: true, busy: '', mutate: vi.fn(), setNotice: vi.fn(), setError: vi.fn() };
  fixture.resources = { '/taste-feedback': { feedback: [] }, '/leftovers': { leftovers: [] }, '/households/household-fixture/preference-sharing': { enabled: false, version: 0 } };
});
const wrap = component => render(<MemoryRouter>{component}</MemoryRouter>);
describe('private growth features', () => {
  it('saves soft taste feedback on a completed session without sending actor or household identities', async () => {
    fixture.context.mutate.mockResolvedValue({ version: 1 }); const user = userEvent.setup();
    wrap(<AfterCooking session={{ id: 'session-fixture' }} />);
    await user.click(screen.getByText('How did it taste?')); await user.selectOptions(screen.getByLabelText('Would you cook it again?'), '5');
    await user.type(screen.getByLabelText('Ingredients you prefer less'), 'Cilantro, cilantro');
    await user.click(screen.getByRole('button', { name: 'Save my feedback' }));
    expect(fixture.context.mutate).toHaveBeenCalledWith('Save my taste feedback', '/sessions/session-fixture/taste-feedback', { version:0,rating:5,likedIngredients:[],avoidedIngredients:['Cilantro'],preferredCuisines:[],note:'' }, 'PUT', false);
    expect(screen.getByText(/Allergies stay in your profile/)).toBeVisible();
  });
  it('requires explicit leftover confirmation and retains the same receipt across a failed retry', async () => {
    fixture.context.mutate.mockResolvedValue(null); const user = userEvent.setup(); wrap(<AfterCooking session={{ id: 'session-fixture' }} />);
    await user.click(screen.getByText('Save leftovers')); expect(screen.getByRole('button', { name: 'Save confirmed leftovers' })).toBeDisabled();
    await user.type(screen.getByLabelText('Servings left'), '2'); await user.click(screen.getByLabelText('I checked these portions and dates.'));
    await user.click(screen.getByRole('button', { name: 'Save confirmed leftovers' })); await user.click(screen.getByRole('button', { name: 'Save confirmed leftovers' }));
    const first = fixture.context.mutate.mock.calls[0][2]; const retry = fixture.context.mutate.mock.calls[1][2];
    expect(first).toEqual(retry); expect(first).toMatchObject({sessionId:'session-fixture',servingsAvailable:2,confirmed:true,useBy:null});
    expect(first).not.toHaveProperty('consumption'); expect(first).not.toHaveProperty('userId');
  });
  it('lets a viewer self opt in and revoke with the returned version', async () => {
    fixture.context.canEdit = false; fixture.context.mutate.mockResolvedValueOnce({ enabled:true,version:4 }).mockResolvedValueOnce({enabled:false,version:5});
    const user = userEvent.setup(); wrap(<PreferenceSharing />); await user.click(screen.getByText('My preference sharing'));
    await user.click(screen.getByRole('button', { name: 'Share my preferences' })); expect(fixture.context.mutate.mock.calls[0][2]).toEqual({ enabled:true,version:0 });
    await user.click(screen.getByRole('button', { name: 'Revoke my sharing' })); expect(fixture.context.mutate.mock.calls[1][2]).toEqual({ enabled:false,version:4 });
    expect(screen.getByText(/Sharing is off/)).toBeVisible();
  });
  it('never offers consume for expired leftovers or stock writes to a viewer', async () => {
    fixture.resources['/leftovers'] = { leftovers: [{id:'leftover-fixture',version:1,title:'Saved soup',servingsAvailable:2,cookedOn:'2020-01-01',useBy:'2020-01-02'}] };
    wrap(<Leftovers />); await userEvent.click(screen.getByText('Prepared leftovers'));
    expect(screen.getByText(/Past your use-by date/)).toBeVisible(); expect(screen.queryByText('Record eaten portions')).not.toBeInTheDocument();
  });
});
