'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/core/formatId.ts'), 'utf8');
function client() {
  const module = {exports: {}};
  const context = vm.createContext({module, exports: module.exports});
  vm.runInContext(ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  }}).outputText, context);
  return {formatId: module.exports.formatId, breakICU() {
    vm.runInContext("String.prototype.normalize = function () { throw new TypeError('Internal error. Icu error.'); };", context);
  }, context};
}
test('ASCII headers and format IDs do not require ICU, including subsequent battles', () => {
  const c = client();
  assert.equal(c.formatId('gen9fcchampionsdoublesgi'), 'gen9fcchampionsdoublesgi');
  c.breakICU();
  for (let battle = 2; battle <= 8; battle++) {
    for (const label of ['Pool', 'Usage', 'Legal', 'Transformed', 'Revealed Moves', 'Tera Type']) {
      assert.equal(c.formatId(label), label.toLowerCase().replace(/ /g, ''));
    }
    assert.equal(c.formatId('gen9fcchampionsdoublesgi'), 'gen9fcchampionsdoublesgi');
  }
});
test('accented Pokemon and translated header keys remain identical when ICU fails', () => {
  const c = client();
  const labels = ['Flabébé-Yellow', 'Pokémon-Specific Items', 'Fla\u0062e\u0301be\u0301', 'Nidoran♀',
    'ＦＣ', '训练家FC-é', 'Árvíztűrő tükörfúrógép', 'ẞ-œ-Æ-ø', 'K-Å'];
  const before = labels.map(c.formatId);
  c.breakICU();
  assert.deepEqual(labels.map(c.formatId), before);
});
test('fallback preserves every BMP character canonical ASCII projection', () => {
  const c = client();
  c.breakICU();
  for (let cp = 0; cp <= 0xFFFF; cp++) {
    const value = String.fromCharCode(cp);
    const expected = value.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    assert.equal(c.formatId(value), expected, `U+${cp.toString(16)}`);
  }
});
test('empty, optional and numeric ID inputs retain their previous behavior', () => {
  const c = client();
  for (const broken of [false, true]) {
    if (broken) c.breakICU();
    assert.equal(c.formatId(''), '');
    assert.equal(c.formatId(undefined), undefined);
    assert.equal(c.formatId(null), undefined);
    assert.equal(c.formatId(123), '123');
    assert.equal(c.formatId({toString: () => 'FC-Test'}), 'fctest');
  }
});

test('the actual ability dropdown renders Usage and Legal groups after ICU fails between battles', () => {
  const c = client();
  const abilities = {drizzle: {name: 'Drizzle'}, damp: {name: 'Damp'}, cloudnine: {name: 'Cloud Nine'}};
  const flatten = value => Array.isArray(value) ? value[0] : value;
  const dependencies = {
    '@showdex/utils/core': {formatId: c.formatId, dedupeArray: values => [...new Set(values)]},
    '@showdex/utils/dex': {detectGenFromFormat: () => 9, detectLegacyGen: () => false,
      getDexForFormat: () => ({abilities: {get: name => abilities[c.formatId(name)]}}), legalLockedFormat: () => true},
    '@showdex/utils/humanize': {percentage: value => `${value * 100}%`},
    '@showdex/utils/presets': {detectUsageAlt: Array.isArray, flattenAlt: flatten, flattenAlts: values => values.map(flatten)},
  };
  c.context.require = id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  };
  c.context.window = {Gen9fantasyAbilities: abilities};
  c.context.BattleAbilities = abilities;
  const dropdown = fs.readFileSync(path.join(__dirname, '../src/utils/ui/buildAbilityOptions.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(dropdown, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  }}).outputText, c.context);
  const pokemon = {speciesForme: 'Golduck', abilities: ['Damp', 'Cloud Nine'], altAbilities: []};
  const config = {usageAlts: [['Drizzle', 0.5]], usageFinder: () => '',
    translateHeader: value => `pokedex:headers.${c.formatId(value)}`};
  const render = () => JSON.parse(JSON.stringify(c.context.module.exports.buildAbilityOptions(
    'gen9fcchampionsdoublesgi', pokemon, config)));
  const before = render();
  assert.deepEqual(before.map(group => group.label), ['pokedex:headers.usage', 'pokedex:headers.legal']);
  c.breakICU();
  for (let battle = 2; battle <= 8; battle++) assert.deepEqual(render(), before);
});
