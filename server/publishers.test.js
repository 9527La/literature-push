import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_JOURNALS } from './journals.js';
import { validateJournal, collectJournal, articlePlatform } from './publishers.js';
import { decodeEntities, readResponseText } from './utils.js';
import { internals } from './sources.js';
import { requestJson } from './http.js';
import { enrichAllMissingMetadata } from './metadata-backfill.js';

test('every configured journal resolves to a supported platform',()=>{
 assert.equal(DEFAULT_JOURNALS.length,17);
 for(const journal of DEFAULT_JOURNALS) assert.ok(validateJournal(journal).platform);
 assert.equal(validateJournal({name:'New Journal',publisher:'elsevier',issns:['1234-567X']}).platform,'elsevier');
 assert.throws(()=>validateJournal({name:'Bad',platform:'wanfang'}),/source id/);
});
test('publisher routing preserves partial failures and never calls IEEE for Elsevier',async()=>{
 const calls=[];let diagnostics;
 const result=await collectJournal({name:'Energy'}, {onDiagnostics:value=>diagnostics=value}, {
 config:{publicDataSources:['ieee','crossref','openalex'],ieeeApiKey:'test'},dedupe:x=>x,
 adapters:{crossref:async()=>{calls.push('crossref');throw Error('unavailable')},openalex:async()=>{calls.push('openalex');return [{title:'ok'}]},ieee:async()=>{throw Error('wrong adapter')}}});
 assert.deepEqual(calls,['crossref','openalex']);assert.equal(result.length,1);assert.equal(diagnostics.sources[0].status,'error');
});
test('DOI deduplication works across source identity formats',()=>{
 const rows=internals.dedupeArticles([{external_id:'10.1/ABC',doi:'10.1/ABC',title:'A',journal:'Power &amp; Energy'}, {external_id:'doi:10.1/abc',doi:'https://doi.org/10.1/abc',abstract:'B'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].abstract,'B');assert.equal(rows[0].journal,'Power & Energy');
});
test('entities and legacy encodings do not produce display garbage',async()=>{
 assert.equal(decodeEntities('A&nbsp;&alpha;&#x1F600; &amp; B'),'A α😀 & B');
 assert.equal(decodeEntities('&#99999999;'),'&#99999999;');
 assert.equal(await readResponseText(new Response(Uint8Array.from([0xd6,0xd0,0xce,0xc4]),{headers:{'content-type':'text/html; charset=gbk'}})),'中文');
 await assert.rejects(readResponseText(new Response(Uint8Array.from([0xff]))));
});
test('publisher hostname matching does not accept impostor domains',()=>{
 assert.equal(articlePlatform({url:'https://sciencedirect.com.evil.invalid/'}),'generic');
 assert.equal(articlePlatform({doi:'10.1016/test'}),'elsevier');
});
test('shared transport retries transient status but not forbidden',async()=>{
 const original=globalThis.fetch;let calls=0;
 try {
 globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):Response.json({ok:true});
 assert.deepEqual(await requestJson('https://test.invalid',{}, {retryDelayMs:0}),{ok:true});assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:403})};
 await assert.rejects(requestJson('https://test.invalid'),/403/);assert.equal(calls,1);
 } finally {globalThis.fetch=original;}
});
test('failed first batches do not starve later missing articles',async()=>{
 let calls=0;let missing=101;
 const result=await enrichAllMissingMetadata({getGaps:()=>({abstracts:missing,keywords:0}),
 enrichKeywords:async()=>({processed:0}),enrichAbstracts:async({excludeIds})=>{
 calls++; if(calls===1){assert.equal(excludeIds.length,0);return {processed:50,attemptedIds:Array.from({length:50},(_,i)=>i+1)}}
 if(calls===2){assert.equal(excludeIds.length,50);return {processed:50,attemptedIds:Array.from({length:50},(_,i)=>i+51)}}
 if(calls===3){missing--;return {processed:1,enrichedAbstracts:1,attemptedIds:[101]}}
 return {processed:0};}});
 assert.equal(calls,4);assert.equal(result.enrichedAbstracts,1);assert.equal(result.complete,false);
});
