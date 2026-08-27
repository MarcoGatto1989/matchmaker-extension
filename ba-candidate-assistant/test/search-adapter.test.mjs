import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load() {
  const context={globalThis:null,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};context.globalThis=context;vm.createContext(context);
  for(const file of ['../src/adapters/normalizers-global.js','../src/adapters/ba-search-adapter-global.js'])vm.runInContext(await readFile(new URL(file,import.meta.url),'utf8'),context);
  return context.BAKandidaten.searchAdapter;
}

test('search adapter processes only visible already-rendered candidate-like cards',async()=>{
  const adapter=await load();
  const visible={innerText:'Lohn- und Gehaltsbuchhalter/in\n18055 Rostock (Umkreis 30 km)\n8 Jahre Berufserfahrung\nAb sofort',getClientRects:()=>[{}],offsetWidth:100,offsetHeight:20};
  const hidden={innerText:'Steuerfachangestellte/r\n50667 Köln\n5 Jahre Berufserfahrung',getClientRects:()=>[],offsetWidth:0,offsetHeight:0};
  const document={querySelectorAll:()=>[visible,hidden]};
  const cards=adapter.extractVisibleSearchCards(document);
  assert.equal(cards.length,1);
  assert.match(cards[0].title,/Lohn/);
  assert.equal(cards[0].postalCode,'18055');
});
