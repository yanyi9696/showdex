import { type MoveName } from '@smogon/calc';
import { type CalcdexBattleState, type CalcdexPokemon } from '@showdex/interfaces/calc';
import { env, formatId } from '@showdex/utils/core';
import { type CalcdexMatchupResult, type calcSmogonMatchup } from './calcSmogonMatchup';
import { createSmogonPokemon } from './createSmogonPokemon';
import { createSmogonMove } from './createSmogonMove';
import { createSmogonField } from './createSmogonField';

export const isNativeFantasy = (format: string): boolean => env.bool('fantasy-embedded')
  && /^(?:gen\d+fc|.*fantasy)/i.test(formatId(format));

type NativeResult = {
  damage: number[]; hp: number; maxhp: number; statusMove: boolean; warnings: string[];
};
type NativeReply = { result?: NativeResult; error?: string };
type QueryReply = { id: string; results?: NativeReply[]; error?: string };
type CalcConfig = Parameters<typeof calcSmogonMatchup>[2];
type Bridge = {
  send: (command: string) => void;
  on: (event: string, handler: (data: QueryReply) => void) => void;
  off: (event: string, handler: (data: QueryReply) => void) => void;
};

// Only this explicit DTO is sent. Never serialize a battle, room, team, Redux store or account.
export const createFantasyInput = (state: CalcdexBattleState, moveName: MoveName, config?: CalcConfig) => {
  const playerKey = config?.playerKey || state?.playerKey;
  const opponentKey = config?.opponentKey || (playerKey === state?.playerKey ? state.opponentKey : state.playerKey);
  const player = state?.[playerKey];
  const opponent = state?.[opponentKey];
  const pi = config?.playerSelectionIndex ?? player?.selectionIndex;
  const oi = config?.opponentSelectionIndex ?? opponent?.selectionIndex;
  const attacker = player?.pokemon?.[pi];
  const defender = opponent?.pokemon?.[oi];
  if (!attacker?.speciesForme || !defender?.speciesForme || !moveName) return null;
  const field = createSmogonField(state.format, state.gameType, state.field, player, opponent);
  const [move] = createSmogonMove(state.format, attacker, moveName, defender, state.field) || [];
  if (!move || !field) return null;
  const pokemon = (p: CalcdexPokemon) => {
    if (!p?.speciesForme) return undefined;
    const mon = createSmogonPokemon(state.format, state.gameType, p);
    if (!mon) return undefined;
    return {
      species: p.transformedForme || p.speciesForme,
      level: p.level, gender: p.gender, ability: mon.ability, item: mon.item, nature: p.nature,
      ivs: p.ivs, evs: p.evs, boosts: mon.boosts, stats: mon.rawStats,
      hp: mon.curHP() / mon.maxHP(), status: mon.status,
      teraType: mon.teraType || '', types: mon.types.filter(Boolean),
      volatiles: Object.keys(p.volatiles || {}), dynamax: !!p.useMax,
      faintedAllies: p.dirtyFaintCounter ?? p.faintCounter,
      boostedStat: p.dirtyBoostedStat || p.boostedStat,
    };
  };
  const side = (s: typeof field.attackerSide) => [
    s.isReflect && 'reflect', s.isLightScreen && 'lightscreen', s.isAuroraVeil && 'auroraveil',
    s.isTailwind && 'tailwind',
  ].filter(Boolean);
  const a = pokemon(attacker);
  const d = pokemon(defender);
  if (!a || !d) return null;
  if (field.attackerSide.isHelpingHand) a.volatiles.push('helpinghand');
  if (field.defenderSide.isProtected) d.volatiles.push('protect');
  const weather = {
    Sun: 'sunnyday', Rain: 'raindance', Sand: 'sandstorm', Hail: 'hail', Snow: 'snow',
    'Harsh Sunshine': 'desolateland', 'Heavy Rain': 'primordialsea', 'Strong Winds': 'deltastream',
  }[field.weather] || '';
  return {
    attacker: a, defender: d, move: moveName,
    attackerAlly: state.gameType === 'Doubles'
      ? pokemon(player.pokemon[player.activeIndices?.find((i) => i !== pi)]) : undefined,
    defenderAlly: state.gameType === 'Doubles'
      ? pokemon(opponent.pokemon[opponent.activeIndices?.find((i) => i !== oi)]) : undefined,
    gameType: state.gameType === 'Doubles' ? 'doubles' : 'singles',
    weather, terrain: field.terrain ? `${formatId(field.terrain)}terrain` : '',
    pseudoWeather: [field.isGravity && 'gravity', field.isMagicRoom && 'magicroom', field.isWonderRoom && 'wonderroom'].filter(Boolean),
    attackerSide: side(field.attackerSide), defenderSide: side(field.defenderSide),
    critical: move.isCrit, hits: move.hits, useZ: attacker.useZ && !attacker.useMax, useMax: attacker.useMax,
    // Send only manual overrides: native move callbacks must retain their dynamic power/type.
    moveOverrides: {
      basePower: attacker.moveOverrides?.[moveName]?.basePower,
      type: attacker.moveOverrides?.[moveName]?.type,
      category: attacker.moveOverrides?.[moveName]?.category,
    },
  };
};

