import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport } from './httpTransport.js';
import { createAiTransport } from './aiTransport.js';
test('explicit cancel followed by abort sends exactly one actor-bound remote cancellation', async () => {
  const session = {user:{id:'actor-a'},access_token:'fixture-a'}; let sent; const cancellations=[];
  const transport=createHttpTransport({getSession:async()=>({data:{session}}),fetcher:async(_url,opts)=>{sent=opts;return new Promise(()=>{});}});
  const ai=createAiTransport({transport,cancelRequest:async entry=>{cancellations.push({id:entry.requestId,token:entry.cancelToken,actor:entry.session.user.id});}});
  const controller=new AbortController(); const work=ai.request('/ai/search',{signal:controller.signal,actorId:'actor-a'});
  await new Promise(resolve=>setImmediate(resolve)); const token=sent.headers.get('X-Local-AI-Cancel-Token');
  await ai.cancel(controller.signal); controller.abort(); await assert.rejects(work,error=>error.name==='AbortError');
  assert.equal(cancellations.length,1); assert.equal(cancellations[0].actor,'actor-a'); assert.equal(cancellations[0].token,token);
  assert.equal(await ai.cancel(controller.signal),null);
});
test('deadline cancels server inference even when no caller signal was supplied', async () => {
  const cancellations=[]; const transport=createHttpTransport({getSession:async()=>({data:{session:null}}),fetcher:async()=>new Promise(()=>{})});
  const ai=createAiTransport({transport,cancelRequest:async entry=>cancellations.push({id:entry.requestId,session:entry.session})});
  await assert.rejects(ai.request('/ai/search',{timeoutMs:5}),error=>error.status===504); assert.equal(cancellations.length,1); assert.equal(cancellations[0].session,null);
});
test('abort before auth resolution sends neither inference nor cancellation', async () => {
  let resolve; let calls=0; let cancels=0; const transport=createHttpTransport({getSession:()=>new Promise(done=>{resolve=done;}),fetcher:async()=>{calls++;return new Response('{}');}});
  const ai=createAiTransport({transport,cancelRequest:async()=>{cancels++;}});const controller=new AbortController();const work=ai.request('/ai/search',{signal:controller.signal});
  controller.abort(); await assert.rejects(work,error=>error.name==='AbortError');resolve({data:{session:null}});await Promise.resolve();assert.equal(calls,0);assert.equal(cancels,0);
});
