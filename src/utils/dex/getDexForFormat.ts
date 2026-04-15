import { type GenerationNum } from '@smogon/calc';
import { formatId } from '@showdex/utils/core';
import { logger } from '@showdex/utils/debug';
import { detectGenFromFormat } from './detectGenFromFormat';

const l = logger('@showdex/utils/dex/getDexForFormat()');

const FantasyFormatRegex = /^gen(10|\d)fc/i;

/**
 * Returns the appropriate `Dex` object for the passed-in `format`.
 *
 * * For BDSP formats, returns a modded `Dex` containing all the Gen 4 Pokemon normally unavailable in Gen 8.
 * * For other formats, returns a `Dex` for the current gen specified in the `format`.
 *   - Gen value is obtained via `detectGenFromFormat()`.
 * * If no `format` is provided or an invalid gen was returned from the `format`,
 *   the global `Dex` object is returned instead, which should default to the current gen.
 * * Note that `format` can also be a number representing the gen number.
 *
 * @since 1.0.2
 */
export const getDexForFormat = (format?: string | GenerationNum): Showdown.ModdedDex => {
  if (typeof Dex === 'undefined') {
    if (__DEV__) {
      l.warn(
        'Global Dex object is not available.',
        '\n', 'format', format,
        '\n', '(You will only see this warning on development.)',
      );
    }

    return null;
  }

  if (!format) {
    return Dex;
  }

  // note: checking if `format > 0` in the conditional won't guarantee that `format` will
  // be type `string` after this point
  if (typeof format === 'number') {
    return format > 0 ? Dex.forGen(format) : Dex;
  }

  const formatAsId = formatId(format);
  const gen = detectGenFromFormat(formatAsId);

  const fantasyFormat = formatAsId.includes('fantasy')
    || FantasyFormatRegex.test(formatAsId);

  if (fantasyFormat) {
    const fallbackFantasyMod = 'gen9fantasy';
    const fantasyMod = gen ? (`gen${gen}fantasy` as Showdown.ID) : fallbackFantasyMod as Showdown.ID;

    const modCandidates = [
      formatAsId as Showdown.ID,
      fantasyMod,
      fallbackFantasyMod as Showdown.ID,
    ];

    for (const modid of modCandidates) {
      try {
        const moddedDex = Dex.mod(modid);

        if (moddedDex?.species?.get?.('pikachu')?.exists) {
          return moddedDex;
        }
      } catch (error) {
        if (__DEV__) {
          l.debug('Fantasy mod lookup failed for', modid, error);
        }
      }
    }
  }

  if (formatAsId.includes('letsgo')) {
    return Dex.mod('gen7letsgo');
  }

  if (formatAsId.includes('bdsp')) {
    return Dex.mod('gen8bdsp');
  }

  if (typeof gen !== 'number' || gen < 1) {
    return Dex;
  }

  return Dex.forGen(gen);
};
