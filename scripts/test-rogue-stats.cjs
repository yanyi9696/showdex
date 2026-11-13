'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {test} = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const table = values => Object.fromEntries(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((s, i) => [s, values[i]]));
const normalize = value => JSON.parse(JSON.stringify(value));
const raw = {Golduck: table([80,82,78,95,80,85]), Smeargle: table([55,20,35,20,45,75]),
  Ditto: table([48,48,48,48,48,48]), Zoroark: table([60,105,60,120,60,105])};
const species = name => ({name, baseSpecies:name, baseStats:raw[name], types:['Normal'], abilities:{0:'Damp'}, exists:true});
const dex = {species:{get:species}, abilities:{get:name=>({name,exists:true})},
  items:{get:name=>({name,exists:true})}, moves:{get:name=>({name,exists:true})}};
const core = {formatId:id, nonEmptyObject:value=>!!value && !!Object.keys(value).length,
  clamp:(min,value,max=Infinity)=>Math.min(max,Math.max(min,value)),
  similarArrays:(a,b)=>JSON.stringify(a)===JSON.stringify(b), env:{int:()=>9, bool:()=>true}};
const dexUtils = {getDexForFormat:()=>dex, detectGenFromFormat:()=>9, detectLegacyGen:()=>false,
  getDefaultSpreadValue:kind=>kind==='iv'?31:0, hasMegaForme:()=>false};
const cache = {}, overrides = {};
function load(file) {
  if (cache[file]) return cache[file];
  const module = {exports:{}}; cache[file]=module.exports;
  const {outputText}=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  vm.runInNewContext(outputText,{module,exports:module.exports,__DEV__:false,structuredClone,
    require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
      throw new Error(`Unexpected dependency ${name} from ${file}`);
    }},{filename:file});
  return module.exports;
}
const statsConsts = load('src/consts/dex/stats.ts'), natures = load('src/consts/dex/natures.ts');
overrides['@showdex/consts/dex']={...statsConsts,...natures,PokemonTypes:['Normal','Water','Psychic']};
overrides['@showdex/utils/core']=core; overrides['@showdex/utils/dex']=dexUtils;
overrides['@showdex/utils/battle/readRogueBaseStats']=load('src/utils/battle/readRogueBaseStats.ts');
overrides['@showdex/utils/presets']={flattenAlts:values=>values};
overrides['@showdex/utils/humanize']={capitalize:value=>value};
overrides['./detectPlayerKey']={detectPlayerKeyFromPokemon:()=> 'p1'};
overrides['./detectPokemonIdent']={detectPokemonIdent:p=>p?.ident || 'p1: Test'};
overrides['./detectSpeciesForme']={detectSpeciesForme:p=>p?.speciesForme};
overrides['./detectToggledAbility']={detectToggledAbility:()=>false};
overrides['./sanitizeMoveTrack']={sanitizeMoveTrack:p=>p?.moveTrack || []};
const calc = load('src/utils/calc/calcPokemonSpreadStats.ts');
overrides['@showdex/utils/calc']={...calc,calcPokemonCalcdexId:()=> 'qa',
  populateStatsTable:(value,{spread})=>({...table(Array(6).fill(spread==='iv'?31:0)),...value})};
const {sanitizePokemon}=load('src/utils/battle/sanitizePokemon.ts');
overrides['@showdex/utils/battle']={sanitizePokemon,clonePokemon:structuredClone,
  ...load('src/utils/battle/sanitizeVolatiles.ts'),sanitizeMoveTrack:p=>p.moveTrack || [],
  mergeRevealedMoves:p=>p.moves || [],replaceBehemothMoves:(_,moves)=>moves};
const {syncPokemon}=load('src/redux/actions/syncPokemon.ts');
const format = 'gen9fantasyrogueduel';
const mon = (name='Golduck',volatiles={}) => sanitizePokemon({speciesForme:name,ident:`p1: ${name}`,
  level:50,volatiles,nature:'Hardy'}, format);
const publicStats = text => ({roguebasestats:['roguebasestats',text]});
const request = stats => ({ident:'p1: Golduck',speciesForme:'Golduck',hp:155,maxhp:155,stats,moves:['Water Gun']});

