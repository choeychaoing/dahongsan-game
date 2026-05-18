// ============================================================
// 牌力计算、出牌合法性验证、炸弹检测
// ============================================================
import { Card, Play, PlayType, Rank } from './types';

// ─── 数值映射 ───────────────────────────────────────────────
/**
 * 普通牌力值（用于同类型比较）
 * 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < 3 < 4 < small_joker < big_joker
 * 特殊：红桃3 / 方片3 作为单张 > 4，但 < small_joker
 *   普通3 = 13，4 = 14，红/方3特殊值 = 14.5（夹在4和small_joker之间）
 */
export const RANK_VALUES: Record<Rank, number> = {
  '5':          1,
  '6':          2,
  '7':          3,
  '8':          4,
  '9':          5,
  '10':         6,
  'J':          7,
  'Q':          8,
  'K':          9,
  'A':          10,
  '2':          11,
  '3':          12,   // 普通3（黑桃3、梅花3）
  '4':          13,
  'small_joker': 14,
  'big_joker':   15,
};

/** 红桃3 / 方片3 单张特殊牌力（大于4，小于小王） */
export const RED3_SINGLE_POWER = 13.5;

/** 判断是否是红3特殊牌（红桃3或方片3） */
export function isRed3(card: Card): boolean {
  return card.rank === '3' && (card.suit === 'hearts' || card.suit === 'diamonds');
}

/** 判断是否是红桃5（首轮先手牌） */
export function isHeart5(card: Card): boolean {
  return card.rank === '5' && card.suit === 'hearts';
}

/** 判断是否是双王 */
export function isDoubleJoker(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  const ranks = cards.map(c => c.rank).sort();
  return ranks[0] === 'big_joker' && ranks[1] === 'small_joker';
}

// ─── 牌力 ───────────────────────────────────────────────────

/** 获取单张牌的基础牌力 */
export function cardPower(card: Card): number {
  return RANK_VALUES[card.rank];
}

// ─── 识别牌型 ────────────────────────────────────────────────

/** 检测是否三张同点（炸弹） */
function isTripleBomb(cards: Card[]): boolean {
  if (cards.length !== 3) return false;
  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
}

/** 检测是否四张同点（炸弹） */
function isQuadBomb(cards: Card[]): boolean {
  if (cards.length !== 4) return false;
  return cards.every(c => c.rank === cards[0].rank);
}

/** 识别出牌牌型，返回 PlayType 或 null（非法） */
export function identifyPlayType(cards: Card[]): PlayType | null {
  if (cards.length === 0) return null;

  if (cards.length === 1) return 'single';

  if (cards.length === 2) {
    if (isDoubleJoker(cards)) return 'bomb';
    if (cards[0].rank === cards[1].rank) return 'pair';
    return null; // 不同点数的两张不合法
  }

  if (cards.length === 3) {
    if (isTripleBomb(cards)) return 'bomb';
    return null;
  }

  if (cards.length === 4) {
    if (isQuadBomb(cards)) return 'bomb';
    return null;
  }

  return null; // 超过4张不合法
}

// ─── 计算牌力 ────────────────────────────────────────────────

/**
 * 计算一手牌的 power 值，用于和同类型比较
 * 不同类型之间通过 canBeat 判断，不直接比 power
 */
export function computePower(cards: Card[], type: PlayType): number {
  if (type === 'single') {
    const card = cards[0];
    if (isRed3(card)) return RED3_SINGLE_POWER;
    return cardPower(card);
  }

  if (type === 'pair') {
    // 对子按点数比较，取任意一张即可
    return cardPower(cards[0]);
  }

  if (type === 'bomb') {
    if (isDoubleJoker(cards)) return 9999; // 最大

    // 炸弹力值：张数权重 + 点数
    // 四张 > 三张，同张数按点数比
    const bombBase = cards.length === 4 ? 1000 : 500;
    return bombBase + cardPower(cards[0]);
  }

  return 0;
}

/** 构建一手 Play 对象，若牌型非法返回 null */
export function buildPlay(cards: Card[]): Play | null {
  const type = identifyPlayType(cards);
  if (!type) return null;
  const power = computePower(cards, type);
  return { cards, type, power };
}

// ─── 管牌判断 ────────────────────────────────────────────────

/**
 * 判断 attacker 能否管 defender
 * 规则：
 * 1. 炸弹可以管单张、对子、炸弹
 * 2. 非炸弹必须同牌型，且 power 更大
 * 3. 同类型比 power
 */
export function canBeat(attacker: Play, defender: Play): boolean {
  // 攻击方是炸弹
  if (attacker.type === 'bomb') {
    if (defender.type !== 'bomb') return true; // 炸弹管非炸弹
    // 炸弹 vs 炸弹：比 power
    return attacker.power > defender.power;
  }

  // 攻击方不是炸弹
  if (attacker.type !== defender.type) return false; // 必须同牌型
  return attacker.power > defender.power;
}

// ─── 出牌合法性检查 ─────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * 验证出牌是否合法
 * @param cards        要出的牌
 * @param hand         当前玩家手牌
 * @param lastActivePlay 当前桌面需要管的牌（null 表示自由出牌）
 */
export function validatePlay(
  cards: Card[],
  hand: Card[],
  lastActivePlay: Play | null,
): ValidationResult {
  if (cards.length === 0) {
    return { valid: false, reason: '未选择任何牌' };
  }

  // 检查是否都在手牌中
  for (const card of cards) {
    if (!hand.some(c => c.id === card.id)) {
      return { valid: false, reason: '出的牌不在手牌中' };
    }
  }

  const play = buildPlay(cards);
  if (!play) {
    return { valid: false, reason: '非法牌型，只允许单张、对子、炸弹' };
  }

  // 自由出牌（没有需要管的牌）
  if (!lastActivePlay) {
    return { valid: true };
  }

  // 需要管牌
  if (!canBeat(play, lastActivePlay)) {
    if (play.type === 'bomb' && lastActivePlay.type === 'bomb') {
      return { valid: false, reason: '炸弹不够大，无法压制' };
    }
    if (play.type !== lastActivePlay.type) {
      return { valid: false, reason: `必须出${lastActivePlay.type === 'single' ? '单张' : '对子'}或炸弹` };
    }
    return { valid: false, reason: '牌不够大，无法管牌' };
  }

  return { valid: true };
}

// ─── 炸弹拆牌 ────────────────────────────────────────────────

/**
 * 炸弹可拆成单张或对子（规则允许）
 * 这里只做验证层标注，实际拆牌由玩家自行选择出牌数量
 */
export function canSplitBomb(cards: Card[], hand: Card[]): boolean {
  // 玩家可以从炸弹中取出1张或2张作为单张/对子出
  // 这里检查所选牌是否都属于同一点数的炸弹牌
  if (cards.length !== 1 && cards.length !== 2) return false;
  const rank = cards[0].rank;
  const sameRankInHand = hand.filter(c => c.rank === rank);
  return sameRankInHand.length >= 3 && cards.every(c => c.rank === rank);
}
