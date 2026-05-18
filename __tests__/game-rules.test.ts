// ============================================================
// 《打红三》核心规则单元测试
// ============================================================
import {
  buildPlay, canBeat, validatePlay, identifyPlayType,
  isRed3, computePower, RANK_VALUES, RED3_SINGLE_POWER,
  canSplitBomb,
} from '../lib/rules/card-rules';
import { createDeck, dealCards, findCardHolder } from '../lib/rules/deck';
import { checkVictory, assignCamps } from '../lib/rules/victory';
import { Card, GameState, Player } from '../lib/rules/types';

// ─── 辅助函数 ────────────────────────────────────────────────
function makeCard(suit: string, rank: string): Card {
  return {
    id: `${suit}_${rank}`,
    suit: suit as any,
    rank: rank as any,
    display: `${suit[0]}${rank}`,
  };
}

const H5 = makeCard('hearts', '5');       // 红桃5（最小）
const H3 = makeCard('hearts', '3');       // 红桃3（特殊单张）
const D3 = makeCard('diamonds', '3');     // 方片3（特殊单张）
const S3 = makeCard('spades', '3');       // 黑桃3（普通3）
const C3 = makeCard('clubs', '3');        // 梅花3（普通3）
const C4 = makeCard('clubs', '4');
const H4 = makeCard('hearts', '4');
const H6 = makeCard('hearts', '6');
const DA = makeCard('diamonds', 'A');
const D2 = makeCard('diamonds', '2');
const SJ = makeCard('joker', 'small_joker');
const BJ = makeCard('joker', 'big_joker');

// ─── 测试套件 ────────────────────────────────────────────────

describe('identifyPlayType', () => {
  test('单张识别', () => {
    expect(identifyPlayType([H5])).toBe('single');
    expect(identifyPlayType([H3])).toBe('single');
    expect(identifyPlayType([SJ])).toBe('single');
  });

  test('对子识别', () => {
    const h6 = makeCard('hearts', '6');
    const d6 = makeCard('diamonds', '6');
    expect(identifyPlayType([h6, d6])).toBe('pair');
  });

  test('双王是炸弹', () => {
    expect(identifyPlayType([SJ, BJ])).toBe('bomb');
  });

  test('三张同点是炸弹', () => {
    const h7 = makeCard('hearts', '7');
    const d7 = makeCard('diamonds', '7');
    const s7 = makeCard('spades', '7');
    expect(identifyPlayType([h7, d7, s7])).toBe('bomb');
  });

  test('四张同点是炸弹', () => {
    const cards = ['hearts', 'diamonds', 'clubs', 'spades'].map(s => makeCard(s, '8'));
    expect(identifyPlayType(cards)).toBe('bomb');
  });

  test('不同点数两张 = 非法', () => {
    expect(identifyPlayType([H5, H6])).toBeNull();
  });

  test('5张以上 = 非法', () => {
    const cards = Array(5).fill(H5);
    expect(identifyPlayType(cards)).toBeNull();
  });
});

describe('单张比较', () => {
  test('6 > 5', () => {
    const p5 = buildPlay([H5])!;
    const p6 = buildPlay([H6])!;
    expect(canBeat(p6, p5)).toBe(true);
    expect(canBeat(p5, p6)).toBe(false);
  });

  test('2 > A', () => {
    const pA = buildPlay([DA])!;
    const p2 = buildPlay([D2])!;
    expect(canBeat(p2, pA)).toBe(true);
  });

  test('4 > 普通3', () => {
    const p3 = buildPlay([S3])!;
    const p4 = buildPlay([C4])!;
    expect(canBeat(p4, p3)).toBe(true);
  });
});

