import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicationControls from '../../src/features/creator/PublicationControls';
import PublicCollection from '../../src/pages/PublicCollection';
const fixture=vi.hoisted(()=>({context:{},resource:{},catalog:vi.fn()}));
vi.mock('../../src/utils/useKitchen',()=>({useKitchen:()=>fixture.context,useKitchenResource:()=>({data:fixture.resource,loading:false,error:'',reload:vi.fn()})}));
vi.mock('../../src/utils/catalogApi',()=>({catalogRequest:fixture.catalog}));
vi.mock('../../src/components/RecipeImage',()=>({default:props=><img {...props}/>}));
vi.mock('../../src/components/SEO',()=>({CollectionSEO:({collection})=><output aria-label="collection metadata">{collection?.name||'unavailable metadata'}</output>}));
beforeEach(()=>{fixture.context={isOwner:true,busy:'',mutate:vi.fn(),setNotice:vi.fn()};fixture.resource={featureEnabled:false,published:false,version:0,eligibleRecipeCount:0,omittedRecipeCount:0};fixture.catalog.mockReset();});
const controls=()=>render(<MemoryRouter><PublicationControls/></MemoryRouter>);
const collection=()=>render(<MemoryRouter initialEntries={['/collections/source-kitchen']}><Routes><Route path="/collections/:slug" element={<PublicCollection/>}/></Routes></MemoryRouter>);
describe('creator public permission boundary',()=>{
 it('disabled rollout shows a short state without a publish action',async()=>{controls();await userEvent.click(screen.getByText('Public collection'));expect(screen.getByText('Public collections are currently unavailable.')).toBeVisible();expect(screen.queryByRole('button',{name:'Publish collection'})).not.toBeInTheDocument();});
 it('requires an explicit permission acknowledgement and current CAS version before publishing',async()=>{
  fixture.resource={featureEnabled:true,published:false,version:3,slug:'source-kitchen',eligibleRecipeCount:2,omittedRecipeCount:1};fixture.context.mutate.mockResolvedValue({...fixture.resource,published:true,version:4});controls();await userEvent.click(screen.getByText('Public collection'));
  expect(screen.getByRole('button',{name:'Publish collection'})).toBeDisabled();await userEvent.click(screen.getByLabelText(/I checked the recipe and original photo permissions/));await userEvent.click(screen.getByRole('button',{name:'Publish collection'}));
  expect(fixture.context.mutate.mock.calls[0][2]).toEqual({slug:'source-kitchen',published:true,version:3,publishingAcknowledged:true});expect(screen.getByRole('button',{name:'Unpublish collection'})).toBeVisible();
 });
 it('allows unpublishing even after the operator disables publication',async()=>{
  fixture.resource={featureEnabled:false,published:true,version:9,slug:'source-kitchen',eligibleRecipeCount:0};controls();await userEvent.click(screen.getByText('Public collection'));await userEvent.click(screen.getByRole('button',{name:'Unpublish collection'}));expect(fixture.context.mutate.mock.calls[0][2]).toMatchObject({published:false,version:9,publishingAcknowledged:false});
 });
 it('renders only the public creator response and hides metadata on unavailable collection',async()=>{
  fixture.catalog.mockRejectedValue(Object.assign(new Error('Unavailable'),{status:404}));collection();expect(await screen.findByRole('heading',{name:'Collection unavailable'})).toBeVisible();expect(screen.getByLabelText('collection metadata')).toHaveTextContent('unavailable metadata');expect(screen.queryByRole('button',{name:'Retry'})).not.toBeInTheDocument();
 });
});
