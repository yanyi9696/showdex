'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const ts = require('typescript');
const i18next = require('i18next');

const root = path.resolve(__dirname, '..');
const logger = () => ({ debug() {}, warn() {}, error(error) { throw error; } });

function loadSource(filename, dependencies, globals = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, __DEV__: false,
    require(id) {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

function nativeFantasy() {
  return loadSource('src/utils/calc/fantasyNative.ts', {
    '@showdex/utils/core': { env: { bool: () => true }, formatId: value => value.toLowerCase().replace(/[^a-z0-9]/g, '') },
    './createSmogonPokemon': { createSmogonPokemon: (_, __, mon) => ({
      ability: mon.ability, item: mon.item, boosts: {}, rawStats: {}, status: '', types: ['Normal'],
      curHP: () => 100, maxHP: () => 100,
    }) },
    './createSmogonMove': { createSmogonMove: () => [{ isCrit: false, hits: 1 }] },
    './createSmogonField': { createSmogonField: () => ({ attackerSide: {}, defenderSide: {} }) },
  });
}

test('native calculator carries only the selected move dynamic power into its request', () => {
  const { createFantasyInput } = nativeFantasy();
  const attacker = { speciesForme: 'Scyther', mechanicPowers: { furycutter: { power: 160, label: '连斩' } },
    privateTestValue: 'never serialize a store' };
  const state = { format: 'gen9fantasy', gameType: 'Singles', playerKey: 'p1', opponentKey: 'p2', field: {},
    p1: { pokemon: [attacker], selectionIndex: 0 }, p2: { pokemon: [{ speciesForme: 'Snorlax' }], selectionIndex: 0 } };
  const input = createFantasyInput(state, 'Fury Cutter');
  assert.equal(input.mechanicBasePower, 160);
  assert.equal(input.moveOverrides.basePower, undefined, 'Do not turn a snapshot into a manual override');
  assert(!JSON.stringify(input).includes(attacker.privateTestValue));
  assert.equal(createFantasyInput(state, 'Quick Attack').mechanicBasePower, undefined);
});

test('native damage and KO colors communicate low damage, lethal damage and uncertain conditions', () => {
  const { fantasyDamageColor, formatFantasyDamage } = nativeFantasy();
  const red = fantasyDamageColor(0.25), green = fantasyDamageColor(1);
  assert.equal(red, 'rgb(201, 66, 66)');
  assert.equal(green, 'rgb(35, 150, 82)');
  assert.equal(fantasyDamageColor(0), red);
  assert.notEqual(fantasyDamageColor(0.6), red);
  assert.notEqual(fantasyDamageColor(0.6), green);
  const input = { attacker: { species: 'Scyther' }, defender: { species: 'Snorlax' }, move: 'Fury Cutter' };
  const result = { damage: [100, 110], hp: 100, maxhp: 200, warnings: [], statusMove: false };
  const lethal = formatFantasyDamage(input, {result});
  assert.equal(lethal.koChance, '100% OHKO');
  assert.equal(lethal.damageColor, green); assert.equal(lethal.koColor, green);
  const weak = formatFantasyDamage(input, {result: {...result, damage: [10, 20]}});
  assert.equal(weak.damageColor, red); assert.equal(weak.koColor, red);
  const uncertain = formatFantasyDamage(input, {result: {...result, warnings: ['目标招式未知']}});
  assert.equal(uncertain.koChance, '见计算条件'); assert.equal(uncertain.koColor, undefined);
  assert.equal(formatFantasyDamage(input, {result: {...result, statusMove: true}}).damageColor, undefined);
});

function makeClient({ rooms = {}, named = false, settingsReady = Promise.resolve() } = {}) {
  const delivered = [];
  const state = { showdex: {} };
  const app = {
    rooms,
    user: { attributes: { named, name: 'Calculator Tester' } },
    receive(data) {
      delivered.push(data);
      if (data.startsWith('>battle-')) {
        const id = data.slice(1, data.indexOf('\n'));
        this.rooms[id] = { battle: { id, received: data } };
      }
    },
  };
  const actions = new Proxy({}, { get: (_, type) => value => ({ type, value }) });
  const { BootdexAdapter } = loadSource('src/pages/Bootdex/BootdexAdapter.ts', {
    '@showdex/redux/store': {
      createStore: () => ({ getState: () => state, dispatch(action) {
        if (action.type === 'setAuthUsername') state.showdex.authUsername = action.value;
      } }),
      calcdexSlice: { actions }, notedexSlice: { actions }, showdexSlice: { actions },
    },
    '@showdex/utils/app': { bakeBakedexBundles() {}, loadI18nextLocales: async () => ({ language: 'en' }) },
    '@showdex/utils/core': { nonEmptyObject: value => !!value && Object.keys(value).length > 0 },
    '@showdex/utils/debug': { logger },
    '@showdex/utils/storage': {
      openIndexedDb: async () => ({}), readSettingsDb: () => settingsReady,
      readHonksDb: async () => null, readNotesDb: async () => null,
    },
  });
  const { BootdexClassicAdapter: Adapter } = loadSource('src/pages/Bootdex/BootdexClassicAdapter.ts', {
    './BootdexAdapter': { BootdexAdapter },
    '@showdex/utils/debug': { logger },
    '@showdex/utils/host': { detectClassicHost: () => true },
  }, {
    window: { app }, document: { documentElement: {} },
    MutationObserver: class { observe() {} },
  });
  const created = [];
  const synced = [];
  Adapter.receiverFactory = id => {
    created.push(id);
    return data => {
      assert.ok(app.rooms[id]?.battle, 'The normal client must receive battle data before the calculator');
      synced.push({ id, data });
    };
  };
  return { Adapter, app, created, synced, delivered };
}

test('initializes a battle and the signed-in player when the embedded script starts late', async () => {
  const client = makeClient({ named: true, rooms: {
    lobby: {}, 'battle-gen9fcag-1': { battle: { id: 'battle-gen9fcag-1' } },
  } });
  await client.Adapter.run();
  assert.deepEqual(client.created, ['battle-gen9fcag-1']);
  assert.equal(client.synced.length, 1);
  assert.equal(client.Adapter.authUsername, 'Calculator Tester');
  assert.equal(client.delivered.length, 0, 'Do not replay synthetic data through the normal client');
});

test('retains battles arriving during async initialization and creates their receiver before draining', async () => {
  let releaseSettings;
  const client = makeClient({ settingsReady: new Promise(resolve => { releaseSettings = resolve; }) });
  const running = client.Adapter.run();
  const first = '>battle-gen9fcag-2\n|init|battle\n|player|p1|Tester';
  const second = '>battle-gen9fcag-2\n|poke|p2|Calyrex-Fantasy';
  client.app.receive(first);
  client.app.receive(second);
  assert.equal(client.created.length, 0, 'Settings must finish before creating a calculator');
  releaseSettings();
  await running;
  assert.deepEqual(client.created, ['battle-gen9fcag-2']);
  assert.deepEqual(client.synced.map(entry => entry.data), [first, second]);
  client.app.receive('>battle-gen9fcag-2\n|turn|1');
  assert.equal(client.created.length, 1, 'Reuse the receiver rather than reopening a collapsed calculator');
  assert.equal(client.synced.length, 3);
});

test('new battles still initialize after startup; ordinary rooms do not create calculators', async () => {
  const client = makeClient();
  await client.Adapter.run();
  client.app.receive('>lobby\n|c|Tester|hello');
  client.app.receive('>battle-gen9fcou-3\n|init|battle');
  assert.deepEqual(client.created, ['battle-gen9fcou-3']);
  assert.equal(client.synced.length, 1);
});

async function embeddedLocales() {
  process.chdir(root);
  process.env.NODE_ENV = 'production';
  process.env.BUILD_TARGET = 'standalone';
  process.env.FANTASY_EMBEDDED = 'true';
  process.env.PROD_ANALYZE_BUNDLES = 'false';
  const { config } = await import(pathToFileURL(path.join(root, 'webpack.config.js')));
  const defines = config.plugins.find(plugin => plugin.constructor.name === 'DefinePlugin').definitions;
  return JSON.parse(defines.__SHOWDEX_EMBEDDED_LOCALES__);
}

function localeLoader(resources, fetch) {
  const instance = i18next.createInstance();
  const env = () => 'test';
  return loadSource('src/utils/app/loadI18nextLocales.ts', {
    'i18next': instance,
    'react-i18next': { initReactI18next: { type: '3rdParty', init() {} } },
    'i18next-browser-languagedetector': { type: 'languageDetector', detect: () => 'en', cacheUserLanguage() {} },
    'i18next-intervalplural-postprocessor': require('i18next-intervalplural-postprocessor'),
    '@showdex/consts/app': loadSource('src/consts/app/locales.ts', {}),
    '@showdex/utils/core': {
      env, getResourceUrl: filename => `file:///F:/fantasy/showdex/${filename}`,
      nonEmptyObject: value => !!value && Object.keys(value).length > 0, runtimeFetch: fetch,
    },
    '@showdex/utils/debug': { logger },
  }, { __SHOWDEX_EMBEDDED_LOCALES__: resources }).loadI18nextLocales;
}

test('embedded build initializes every locale without fetching JSON from file://', async () => {
  const resources = await embeddedLocales();
  const load = localeLoader(resources, () => { throw new Error('file:// fetch is forbidden'); });
  const instance = await load('en');
  assert.equal(instance.t('battleRecord.wins', { ns: 'hellodex' }), 'W');
  assert.notEqual(instance.t('poke.info.ability.hint', { ns: 'calcdex' }), 'poke.info.ability.hint');
  assert.ok(instance.hasResourceBundle('fr', 'calcdex'));
});

test('extension builds retain their locale resource fetch path', async () => {
  const resources = await embeddedLocales();
  const fetched = [];
  const load = localeLoader(null, async url => {
    fetched.push(url);
    const locale = /i18n\.(\w+)\.json$/.exec(url)[1];
    return { json: () => resources[locale] };
  });
  const instance = await load('en');
  assert.equal(fetched.length, 2);
  assert.equal(instance.t('battleRecord.wins', { ns: 'hellodex' }), 'W');
});
