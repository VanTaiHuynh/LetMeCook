import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Sunny from '../../src/pages/Sunny';
const fixture=vi.hoisted(()=>({request:vi.fn(),cancel:vi.fn(),auth:{user:null,loading:false}}));
vi.mock('../../src/utils/sunnyApi',()=>({sunnyRequest:fixture.request}));
vi.mock('../../src/utils/aiControl',()=>({cancelAiRequest:fixture.cancel}));
vi.mock('../../src/context/AuthContext',()=>({useAuth:()=>fixture.auth}));
vi.mock('../../src/components/RecipeImage',()=>({default:props=><img {...props}/>}));
beforeEach(()=>{fixture.request.mockReset();fixture.cancel.mockReset();fixture.auth={user:null,loading:false};window.matchMedia=vi.fn(()=>({matches:true}));Element.prototype.scrollIntoView=vi.fn();});
const intent={allergies:['peanut'],dietaryPreferences:['vegan'],ingredients:[],maxCookingTime:30};
const context={signature:'fixture-signature',originalPrompt:'Vegan soup under30 minutes. No peanuts.',round:1,issuedAt:123};
const followUp={contractVersion:'local-ai.v2',status:'needs_clarification',recipes:[],totalMatches:0,intent,clarification:{context,questions:[{id:'dish',question:'What kind of soup?'}]}};
const mount=()=>render(<MemoryRouter><Sunny/></MemoryRouter>);
describe('Sunny signed clarification flow',()=>{
 it('shows questions instead of zero-match UX and returns untouched signed context with the original prompt',async()=>{
  fixture.request.mockImplementation(async(path,options)=>path==='status'?{status:'ready'}:options.body.clarificationAnswers?{status:'results',intent,recipes:[],totalMatches:0,warnings:[]}:followUp);
  mount();const user=userEvent.setup();await user.type(screen.getByLabelText('Your request'),context.originalPrompt);await user.click(screen.getByRole('button',{name:'Find my recipes'}));
  expect(await screen.findByRole('heading',{name:'A quick check'})).toBeVisible();expect(screen.queryByText('0 shown')).not.toBeInTheDocument();expect(screen.getByText('peanut')).toBeVisible();
  await user.type(screen.getByLabelText('What kind of soup?'),'Mushroom soup');await user.click(screen.getByRole('button',{name:'Confirm and find recipes'}));
  await waitFor(()=>expect(fixture.request.mock.calls.filter(([path])=>path==='search')).toHaveLength(2));const body=fixture.request.mock.calls.filter(([path])=>path==='search')[1][1].body;
  expect(body.prompt).toBe(context.originalPrompt);expect(body.clarificationContext).toEqual(context);expect(body.clarificationAnswers).toEqual({dish:'Mushroom soup'});
 });
 it('editing the original request resets signed context and pending answers',async()=>{
  fixture.request.mockImplementation(async path=>path==='status'?{status:'ready'}:followUp);mount();const user=userEvent.setup();await user.type(screen.getByLabelText('Your request'),context.originalPrompt);await user.click(screen.getByRole('button',{name:'Find my recipes'}));await screen.findByRole('heading',{name:'A quick check'});
  await user.click(screen.getByRole('button',{name:'Edit original request'}));await user.type(screen.getByLabelText('Your request'),' With carrots.');expect(screen.queryByRole('heading',{name:'A quick check'})).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Find my recipes'}));
  const searchCalls=fixture.request.mock.calls.filter(([path])=>path==='search');expect(searchCalls[1][1].body).not.toHaveProperty('clarificationContext');expect(searchCalls[1][1].body).not.toHaveProperty('clarificationAnswers');
 });
 it('Cancel aborts pending work and a late AI result cannot replace the unchanged form',async()=>{
  let resolve;let signal;fixture.request.mockImplementation((path,options)=>path==='status'?Promise.resolve({status:'ready'}):new Promise(done=>{resolve=done;signal=options.signal;}));mount();const user=userEvent.setup();await user.type(screen.getByLabelText('Your request'),'Soup');await user.click(screen.getByRole('button',{name:'Find my recipes'}));await user.click(screen.getByRole('button',{name:'Cancel search'}));
  expect(signal.aborted).toBe(true);expect(fixture.cancel).toHaveBeenCalledWith(signal);resolve({status:'results',intent,recipes:[{id:'late',title:'Late result'}]});await waitFor(()=>expect(screen.queryByText('Late result')).not.toBeInTheDocument());expect(screen.getByLabelText('Your request')).toHaveValue('Soup');
 });
});