test('both sides consume revealed Rogue bases without changing the shared Dex or unknown genetics',()=>{
  for (const [name,text,expected] of [['Golduck','80/82/78/115/80/105',[155,102,98,135,100,125]],
    ['Smeargle','82/30/52/30/67/112',[157,50,72,50,87,132]]]) {
    const p=mon(name,publicStats(text));
    assert.deepEqual(normalize(p.baseStats),table(text.split('/').map(Number)));
    assert.deepEqual(normalize(calc.calcPokemonSpreadStats(format,p)),table(expected));
    assert.equal(p.serverStats,null);
  }
  assert.equal(raw.Golduck.spa,95);
});
test('universal evolution refreshes private stats and invalidates only automatic server presets',()=>{
  const old=request({atk:102,def:98,spa:135,spd:100,spe:125});
  let p=syncPokemon(mon(),{format,clientPokemon:{volatiles:publicStats('80/82/78/115/80/105')},serverPokemon:old});
  p.presetId='old-yours';p.presetSource='server';p.autoPresetId='old-yours';
  p.presets=[{calcdexId:'old-yours',source:'server'},{calcdexId:'manual',source:'import'}];
  const newer=request({atk:132,def:128,spa:155,spd:120,spe:125});
  const next=syncPokemon(p,{format,clientPokemon:{volatiles:publicStats('80/112/108/135/100/105')},serverPokemon:newer});
  assert.deepEqual(normalize(next.serverStats),{...newer.stats,hp:155});
  assert.deepEqual(normalize(next.spreadStats),table([155,132,128,155,120,125]));
  assert.equal(next.presetId,null);assert.equal(next.autoPresetId,null);
  assert.deepEqual(normalize(next.presets),[{calcdexId:'manual',source:'import'}]);
  assert.equal(p.serverStats.atk,102);
});
test('unchanged requests do not reset a chosen preset; manual base-stat overrides remain usable',()=>{
  const server=request({atk:102,def:98,spa:135,spd:100,spe:125});
  let p=syncPokemon(mon(),{format,clientPokemon:{volatiles:publicStats('80/82/78/115/80/105')},serverPokemon:server});
  p.presetId='manual';p.presetSource='import';p.dirtyBaseStats.atk=150;
  const next=syncPokemon(p,{format,clientPokemon:{volatiles:publicStats('80/112/108/135/100/105')},
    serverPokemon:request({atk:132,def:128,spa:155,spd:120,spe:125})});
  assert.equal(next.presetId,'manual');assert.equal(next.dirtyBaseStats.atk,150);assert.equal(next.spreadStats.atk,170);
  next.presetSource='server'; next.autoPresetId='manual';
  const again=syncPokemon(next,{format,clientPokemon:{volatiles:next.volatiles},
    serverPokemon:request({atk:132,def:128,spa:155,spd:120,spe:125})});
  assert.equal(again.presetId,'manual');
});
test('clearing the effect restores Dex bases; malformed data and ordinary formats are ignored',()=>{
  let p=mon('Golduck',publicStats('80/112/108/135/100/105'));
  p=syncPokemon(p,{format,clientPokemon:{volatiles:{}}});
  assert.deepEqual(normalize(p.baseStats),raw.Golduck);
  for (const text of ['80/2/3/4/5','80/2/3/4/5/6/7','0/2/3/4/5/6','1.5/2/3/4/5/6','<img>/2/3/4/5/6']) {
    assert.deepEqual(normalize(mon('Golduck',publicStats(text)).baseStats),raw.Golduck);
  }
  assert.deepEqual(normalize(sanitizePokemon({speciesForme:'Golduck',volatiles:publicStats('80/1/2/3/4/5')},'gen9ou').baseStats),raw.Golduck);
});
test('Transform uses the published current bases but retains its own HP and restores on switch',()=>{
  const p=mon('Ditto',{transform:['transform','Golduck'],...publicStats('48/112/108/135/100/105')});
  assert.equal(p.baseStats.hp,48);assert.equal(p.transformedBaseStats.hp,undefined);
  assert.deepEqual(normalize(calc.calcPokemonSpreadStats(format,p)),table([123,132,128,155,120,125]));
  const reset=syncPokemon(p,{format,clientPokemon:{volatiles:{}}});
  assert.equal(reset.transformedBaseStats,null);assert.deepEqual(normalize(reset.baseStats),raw.Ditto);
});
test('an own Illusion mismatch never copies the disguise public bases into the real species',()=>{
  const p=mon('Zoroark');p.calcdexId='real';
  const next=syncPokemon(p,{format,clientPokemon:{calcdexId:'disguise',speciesForme:'Golduck',
    volatiles:publicStats('80/112/108/135/100/105')},serverPokemon:{...request({atk:125,def:80,spa:140,spd:80,spe:125}),
      calcdexId:'real',speciesForme:'Zoroark',ability:'illusion'}});
  assert.equal(next.speciesForme,'Zoroark');assert.deepEqual(normalize(next.baseStats),raw.Zoroark);
});
