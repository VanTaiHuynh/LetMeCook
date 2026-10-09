import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CookAlong, { CookContent } from '../../src/pages/CookAlong';
const fixture=vi.hoisted(()=>({session:{},context:{},request:vi.fn(),audio:[]}));
vi.mock('../../src/context/AuthContext',()=>({useAuth:()=>({user:{id:'actor-fixture'}})}));
vi.mock('../../src/components/KitchenShell',()=>({default:({children})=><main>{children}</main>}));
vi.mock('../../src/utils/useKitchen',()=>({useKitchen:()=>fixture.context,useKitchenResource:()=>({data:fixture.session,loading:false,error:'',reload:vi.fn()})}));
vi.mock('../../src/utils/kitchenApi',()=>({kitchenRequest:fixture.request}));
vi.mock('../../src/utils/aiControl',()=>({cancelAiRequest:vi.fn()}));
beforeEach(()=>{
 vi.useFakeTimers(); fixture.request.mockReset(); fixture.audio=[];
 const BrowserURL=URL;class AudioURL extends BrowserURL{}AudioURL.createObjectURL=vi.fn(()=>"blob:saved-flow");AudioURL.revokeObjectURL=vi.fn();vi.stubGlobal('URL',AudioURL);
 vi.stubGlobal('Audio',class{constructor(){this.play=vi.fn(async()=>{});this.pause=vi.fn();fixture.audio.push(this);}});
 fixture.request.mockImplementation(async(_path,options)=>options.method==='PATCH'?({...fixture.session,...options.body,version:options.body.version+1}):({local:true,audioBase64:'UklGRg==',mimeType:'audio/wav'}));
 vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));fixture.session={id:'session-fixture',recipeId:'recipe-fixture',recipeTitle:'Source soup',servings:2,version:1,status:'active',stepIndex:0,steps:['Stir for 2 minutes.','Serve the food.'],timers:[]};
 fixture.context={data:{pantry:[],scope:{revision:1}},householdId:null,canEdit:true,busy:'',setError:vi.fn(),setNotice:vi.fn(),mutate:vi.fn(async(_label,_path,body)=>({...fixture.session,...body,version:body.version+1}))};
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
const mount=()=>render(<MemoryRouter initialEntries={['/cook-along/session-fixture']}><Routes><Route path="/cook-along/:id" element={<CookAlong/>}/></Routes></MemoryRouter>);
describe('actual cooking timer controls',()=>{
 const settle=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
 const timed=async()=>{fireEvent.click(screen.getByRole('button',{name:'Timed flow'}));fireEvent.click(screen.getByText('Edit timings',{selector:'summary'}));fireEvent.change(screen.getByLabelText('Step 1 wait minutes'),{target:{value:'0'}});fireEvent.click(screen.getByRole('button',{name:'Start timed flow'}));await settle();};

 it('starts the saved recipe flow directly with its automatic wait and saves only after that wait',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Timed flow'}));
  expect(screen.getByText('Edit timings',{selector:'summary'}).parentElement).not.toHaveAttribute('open');
  expect(screen.getByLabelText('Step 1 wait minutes')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Start timed flow'}));await settle();
  expect(fixture.request.mock.calls.some(([,options])=>options.method==='PATCH')).toBe(false);
  await act(async()=>fixture.audio[0].onended());expect(screen.getByRole('timer',{name:'Time until next step'})).toHaveTextContent('02:00');
  await act(async()=>vi.advanceTimersByTime(119000));expect(fixture.audio).toHaveLength(1);expect(fixture.request.mock.calls.some(([,options])=>options.method==='PATCH')).toBe(false);
  await act(async()=>vi.advanceTimersByTime(1000));await settle();
  expect(screen.getByText('Serve the food.',{selector:'.kitchen-step-text'})).toBeVisible();expect(fixture.audio).toHaveLength(2);
  expect(fixture.request.mock.calls.filter(([,options])=>options.method==='PATCH')).toHaveLength(1);expect(fixture.context.mutate).not.toHaveBeenCalled();
 });

 it('discards a pending microphone permission after a tab switch even when the tab returns before permission resolves',async()=>{
  let resolvePermission;const oldStop=vi.fn(),freshStop=vi.fn();const oldStream={getTracks:()=>[{stop:oldStop}]},freshStream={getTracks:()=>[{stop:freshStop}]};
  const getUserMedia=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolvePermission=resolve;})).mockResolvedValueOnce(freshStream);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});const constructed=vi.fn(),started=vi.fn();
  vi.stubGlobal('MediaRecorder',class{static isTypeSupported(){return true;}constructor(stream){constructed(stream);this.state='inactive';this.mimeType='audio/webm';}start(){started();this.state='recording';}stop(){this.state='inactive';this.onstop?.();}});
  const content=isActive=><MemoryRouter><CookContent id='session-fixture' recipeId='recipe-fixture' embedded isActive={isActive}/></MemoryRouter>;
  const view=render(content(true));fireEvent.change(screen.getByLabelText('Your question'),{target:{value:'Can I prepare the potatoes early?'}});
  fireEvent.click(screen.getByRole('button',{name:'Record a question'}));expect(getUserMedia).toHaveBeenCalledWith({audio:true});
  view.rerender(content(false));view.rerender(content(true));await act(async()=>resolvePermission(oldStream));await settle();
  expect(oldStop).toHaveBeenCalledTimes(1);expect(constructed).not.toHaveBeenCalled();expect(started).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Stop & transcribe'})).not.toBeInTheDocument();
  expect(screen.getByLabelText('Your question')).toHaveValue('Can I prepare the potatoes early?');expect(fixture.request).not.toHaveBeenCalled();expect(fixture.context.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Record a question'}));await settle();expect(constructed).toHaveBeenCalledOnce();expect(constructed).toHaveBeenCalledWith(freshStream);expect(started).toHaveBeenCalledOnce();
  expect(screen.getByRole('button',{name:'Stop & transcribe'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancel recording'}));expect(freshStop).toHaveBeenCalled();expect(fixture.request).not.toHaveBeenCalled();
 });
 it('waits for the authenticated step update before reading next, without confirming a meal or consuming stock',async()=>{
  let resolvePatch;fixture.request.mockImplementation((_path,options)=>options.method==='PATCH'?new Promise(resolve=>{resolvePatch=resolve;}):Promise.resolve({local:true,audioBase64:'UklGRg==',mimeType:'audio/wav'}));
  mount();await timed();await act(async()=>{fixture.audio[0].onended();});await settle();
  expect(fixture.audio).toHaveLength(1);expect(screen.getByRole('button',{name:'Done, next step'})).toBeDisabled();
  const patch=fixture.request.mock.calls.find(([,options])=>options.method==='PATCH');expect(patch[0]).toBe('/sessions/session-fixture');expect(patch[1].body).toMatchObject({version:1,stepIndex:1,timers:[]});expect(patch[1].signal.aborted).toBe(false);
  await act(async()=>resolvePatch({...fixture.session,version:2,stepIndex:1}));await settle();
  expect(screen.getByText('Serve the food.',{selector:'.kitchen-step-text'})).toBeVisible();expect(fixture.audio).toHaveLength(2);
  await act(async()=>fixture.audio[1].onended());await settle();expect(screen.getByText('Reading complete.')).toBeVisible();
  expect(fixture.context.mutate).not.toHaveBeenCalled();expect(screen.getByRole('checkbox',{name:'I cooked this meal and checked the amounts used.'})).not.toBeChecked();
 });
 it('halts on a failed authenticated step save instead of reading unsaved instructions',async()=>{
  fixture.request.mockImplementation((_path,options)=>options.method==='PATCH'?Promise.reject(new Error('Session changed. Refresh your session.')):Promise.resolve({local:true,audioBase64:'UklGRg==',mimeType:'audio/wav'}));
  mount();await timed();await act(async()=>fixture.audio[0].onended());await settle();
  expect(screen.getByText('Session changed. Refresh your session.')).toBeVisible();expect(screen.getByText('Stir for 2 minutes.',{selector:'.kitchen-step-text'})).toBeVisible();expect(fixture.audio).toHaveLength(1);expect(screen.getByRole('button',{name:'Start timed flow'})).toBeEnabled();
 });
 it('aborts pending auto-advance on Stop flow and ignores a late successful response',async()=>{
  let resolvePatch;fixture.request.mockImplementation((_path,options)=>options.method==='PATCH'?new Promise(resolve=>{resolvePatch=resolve;}):Promise.resolve({local:true,audioBase64:'UklGRg==',mimeType:'audio/wav'}));
  mount();await timed();await act(async()=>fixture.audio[0].onended());await settle();const patch=fixture.request.mock.calls.find(([,options])=>options.method==='PATCH');
  fireEvent.click(screen.getByRole('button',{name:'Stop flow'}));expect(patch[1].signal.aborted).toBe(true);
  await act(async()=>resolvePatch({...fixture.session,version:2,stepIndex:1}));await settle();expect(screen.getByText('Stir for 2 minutes.',{selector:'.kitchen-step-text'})).toBeVisible();expect(fixture.audio).toHaveLength(1);
 });
 it('offers an explicit fresh start from a completed embedded session while preserving its saved record',async()=>{
  fixture.session.status='completed';const restart=vi.fn();render(<MemoryRouter><CookContent id='session-fixture' recipeId='recipe-fixture' embedded onCookAgain={restart}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Cook this recipe again'}));expect(restart).toHaveBeenCalledTimes(1);expect(fixture.session.status).toBe('completed');expect(fixture.context.mutate).not.toHaveBeenCalled();
 });

 it('requires user confirmation to start a source duration, saves an absolute end, never advances and acknowledges through CAS',async()=>{
  mount();expect(screen.getByRole('heading',{level:1,name:'Source soup'})).toBeVisible();
  const guidance=screen.getByRole('button',{name:'Start guided cooking'});const instruction=screen.getByText('Stir for 2 minutes.',{selector:'.kitchen-step-text'});
  expect(guidance.compareDocumentPosition(instruction)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(instruction.compareDocumentPosition(screen.getByRole('button',{name:'Set 2 minutes'}))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Set 2 minutes'}));expect(fixture.context.mutate).not.toHaveBeenCalled();expect(screen.getByLabelText('Minutes')).toHaveValue(2);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Start timer'})));const payload=fixture.context.mutate.mock.calls[0][2];expect(payload).toMatchObject({version:1,stepIndex:0});expect(payload.timers[0]).toMatchObject({endsAt:'2026-10-08T12:02:00.000Z',running:true,acknowledged:false,durationSeconds:120});
  await act(async()=>{vi.advanceTimersByTime(130000);});expect(screen.getByRole('alert')).toHaveTextContent('Step 1 timer finished');expect(screen.getByText('Stir for 2 minutes.',{selector:'.kitchen-step-text'})).toBeVisible();expect(fixture.context.mutate).toHaveBeenCalledTimes(1);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Acknowledge Step 1'})));expect(fixture.context.mutate.mock.lastCall[2]).toMatchObject({version:2,timers:[{...payload.timers[0],running:false,acknowledged:true}]});expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('refreshes the absolute countdown when the tab returns without restarting a saved timer',async()=>{
  fixture.session.timers=[{id:'saved',label:'Rest',endsAt:'2026-10-08T12:01:00.000Z',running:true,durationSeconds:60,acknowledged:false}];mount();expect(screen.getByRole('timer')).toHaveTextContent('01:00');
  vi.setSystemTime(new Date('2026-10-08T12:10:00Z'));await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(screen.getByRole('timer')).toHaveTextContent('Finished');expect(screen.getByRole('alert')).toHaveTextContent('Rest timer finished');expect(fixture.context.mutate).not.toHaveBeenCalled();
 });
});
