import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import IndividualRecipe from '../../src/pages/IndividualRecipe';
import ReviewList from '../../src/components/ReviewList';
const fixture = vi.hoisted(() => ({ auth: {user:null,loading:false}, detail:vi.fn(),reviews:vi.fn(),ratings:vi.fn(),activity:vi.fn() }));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../../src/utils/recipeReadClient', () => ({ recipeReadClient: {detail:fixture.detail,reviews:fixture.reviews,ratings:fixture.ratings} }));
vi.mock('../../src/utils/recipeReads', () => ({ REVIEW_PAGE_SIZE:12,recordRecipeActivity:fixture.activity }));
vi.mock('../../src/utils/api', () => ({ apiUrl: path => '/api'+path }));
vi.mock('../../src/utils/supabaseClient', () => ({ supabase:{} }));
vi.mock('../../src/components/SEO', () => ({ RecipeSEO: ({recipe}) => <output aria-label="SEO recipe">{recipe?.title || 'no recipe metadata'}</output> }));
vi.mock('../../src/components/RecipeDetailCard', () => ({default:({recipe})=><p>{recipe.directions}</p>}));
vi.mock('../../src/components/RecipeImage', () => ({default:props=><img {...props}/>}));
vi.mock('../../src/components/CarouselSection', () => ({default:()=>null}));
vi.mock('../../src/components/ReviewForm', () => ({default:()=>null}));
beforeEach(() => {
  fixture.auth={user:null,loading:false}; fixture.detail.mockReset(); fixture.reviews.mockReset(); fixture.ratings.mockReset(); fixture.activity.mockReset();
  fixture.ratings.mockImplementation(async ids => Object.fromEntries(ids.map(id => [id, { overall: null, overallCount: 0 }])));
  fixture.reviews.mockResolvedValue({content:[],page:0,totalElements:0,totalPages:0}); fixture.activity.mockResolvedValue([]);
  window.scrollTo=vi.fn(); window.matchMedia=vi.fn(()=>({matches:true}));
});
const mount = () => render(<MemoryRouter initialEntries={['/recipes/recipe-fixture']}><Routes><Route path="/recipes/:id" element={<IndividualRecipe/>}/></Routes></MemoryRouter>);
describe('recipe recovery and paged reviews', () => {
  it('recovers a service error using Retry and preserves loaded recipe after failed best-effort activity', async () => {
    fixture.detail.mockRejectedValueOnce(Object.assign(new Error('Temporarily unavailable.'),{status:500})).mockResolvedValueOnce({id:'recipe-fixture',title:'Source soup',ingredients:[],description:'Original description',directions:'Stir gently.',createdAt:'2024-01-01'});
    fixture.activity.mockResolvedValue([{status:'rejected',reason:new Error('History unavailable')}]); mount();
    expect(await screen.findByRole('heading',{name:'Recipe could not be loaded'})).toBeVisible(); expect(screen.getByLabelText('SEO recipe')).toHaveTextContent('no recipe metadata');
    await userEvent.click(screen.getByRole('button',{name:'Retry'})); expect(await screen.findByRole('heading',{name:'Source soup'})).toBeVisible();
    expect(screen.getByLabelText('SEO recipe')).toHaveTextContent('Source soup'); expect(fixture.activity).toHaveBeenCalledTimes(1);
  });
  it('404 renders unavailable instead of an endless spinner or misleading Retry', async () => {
    fixture.detail.mockRejectedValue(Object.assign(new Error('Not found'),{status:404})); mount();
    expect(await screen.findByRole('heading',{name:'Recipe not found'})).toBeVisible(); expect(screen.queryByRole('button',{name:'Retry'})).not.toBeInTheDocument();
  });
  it('account switch aborts the old detail request and prevents private content and metadata appearing late', async () => {
    let resolve; let oldSignal;
    fixture.auth={user:{id:'actor-a'},loading:false}; fixture.detail.mockImplementationOnce((_id,options)=>{oldSignal=options.signal;return new Promise(done=>{resolve=done;});}).mockResolvedValueOnce({id:'recipe-fixture',title:'Public soup',ingredients:[],createdAt:'2024-01-01'});
    const view=mount(); fixture.auth={user:{id:'actor-b'},loading:false}; view.rerender(<MemoryRouter initialEntries={['/recipes/recipe-fixture']}><Routes><Route path="/recipes/:id" element={<IndividualRecipe/>}/></Routes></MemoryRouter>);
    expect(oldSignal.aborted).toBe(true); resolve({id:'recipe-fixture',title:'Private actor A soup',ingredients:[]});
    expect(await screen.findByRole('heading',{name:'Public soup'})).toBeVisible(); expect(screen.queryByText('Private actor A soup')).not.toBeInTheDocument();
  });
  it('asks the server for page12-sized windows and resets page when changing sort across over1000 reviews', async () => {
    fixture.reviews.mockImplementation(async(_id,opts)=>({content:[{id:String(opts.page),comment:`Page ${opts.page}`,created_at:'2024-01-01',review_ratings:[]}],page:opts.page,totalElements:1105,totalPages:93}));
    render(<ReviewList recipeId="recipe-fixture"/>); expect(await screen.findByText('Page 0')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'Next'})); expect(await screen.findByText('Page 1')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Sort reviews'),'rating'); await waitFor(()=>expect(fixture.reviews.mock.lastCall[1]).toMatchObject({page:0,sort:'rating',order:'desc'}));
    expect(fixture.reviews.mock.calls.every(([,opts])=>!Object.hasOwn(opts,'size'))).toBe(true);
  });
});
