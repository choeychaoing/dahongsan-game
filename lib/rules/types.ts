// ============================================================
// 《打红三》核心类型定义
// ============================================================

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'
  | 'small_joker' | 'big_joker';

/** 单张牌 */
export interface Card {
  id: string;        // 唯一标识，如 'hearts_3'
  suit: Suit;
  rank: Rank;
  display: string;   // 显示文字，如 '♥3'
}

/** 牌型类型 */
export type PlayType = 'single' | 'pair' | 'bomb';

/** 一手牌 */
export interface Play {
  cards: Card[];
  type: PlayType;
  /** 牌力值，用于比较大小（越大越强） */
  power: number;
}

/** 玩家阵营 */
export type Camp = 'red3' | 'trio';

/** 玩家状态 */
export type PlayerStatus = 'waiting' | 'playing' | 'finished';

/** 玩家身份公开状态 */
export type RevealStatus = 'hidden' | 'revealed';

/** 玩家 */
export interface Player {
  id: string;
  name: string;
  hand: Card[];         // 手牌（仅服务端和本人可见）
  status: PlayerStatus;
  camp: Camp | null;    // 服务端已知，前端仅在公开后展示
  revealStatus: RevealStatus;
  finishRank: number | null; // 完成名次，1~5
  isHolding_diamond3: boolean;
  isHolding_heart3: boolean;
  isHolding_black3: boolean;  // 黑桃3或梅花3
}

/** 房间状态 */
export type RoomStatus = 'waiting' | 'playing' | 'finished';

/** 给风决策状态 */
export interface WindDecision {
  required: boolean;
  decisionPlayerId: string | null; // 需要做决定的玩家
  lastFinishedPlayerId: string | null;
  lastActivePlay: Play | null;     // 给风前的 lastActivePlay
}

/** 游戏状态机 */
export interface GameState {
  roomId: string;
  status: RoomStatus;
  players: Player[];          // 按座位顺序
  currentPlayerIndex: number; // 当前出牌玩家索引
  lastActivePlay: Play | null; // 当前需要被管的牌
  lastPlayPlayerId: string | null; // 最后出牌的玩家ID
  lastFinishedPlayer: string | null; // 刚刚出完牌的玩家ID
  windDecision: WindDecision;
  playHistory: PlayRecord[];
  finishedPlayers: string[];  // 已跑完玩家ID列表（按顺序）
  round: number;
  turnDeadline: number | null; // Unix时间戳，超时自动跳过
  result: GameResult | null;
}

/** 出牌记录 */
export interface PlayRecord {
  playerId: string;
  playerName: string;
  play: Play | null;  // null 表示跳过
  timestamp: number;
  isPass: boolean;
}

/** 游戏结果 */
export interface GameResult {
  winner: Camp;
  isLandslide: boolean;      // 大胜利（红3阵营第1、第2名）
  doubleReward: boolean;     // 是否有翻倍奖励
  revealedPlayers: string[]; // 亮身份的玩家ID
  rankings: RankEntry[];
}

export interface RankEntry {
  playerId: string;
  playerName: string;
  camp: Camp;
  rank: number;
  revealed: boolean;
}

/** 房间 */
export interface GameRoom {
  id: string;
  hostId: string;
  players: Player[];
  status: RoomStatus;
  gameState: GameState | null;
  createdAt: number;
}

/** 客户端可见的玩家视图（隐藏手牌） */
export interface PlayerView {
  id: string;
  name: string;
  handCount: number;
  status: PlayerStatus;
  camp: Camp | null;       // 只在公开后才有值
  revealStatus: RevealStatus;
  finishRank: number | null;
  isCurrentPlayer: boolean;
}

/** 客户端可见的游戏状态 */
export interface GameStateView {
  roomId: string;
  status: RoomStatus;
  players: PlayerView[];
  myHand: Card[];
  currentPlayerId: string | null;
  lastActivePlay: Play | null;
  lastPlayPlayerId: string | null;
  windDecision: WindDecision;
  playHistory: PlayRecord[];
  round: number;
  turnDeadline: number | null;
  result: GameResult | null;
}
