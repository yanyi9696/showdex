// Canonical NFD characters whose decomposition contains ASCII letters. Keep this
// fallback independent of ICU: a mobile browser can throw from normalize() even
// for a plain English header. This is not compatibility folding (e.g. ß/Æ/Ｆ stay removed).
const canonicalAsciiGroups: Record<string, string> = {
  A: 'ÀÁÂÃÄÅĀĂĄǍǞǠǺȀȂȦḀẠẢẤẦẨẪẬẮẰẲẴẶÅ',
  C: 'ÇĆĈĊČḈ',
  E: 'ÈÉÊËĒĔĖĘĚȄȆȨḔḖḘḚḜẸẺẼẾỀỂỄỆ',
  I: 'ÌÍÎÏĨĪĬĮİǏȈȊḬḮỈỊ',
  N: 'ÑŃŅŇǸṄṆṈṊ',
  O: 'ÒÓÔÕÖŌŎŐƠǑǪǬȌȎȪȬȮȰṌṎṐṒỌỎỐỒỔỖỘỚỜỞỠỢ',
  U: 'ÙÚÛÜŨŪŬŮŰŲƯǓǕǗǙǛȔȖṲṴṶṸṺỤỦỨỪỬỮỰ',
  Y: 'ÝŶŸȲẎỲỴỶỸ',
  a: 'àáâãäåāăąǎǟǡǻȁȃȧḁạảấầẩẫậắằẳẵặ',
  c: 'çćĉċčḉ',
  e: 'èéêëēĕėęěȅȇȩḕḗḙḛḝẹẻẽếềểễệ',
  i: 'ìíîïĩīĭįǐȉȋḭḯỉị',
  n: 'ñńņňǹṅṇṉṋ',
  o: 'òóôõöōŏőơǒǫǭȍȏȫȭȯȱṍṏṑṓọỏốồổỗộớờởỡợ',
  u: 'ùúûüũūŭůűųưǔǖǘǚǜȕȗṳṵṷṹṻụủứừửữự',
  y: 'ýÿŷȳẏẙỳỵỷỹ',
  D: 'ĎḊḌḎḐḒ',
  d: 'ďḋḍḏḑḓ',
  G: 'ĜĞĠĢǦǴḠ',
  g: 'ĝğġģǧǵḡ',
  H: 'ĤȞḢḤḦḨḪ',
  h: 'ĥȟḣḥḧḩḫẖ',
  J: 'Ĵ',
  j: 'ĵǰ',
  K: 'ĶǨḰḲḴK',
  k: 'ķǩḱḳḵ',
  L: 'ĹĻĽḶḸḺḼ',
  l: 'ĺļľḷḹḻḽ',
  R: 'ŔŖŘȐȒṘṚṜṞ',
  r: 'ŕŗřȑȓṙṛṝṟ',
  S: 'ŚŜŞŠȘṠṢṤṦṨ',
  s: 'śŝşšșṡṣṥṧṩ',
  T: 'ŢŤȚṪṬṮṰ',
  t: 'ţťțṫṭṯṱẗ',
  W: 'ŴẀẂẄẆẈ',
  w: 'ŵẁẃẅẇẉẘ',
  Z: 'ŹŻŽẐẒẔ',
  z: 'źżžẑẓẕ',
  B: 'ḂḄḆ',
  b: 'ḃḅḇ',
  F: 'Ḟ',
  f: 'ḟ',
  M: 'ḾṀṂ',
  m: 'ḿṁṃ',
  P: 'ṔṖ',
  p: 'ṕṗ',
  V: 'ṼṾ',
  v: 'ṽṿ',
  X: 'ẊẌ',
  x: 'ẋẍ',
};
const canonicalAscii = Object.fromEntries(Object.entries(canonicalAsciiGroups)
  .flatMap(([ascii, characters]) => [...characters].map((character) => [character, ascii])));

/**
 * Basically the `toID()` global that's already built into the Showdown client, but ~~too lazy atm to
 * declare it as a project global~~ it's so dank we need our own.
 *
 * * Also used as a string sanitizer for string comparisons, especially in `calcPokemonFinalStats()`
 *   for abilities, items, etc.
 * * As of v1.1.6, this has been moved from `app` utils to `core` cause it was being imported everywhere,
 *   causing lots of circular dependencies cause of my brilliant *let's `export` everything in `index.ts`*
 *   organizational system.
 *   - Nothing wrong with the system of course.
 *   - Just means we just need to make certain directories like `core` & `dex` don't import from other
 *     parts of the project like `redux` o_O
 * * As of v1.2.1, this now replaces all diacritics with their ASCII equivalents (e.g., "é" -> "e").
 *   - Pre-v1.2.1, `formatId('Flabébé-Yellow')` would result in `'flabbyellow'` (a yellow flabby ?).
 *   - Post-v1.2.1, `formatId('Flabébé-Yellow')` now results in `'flabebeyellow'`.
 *
 * @example
 * ```ts
 * formatId('Quick Feet');
 *
 * 'quickfeet'
 * ```
 * @since 0.1.3
 */
export const formatId = (
  value: string,
) => {
  let text = value?.toString?.();

  if (!text) {
    return text;
  }

  // Most IDs and translation keys are ASCII and need no Unicode normalization.
  if (/[\u0080-\uffff]/.test(text)) {
    try {
      text = text.normalize('NFD');
    } catch {
      text = text.replace(/[\u0080-\uffff]/g, (character) => canonicalAscii[character] || '');
    }
  }

  return text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
};
