'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function boot(placeholder) {
  const room = {el: {dataset: placeholder ? {fantasyShowdexPlaceholder: 'true'} : {}}, reactRoot: placeholder ? null : {existing: true}};
  let roots = 0, renders = 0, focused = 0, unmounts = 0;
  const logger = () => ({silly() {}, debug() {}, error(message) { throw Error(message); }});
  class Base {
    static Adapter = {rootState: {showdex: {settings: {hellodex: {focusRoomsRoom: true}}}}};
    static createHtmlRoom() { return room; }
    startTimer() {}
    endTimer() {}
  }
  const dependencies = {
    'react-dom/client': {createRoot(el) { assert.equal(el, room.el); roots++; return {unmount() { unmounts++; }}; }},
    '@showdex/utils/core': {env: {bool: () => true}, nonEmptyObject: () => true},
    '@showdex/utils/debug': {logger},
    '@showdex/utils/host': {detectClassicHost: () => true},
    '../Bootdex/BootdexClassicBootstrappable': {BootdexClassicBootstrappable: Base},
    './HellodexRenderer': {HellodexDomRenderer(dom) { assert.equal(dom, room.reactRoot); renders++; }},
  };
  const app = {rooms: {'view-hellodex': room}, focusRoomRight() { focused++; }};
  const module = {exports: {}};
  const source = fs.readFileSync(path.join(root, 'src/pages/Hellodex/HellodexClassicBootstrapper.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    module, exports: module.exports, window: {app},
    require(id) { assert(id in dependencies, id); return dependencies[id]; },
  });
  return {room, instance: new module.exports.HellodexClassicBootstrapper(), counts: () => ({roots, renders, focused, unmounts})};
}

test('takes over the lightweight Hellodex room and mounts React once', () => {
  const c = boot(true); c.instance.run();
  assert.equal(c.room.el.dataset.fantasyShowdexPlaceholder, undefined);
  assert.deepEqual(c.counts(), {roots: 1, renders: 1, focused: 0, unmounts: 0});
  c.instance.open();
  assert.deepEqual(c.counts(), {roots: 1, renders: 1, focused: 1, unmounts: 0});
  assert.equal(c.room.requestLeave(), true);
  assert.equal(c.counts().unmounts, 1);
});

test('does not replace an already initialized Hellodex room', () => {
  const c = boot(false); c.instance.run();
  assert.deepEqual(c.counts(), {roots: 0, renders: 0, focused: 1, unmounts: 0});
  assert.equal(c.room.reactRoot.existing, true);
});

for (const phase of ['hook', 'settings', 'ready']) {
  test(`propagates ${phase} failure instead of announcing successful initialization`, async () => {
    const errors = [];
    const deps = {
      '@showdex/redux/store': {createStore: () => ({getState: () => ({}), dispatch() {}})},
      '@showdex/utils/core': {nonEmptyObject: () => false},
      '@showdex/utils/debug': {logger: () => ({debug() {}, error(...args) { errors.push(args); }})},
      '@showdex/utils/storage': {
        openIndexedDb: async () => ({}),
        readSettingsDb: async () => { if (phase === 'settings') throw Error('settings failed'); return {}; },
        readHonksDb: async () => null, readNotesDb: async () => null,
      },
      '@showdex/utils/app': {bakeBakedexBundles() {}, loadI18nextLocales: async () => ({language: 'en'})},
    };
    const module = {exports: {}};
    const source = fs.readFileSync(path.join(root, 'src/pages/Bootdex/BootdexAdapter.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
      module, exports: module.exports, require(id) { assert(id in deps, id); return deps[id]; },
    });
    const Adapter = module.exports.BootdexAdapter;
    Adapter.hook = async () => { if (phase === 'hook') throw Error('hook failed'); };
    Adapter.ready = async () => { if (phase === 'ready') throw Error('ready failed'); };
    await assert.rejects(Adapter.run(), new RegExp(phase + ' failed'));
    assert.equal(errors.length, 1);
  });
}

test('announces readiness only after asynchronous adapter initialization', async () => {
  let ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  const events = [], order = [];
  class Bootstrap { run() { order.push('room'); } }
  const pages = new Proxy({}, {get(_, key) {
    if (key === 'BootdexManager') return {register() {}};
    if (key === 'BootdexClassicAdapter') return {async run() { await waiting; order.push('adapter'); }};
    return Bootstrap;
  }});
  const env = (_, fallback) => fallback;
  env.bool = () => true;
  const deps = {
    '@showdex/pages': pages, '@showdex/utils/core': {env},
    '@showdex/utils/debug': {logger: () => ({debug() {}, success() {}, error() {}})},
    '@showdex/utils/host': {detectPreactHost: () => false, detectClassicHost: () => true},
    '@showdex/styles/global.scss': {},
  };
  const window = {Dex: {gen: 9, forGen() {}}, app: {receive() {}}, dispatchEvent(event) { events.push(event.type); }};
  const source = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
    window, Event, console, setTimeout,
    require(id) { assert(id in deps, id); return deps[id]; },
    exports: {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []); assert.deepEqual(order, []);
  ready(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['fantasyshowdexready']);
  assert.equal(order[0], 'adapter'); assert.equal(order.length, 5);
});