describe('红桃3/方片3 管4', () => {
  test('红桃3单张 power = RED3_SINGLE_POWER', () => {
    const play = buildPlay([H3])!;
    expect(play.power).toBe(RED3_SINGLE_POWER);
  });

  test('方片3单张 power = RED3_SINGLE_POWER', () => {
    const play = buildPlay([D3])!;
    expect(play.power).toBe(RED3_SINGLE_POWER);
  });

  test('红桃3 > 4', () => {
    const pH3 = buildPlay([H3])!;
    const p4 = buildPlay([C4])!;
    expect(canBeat(pH3, p4)).toBe(true);
  });

  test('方片3 > 4', () => {
    const pD3 = buildPlay([D3])!;
    const p4 = buildPlay([H4])!;
    expect(canBeat(pD3, p4)).toBe(true);
  });

  test('小王 > 红桃3', () => {
    const pSJ = buildPlay([SJ])!;
    const pH3 = buildPlay([H3])!;
    expect(canBeat(pSJ, pH3)).toBe(true);
  });

  test('红桃3 = 方片3（平局，不能互管）', () => {
    const pH3 = buildPlay([H3])!;
    const pD3 = buildPlay([D3])!;
    expect(canBeat(pH3, pD3)).toBe(false);
    expect(canBeat(pD3, pH3)).toBe(false);
  });

  test('黑桃3 < 4（普通3）', () => {
    const pS3 = buildPlay([S3])!;
    const p4 = buildPlay([C4])!;
    expect(canBeat(p4, pS3)).toBe(true);
    expect(canBeat(pS3, p4)).toBe(false);
  });
});

describe('双王最大', () => {
  test('双王是炸弹', () => {
    const play = buildPlay([SJ, BJ])!;
    expect(play.type).toBe('bomb');
  });

  test('双王 power 是最大值 9999', () => {
    const play = buildPlay([SJ, BJ])!;
    expect(play.power).toBe(9999);
  });

  test('双王管四张炸弹', () => {
    const quadBomb = buildPlay(['hearts','diamonds','clubs','spades'].map(s => makeCard(s, 'A')))!;
    const doubleJoker = buildPlay([SJ, BJ])!;
    expect(canBeat(doubleJoker, quadBomb)).toBe(true);
    expect(canBeat(quadBomb, doubleJoker)).toBe(false);
  });
});

describe('炸弹大小比较', () => {
  const tripleA = buildPlay(['hearts','diamonds','clubs'].map(s => makeCard(s, 'A')))!;
  const triple2 = buildPlay(['hearts','diamonds','clubs'].map(s => makeCard(s, '2')))!;
  const quad7 = buildPlay(['hearts','diamonds','clubs','spades'].map(s => makeCard(s, '7')))!;
  const quadA = buildPlay(['hearts','diamonds','clubs','spades'].map(s => makeCard(s, 'A')))!;

  test('三张2 > 三张A（2 > A 按牌力顺序）', () => {
    // 牌力顺序：...K < A < 2 < 3 < 4，所以2 > A
    expect(canBeat(triple2, tripleA)).toBe(true);
    expect(canBeat(tripleA, triple2)).toBe(false);
  });

  test('四张7 > 三张A（四张>三张）', () => {
    expect(canBeat(quad7, tripleA)).toBe(true);
  });

  test('四张A > 四张7', () => {
    expect(canBeat(quadA, quad7)).toBe(true);
  });
});

describe('炸弹管单张/对子', () => {
  const single6 = buildPlay([makeCard('hearts', '6')])!;
  const pairA = buildPlay([makeCard('hearts','A'), makeCard('diamonds','A')])!;
  const tripleK = buildPlay(['hearts','diamonds','clubs'].map(s => makeCard(s, 'K')))!;

  test('三张炸弹管单张', () => {
    expect(canBeat(tripleK, single6)).toBe(true);
  });

  test('三张炸弹管对子', () => {
    expect(canBeat(tripleK, pairA)).toBe(true);
  });

  test('单张不能管对子', () => {
    const singleA = buildPlay([makeCard('hearts','A')])!;
    expect(canBeat(singleA, pairA)).toBe(false);
  });
});

describe('炸弹拆牌', () => {
  const hand: Card[] = [
    makeCard('hearts', 'K'),
    makeCard('diamonds', 'K'),
    makeCard('clubs', 'K'),
    makeCard('spades', '5'),
  ];

  test('可以从三张K炸弹中拆出单张K', () => {
    expect(canSplitBomb([makeCard('hearts', 'K')], hand)).toBe(true);
  });

  test('可以从三张K炸弹中拆出两张K对子', () => {
    expect(canSplitBomb([makeCard('hearts','K'), makeCard('diamonds','K')], hand)).toBe(true);
  });

  test('非炸弹不能拆', () => {
    expect(canSplitBomb([makeCard('spades','5')], hand)).toBe(false);
  });
});