type Input = ReturnType<typeof createFantasyInput>;
const cache = new Map<string, NativeReply>();
const pending = new Map<string, Promise<NativeReply>>();
const queue: { input: Input; resolve: (value: NativeReply) => void }[] = [];
let running = false;
let sequence = 0;

const flush = async () => {
  if (running || !queue.length) return;
  running = true;
  const batch = queue.splice(0, 8);
  const bridge = window.app as unknown as Bridge;
  const response = await new Promise<QueryReply>((resolve) => {
    if (!bridge?.send || !bridge.on || !bridge.off) {
      resolve({ id: '', error: '计算器连接尚未就绪' });
      return;
    }
    const id = `fc-${Date.now()}-${++sequence}`;
    const finish = (reply: QueryReply) => {
      if (reply.id !== id) return;
      clearTimeout(timer);
      bridge.off('response:fantasycalc', finish);
      resolve(reply);
    };
    const timer = setTimeout(() => finish({ id, error: '原生计算器未响应，请确认服务器已更新' }), 12000);
    bridge.on('response:fantasycalc', finish);
    bridge.send(`/cmd fantasycalc ${JSON.stringify({ id, inputs: batch.map((job) => job.input) })}`);
  });
  batch.forEach((job, i) => job.resolve(response.results?.[i] || { error: response.error || '计算失败' }));
  running = false;
  if (queue.length) setTimeout(flush, 100);
};

export const requestFantasyDamage = (input: Input): Promise<NativeReply> => {
  const key = JSON.stringify(input);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const promise = new Promise<NativeReply>((resolve) => {
    queue.push({ input, resolve });
    setTimeout(flush, 60);
  }).then((reply) => {
    pending.delete(key);
    if (reply.result) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, reply);
    }
    return reply;
  });
  pending.set(key, promise);
  return promise;
};

export const formatFantasyDamage = (input: Input, reply?: NativeReply): CalcdexMatchupResult => {
  if (!reply?.result) return {
    damageRange: reply?.error ? '不可用' : '计算中…',
    description: { raw: reply?.error || '正在使用幻想杯原生引擎计算', damageRange: reply?.error },
  };
  const r = reply.result;
  if (r.statusMove) return { damageRange: '变化招式' };
  const min = Math.min(...r.damage);
  const max = Math.max(...r.damage);
  const range = `${(100 * min / r.maxhp).toFixed(1)}% - ${(100 * max / r.maxhp).toFixed(1)}%`;
  const uncertain = r.warnings.length > 0;
  const chance = r.damage.filter((n) => n >= r.hp).length / r.damage.length * 100;
  const koChance = uncertain ? '见计算条件' : `${chance.toFixed(chance % 1 ? 1 : 0)}% OHKO`;
  const note = ['幻想杯原生引擎；按面板假设；条件为招式命中，不计入场及回合末伤害', ...r.warnings].join('。');
  return {
    damageRange: range, koChance,
    description: {
      raw: `${input.attacker.species} ${input.move} → ${input.defender.species}: ${min}-${max} (${range})。${note}`,
      attacker: `${input.attacker.species} / ${input.move}`,
      defender: input.defender.species,
      damageRange: `${min}-${max} (${range})`, damageAmounts: r.damage.join(', '), koChance: `${koChance}。${note}`,
    },
  };
};
