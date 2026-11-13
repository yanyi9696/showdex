import { type GenerationNum } from '@smogon/calc';
import { PokemonStatNames } from '@showdex/consts/dex';
import { formatId } from '@showdex/utils/core';

export const isRogueCalcFormat = (format?: string | GenerationNum): boolean => (
  typeof format === 'string' && /^gen\d+fantasyrogue(?:coop|duel)?$/.test(formatId(format))
);

/** Public effective bases only; never infer an opponent's private spread. */
export const readRogueBaseStats = (
  format: string | GenerationNum,
  pokemon: Partial<Pick<Showdown.Pokemon, 'volatiles'>>,
): Showdown.StatsTable | null => {
  if (!isRogueCalcFormat(format)) return null;

  const raw = pokemon?.volatiles?.roguebasestats?.[1] || pokemon?.volatiles?.fantasystats?.[1];

  if (typeof raw !== 'string' || !/^\d+(?:\/\d+){5}$/.test(raw)) return null;

  const values = raw.split('/').map(Number);

  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) return null;

  return Object.fromEntries(PokemonStatNames.map((stat, index) => [stat, values[index]])) as Showdown.StatsTable;
};