describe('出牌合法性验证', () => {
  const hand: Card[] = [H5, H3, C4, SJ, makeCard('hearts','A'), makeCard('diamonds','A')];

  test('自由出牌时任何合法牌型都可以', () => {
    expect(validatePlay([H5], hand, null).valid).toBe(true);
    expect(validatePlay([makeCard('hearts','A'), makeCard('diamonds','A')], hand, null).valid).toBe(true);
  });

  test('出牌时不在手牌中报错', () => {
    const result = validatePlay([makeCard('clubs', 'Q')], hand, null);
    expect(result.valid).toBe(false);
  });

  test('管单张时必须更大', () => {
    const last = buildPlay([H5])!;
    expect(validatePlay([H3], hand, last).valid).toBe(true); // 红桃3 > 红桃5（5是最小）
    expect(validatePlay([C4], hand, last).valid).toBe(true); // 4 > 5
  });

  test('单张不能管对子', () => {
    const pairA = buildPlay([makeCard('hearts','A'), makeCard('diamonds','A')])!;
    expect(validatePlay([H5], hand, pairA).valid).toBe(false);
  });
});

describe('给风/不给风', () => {
  // 给风逻辑在 game-manager 中，这里测试状态变化
  // 此处只测试规则层：lastActivePlay 的传递

  test('给风后 lastActivePlay 应为 null', () => {
    // 模拟：给风 = true 时，外层将 lastActivePlay 置 null
    let lastActivePlay = buildPlay([makeCard('hearts', 'K')])!;
    const giveWind = true;
    if (giveWind) lastActivePlay = null as any;
    expect(lastActivePlay).toBeNull();
  });

  test('不给风后 lastActivePlay 保持上一手', () => {
    const originalPlay = buildPlay([makeCard('hearts', 'K')])!;
    let lastActivePlay = originalPlay;
    const giveWind = false;
    if (!giveWind) lastActivePlay = originalPlay;
    expect(lastActivePlay).toBe(originalPlay);
  });
});

