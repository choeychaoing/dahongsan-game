// ============================================================
// 牌组生成、洗牌、发牌
// ============================================================
import { Card, Rank, Suit } from './types';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  joker: '🃏',
};

/** 生成完整54张牌 */
export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}_${rank}`,
        suit,
        rank,
        display: `${SUIT_SYMBOLS[suit]}${rank}`,
      });
    }
  }

  // 大小王
  deck.push({
    id: 'joker_small',
    suit: 'joker',
    rank: 'small_joker',
    display: '小王',
  });
  deck.push({
    id: 'joker_big',
    suit: 'joker',
    rank: 'big_joker',
    display: '大王',
  });

  return deck;
}

/** Fisher-Yates 洗牌 */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 发牌给5名玩家
 * 54张牌尽量平均：前4人每人11张，第5人10张（54 = 11*4 + 10）
 * 按顺序轮流发，保证随机性已由洗牌保证
 */
export function dealCards(playerCount: number, deck: Card[]): Card[][] {
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  deck.forEach((card, i) => {
    hands[i % playerCount].push(card);
  });
  return hands;
}

/** 找到持有某张牌的玩家索引 */
export function findCardHolder(hands: Card[][], suit: Suit, rank: Rank): number {
  for (let i = 0; i < hands.length; i++) {
    if (hands[i].some(c => c.suit === suit && c.rank === rank)) {
      return i;
    }
  }
  return -1;
}
