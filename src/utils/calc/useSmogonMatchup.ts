/**
 * @file `useSmogonMatchup.ts`
 * @author Keith Choison <keith@tize.io>
 * @since 0.1.2
 */

import * as React from 'react';
import { type MoveName } from '@smogon/calc';
import { type CalcdexBattleState } from '@showdex/interfaces/calc';
import { useShowdexSettings } from '@showdex/redux/store';
import { type CalcdexMatchupResult, calcSmogonMatchup } from './calcSmogonMatchup';
import { createFantasyInput, formatFantasyDamage, isNativeFantasy, requestFantasyDamage } from './fantasyNative';

export type SmogonMatchupHookCalculator = (
  playerMove: MoveName,
) => CalcdexMatchupResult;

/**
 * A memoized version of `calcSmogonMatchup()`.
 *
 * * Note that a memoized callback is returned that requires one argument, `playerMove`.
 *
 * @since 0.1.2
 */
export const useSmogonMatchup = (
  state: CalcdexBattleState,
  config?: Omit<Parameters<typeof calcSmogonMatchup>[2], 'settings'>,
): SmogonMatchupHookCalculator => {
  const settings = useShowdexSettings();
  const native = isNativeFantasy(state?.format);
  const player = state?.[config?.playerKey || state?.playerKey];
  const pokemon = player?.pokemon?.[config?.playerSelectionIndex ?? player?.selectionIndex];
  const inputs = native ? (pokemon?.moves || []).map((move) => {
    try { return createFantasyInput(state, move, config); } catch { return null; }
  }) : [];
  const key = JSON.stringify(inputs);
  const [results, setResults] = React.useState<Record<string, Awaited<ReturnType<typeof requestFantasyDamage>>>>({});
  React.useEffect(() => {
    if (!native) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      const currentInputs = JSON.parse(key) as typeof inputs;
      void Promise.all(currentInputs.filter(Boolean).map(async (input) => [
        JSON.stringify(input), await requestFantasyDamage(input),
      ] as const)).then((entries) => {
        if (!cancelled) setResults(Object.fromEntries(entries));
      });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, key]);

  return React.useCallback<SmogonMatchupHookCalculator>((
    playerMove,
  ) => {
    if (native) {
      try {
        const input = createFantasyInput(state, playerMove, config);
        return input ? formatFantasyDamage(input, results[JSON.stringify(input)]) : { damageRange: '等待配置' };
      } catch { return { damageRange: '配置不可用' }; }
    }
    return calcSmogonMatchup(state, playerMove, {
    ...config,
    settings,
    });
  }, [
    native,
    results,
    config,
    settings,
    state,
  ]);
};