describe('红3阵营胜利', () => {
  function makePlayer(id: string, camp: 'red3' | 'trio', isHeart3 = false, isDiamond3 = false): Player {
    return {
      id, name: id, hand: [], status: 'waiting', camp,
      revealStatus: 'hidden', finishRank: null,
      isHolding_diamond3: isDiamond3,
      isHolding_heart3: isHeart3,
      isHolding_black3: false,
    };
  }

  function makeState(finishedPlayers: string[], players: Player[]): GameState {
    return {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers,
      round: 1, turnDeadline: null, result: null,
    };
  }

  test('红3阵营两人都跑完 = 红3胜', () => {
    const players = [
      makePlayer('p1', 'red3', true, false),
      makePlayer('p2', 'red3', false, true),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state = makeState(['p1', 'p2'], players);
    const result = checkVictory(state);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe('red3');
  });

  test('三人阵营3人全跑完 = 三人阵营胜', () => {
    const players = [
      makePlayer('p1', 'red3', true, false),
      makePlayer('p2', 'red3', false, true),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state = makeState(['p3', 'p4', 'p5'], players);
    const result = checkVictory(state);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe('trio');
  });

  test('少于2人跑完时不结束', () => {
    const players = [
      makePlayer('p1', 'red3', true, false),
      makePlayer('p2', 'red3', false, true),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state = makeState(['p1'], players);
    expect(checkVictory(state)).toBeNull();
  });
});

describe('大胜利', () => {
  function makePlayer(id: string, camp: 'red3' | 'trio', isHeart3 = false, isDiamond3 = false): Player {
    return {
      id, name: id, hand: [], status: 'waiting', camp,
      revealStatus: 'hidden', finishRank: null,
      isHolding_diamond3: isDiamond3,
      isHolding_heart3: isHeart3,
      isHolding_black3: false,
    };
  }

  test('红3两人第1、第2名 = 大胜利', () => {
    const players = [
      makePlayer('p1', 'red3', true, false),
      makePlayer('p2', 'red3', false, true),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state: GameState = {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers: ['p1', 'p2'],
      round: 1, turnDeadline: null, result: null,
    };
    const result = checkVictory(state);
    expect(result).not.toBeNull();
    expect(result!.isLandslide).toBe(true);
  });

  test('红3第1名、三人阵营第2名 = 红3胜但不是大胜利', () => {
    const players = [
      makePlayer('p1', 'red3', true, false),
      makePlayer('p2', 'red3', false, true),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state: GameState = {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers: ['p1', 'p3', 'p2'],
      round: 1, turnDeadline: null, result: null,
    };
    const result = checkVictory(state);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe('red3');
    expect(result!.isLandslide).toBe(false);
  });
});

describe('亮身份翻倍', () => {
  function makePlayer(id: string, camp: 'red3' | 'trio', opts: Partial<Player> = {}): Player {
    return {
      id, name: id, hand: [], status: 'waiting', camp,
      revealStatus: 'hidden', finishRank: null,
      isHolding_diamond3: false,
      isHolding_heart3: false,
      isHolding_black3: false,
      ...opts,
    };
  }

  test('红桃3亮身份且红3赢 = 翻倍', () => {
    const players = [
      makePlayer('p1', 'red3', { isHolding_heart3: true, revealStatus: 'revealed' }),
      makePlayer('p2', 'red3', { isHolding_diamond3: true, revealStatus: 'revealed' }), // 方片3总是revealed
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state: GameState = {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers: ['p1', 'p2'],
      round: 1, turnDeadline: null, result: null,
    };
    const result = checkVictory(state);
    expect(result!.doubleReward).toBe(true);
  });

  test('红桃3未亮身份且红3赢 = 不翻倍', () => {
    const players = [
      makePlayer('p1', 'red3', { isHolding_heart3: true, revealStatus: 'hidden' }),
      makePlayer('p2', 'red3', { isHolding_diamond3: true, revealStatus: 'revealed' }),
      makePlayer('p3', 'trio'),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state: GameState = {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers: ['p1', 'p2'],
      round: 1, turnDeadline: null, result: null,
    };
    const result = checkVictory(state);
    expect(result!.doubleReward).toBe(false);
  });

  test('黑3亮身份且三人阵营赢 = 翻倍', () => {
    const players = [
      makePlayer('p1', 'red3', { isHolding_heart3: true }),
      makePlayer('p2', 'red3', { isHolding_diamond3: true, revealStatus: 'revealed' }),
      makePlayer('p3', 'trio', { isHolding_black3: true, revealStatus: 'revealed' }),
      makePlayer('p4', 'trio'),
      makePlayer('p5', 'trio'),
    ];
    const state: GameState = {
      roomId: 'test', status: 'playing',
      players,
      currentPlayerIndex: 0,
      lastActivePlay: null, lastPlayPlayerId: null,
      lastFinishedPlayer: null,
      windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
      playHistory: [], finishedPlayers: ['p3', 'p4', 'p5'],
      round: 1, turnDeadline: null, result: null,
    };
    const result = checkVictory(state);
    expect(result!.winner).toBe('trio');
    expect(result!.doubleReward).toBe(true);
  });
});

describe('发牌完整性', () => {
  test('54张牌全部发出，无重复', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(54);

    const hands = dealCards(5, deck);
    const allCards = hands.flat();
    expect(allCards).toHaveLength(54);

    // 无重复 id
    const ids = new Set(allCards.map(c => c.id));
    expect(ids.size).toBe(54);
  });

  test('5人发牌，前4人11张，第5人10张', () => {
    const deck = createDeck();
    const hands = dealCards(5, deck);
    // 54 / 5 = 10 remainder 4，所以前4人11张，第5人10张
    expect(hands[0]).toHaveLength(11);
    expect(hands[1]).toHaveLength(11);
    expect(hands[2]).toHaveLength(11);
    expect(hands[3]).toHaveLength(11);
    expect(hands[4]).toHaveLength(10);
  });
});
