// ============================================================
// 游戏状态机：管理房间 & 游戏生命周期
// ============================================================
import { v4 as uuidv4 } from 'uuid';
import {
  GameRoom, GameState, Player, Card, Play, PlayRecord,
  RoomStatus, Camp, WindDecision,
} from '../rules/types';
import {
  createDeck, shuffle, dealCards, findCardHolder,
  validatePlay, buildPlay, isHeart5, isRed3, checkVictory,
  assignCamps,
} from '../rules';

const TURN_TIMEOUT_MS = 60_000;
const MAX_PLAYERS = 5;

// ─── 内存存储 ────────────────────────────────────────────────
const rooms = new Map<string, GameRoom>();

// ─── 工具函数 ────────────────────────────────────────────────
function getNextIndex(current: number, total: number): number {
  return (current + 1) % total;
}

function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    hand: [],
    status: 'waiting',
    camp: null,
    revealStatus: 'hidden',
    finishRank: null,
    isHolding_diamond3: false,
    isHolding_heart3: false,
    isHolding_black3: false,
  };
}

function makeWindDecision(): WindDecision {
  return {
    required: false,
    decisionPlayerId: null,
    lastFinishedPlayerId: null,
    lastActivePlay: null,
  };
}

// ─── 房间管理 ────────────────────────────────────────────────

export function createRoom(hostId: string, hostName: string): GameRoom {
  const room: GameRoom = {
    id: uuidv4().slice(0, 6).toUpperCase(),
    hostId,
    players: [makePlayer(hostId, hostName)],
    status: 'waiting',
    gameState: null,
    createdAt: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

export function joinRoom(
  roomId: string,
  playerId: string,
  playerName: string,
): { success: boolean; error?: string; room?: GameRoom } {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: '房间不存在' };
  if (room.status !== 'waiting') return { success: false, error: '游戏已开始' };
  if (room.players.length >= MAX_PLAYERS) return { success: false, error: '房间已满' };
  if (room.players.some(p => p.id === playerId)) return { success: true, room }; // 重连

  room.players.push(makePlayer(playerId, playerName));
  return { success: true, room };
}

export function leaveRoom(roomId: string, playerId: string): GameRoom | null {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'waiting') return null;
  room.players = room.players.filter(p => p.id !== playerId);
  if (room.players.length === 0) {
    rooms.delete(roomId);
    return null;
  }
  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }
  return room;
}

export function getRoom(roomId: string): GameRoom | undefined {
  return rooms.get(roomId);
}

export function getAllRooms(): GameRoom[] {
  return Array.from(rooms.values()).filter(r => r.status === 'waiting');
}

// ─── 游戏启动 ────────────────────────────────────────────────

export function startGame(roomId: string): { success: boolean; error?: string } {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: '房间不存在' };
  if (room.players.length !== MAX_PLAYERS) {
    return { success: false, error: `需要满5人才能开始，当前${room.players.length}人` };
  }

  const deck = shuffle(createDeck());
  const hands = dealCards(MAX_PLAYERS, deck);

  // 分配手牌并设置身份标记
  room.players.forEach((player, i) => {
    player.hand = hands[i];
    player.status = 'playing';
    player.isHolding_diamond3 = hands[i].some(c => c.suit === 'diamonds' && c.rank === '3');
    player.isHolding_heart3 = hands[i].some(c => c.suit === 'hearts' && c.rank === '3');
    player.isHolding_black3 = hands[i].some(
      c => c.rank === '3' && (c.suit === 'spades' || c.suit === 'clubs')
    );
  });

  assignCamps(room.players);

  // 找持有红桃5的玩家作为第一个出牌人
  const heart5HolderIdx = room.players.findIndex(p =>
    p.hand.some(c => isHeart5(c))
  );
  const startIdx = heart5HolderIdx >= 0 ? heart5HolderIdx : 0;

  const gameState: GameState = {
    roomId,
    status: 'playing',
    players: room.players,
    currentPlayerIndex: startIdx,
    lastActivePlay: null,
    lastPlayPlayerId: null,
    lastFinishedPlayer: null,
    windDecision: makeWindDecision(),
    playHistory: [],
    finishedPlayers: [],
    round: 1,
    turnDeadline: Date.now() + TURN_TIMEOUT_MS,
    result: null,
  };

  room.status = 'playing';
  room.gameState = gameState;
  return { success: true };
}

// ─── 出牌处理 ────────────────────────────────────────────────

export interface PlayResult {
  success: boolean;
  error?: string;
  state?: GameState;
  finished?: boolean; // 游戏结束
}

export function handlePlay(
  roomId: string,
  playerId: string,
  cardIds: string[],
): PlayResult {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return { success: false, error: '游戏未开始' };

  const state = room.gameState;
  if (state.status !== 'playing') return { success: false, error: '游戏已结束' };

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.id !== playerId) return { success: false, error: '还没轮到你' };

  // 给风决策阶段不允许直接出牌
  if (state.windDecision.required && state.windDecision.decisionPlayerId === playerId) {
    return { success: false, error: '请先做给风决策' };
  }

  const cards = currentPlayer.hand.filter(c => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) {
    return { success: false, error: '手牌中没有这些牌' };
  }

  const validation = validatePlay(cards, currentPlayer.hand, state.lastActivePlay);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const play = buildPlay(cards)!;

  // 从手牌中移除已出的牌
  currentPlayer.hand = currentPlayer.hand.filter(c => !cardIds.includes(c.id));

  const record: PlayRecord = {
    playerId,
    playerName: currentPlayer.name,
    play,
    timestamp: Date.now(),
    isPass: false,
  };
  state.playHistory.push(record);

  state.lastActivePlay = play;
  state.lastPlayPlayerId = playerId;

  // 检查是否出完所有牌
  if (currentPlayer.hand.length === 0) {
    currentPlayer.status = 'finished';
    currentPlayer.finishRank = state.finishedPlayers.length + 1;
    state.finishedPlayers.push(playerId);
    state.lastFinishedPlayer = playerId;

    // 检查胜负
    const result = checkVictory(state);
    if (result) {
      state.result = result;
      state.status = 'finished';
      room.status = 'finished';
      return { success: true, state, finished: true };
    }

    // 下一位玩家需要做"给风"决策
    const nextIdx = findNextActivePlayer(state, state.currentPlayerIndex);
    if (nextIdx === -1) {
      // 所有人都完成
      return { success: true, state, finished: true };
    }

    state.windDecision = {
      required: true,
      decisionPlayerId: state.players[nextIdx].id,
      lastFinishedPlayerId: playerId,
      lastActivePlay: play,
    };
    state.currentPlayerIndex = nextIdx;
    state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

    return { success: true, state };
  }

  // 正常推进到下一位
  const nextIdx = findNextActivePlayer(state, state.currentPlayerIndex);
  if (nextIdx === -1) {
    return { success: true, state, finished: true };
  }
  state.currentPlayerIndex = nextIdx;
  state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

  return { success: true, state };
}

// ─── 跳过 ────────────────────────────────────────────────────

export function handlePass(roomId: string, playerId: string): PlayResult {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return { success: false, error: '游戏未开始' };

  const state = room.gameState;
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.id !== playerId) return { success: false, error: '还没轮到你' };

  if (!state.lastActivePlay) {
    return { success: false, error: '自由出牌轮不能跳过' };
  }

  if (state.windDecision.required) {
    return { success: false, error: '请先做给风决策' };
  }

  const record: PlayRecord = {
    playerId,
    playerName: currentPlayer.name,
    play: null,
    timestamp: Date.now(),
    isPass: true,
  };
  state.playHistory.push(record);

  // 检查是否所有人都跳过（回到出牌者本人）
  const nextIdx = findNextActivePlayer(state, state.currentPlayerIndex);
  if (nextIdx === -1) return { success: true, state };

  // 检查一轮内是否所有人都pass了（除了lastPlayPlayerId）
  const activePlayers = state.players.filter(p => p.status === 'playing');
  if (activePlayers.length === 1) {
    // 只剩自己了，清空 lastActivePlay，自由出牌
    state.lastActivePlay = null;
    state.currentPlayerIndex = nextIdx;
    state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    return { success: true, state };
  }

  // 检查是否转回到出牌者
  const nextPlayer = state.players[nextIdx];
  if (nextPlayer.id === state.lastPlayPlayerId) {
    // 一圈都pass了，出牌者获得自由出牌权
    state.lastActivePlay = null;
  }

  state.currentPlayerIndex = nextIdx;
  state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

  return { success: true, state };
}

// ─── 给风决策 ────────────────────────────────────────────────

export function handleWindDecision(
  roomId: string,
  playerId: string,
  giveWind: boolean, // true=给风, false=不给风
): PlayResult {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return { success: false, error: '游戏未开始' };

  const state = room.gameState;

  if (!state.windDecision.required) {
    return { success: false, error: '当前不需要给风决策' };
  }

  if (state.windDecision.decisionPlayerId !== playerId) {
    return { success: false, error: '不是你做给风决策' };
  }

  if (giveWind) {
    // 给风：清空 lastActivePlay，玩家自由出牌
    state.lastActivePlay = null;
    state.windDecision = makeWindDecision();
  } else {
    // 不给风：必须管 lastActivePlay
    state.lastActivePlay = state.windDecision.lastActivePlay;
    state.windDecision = makeWindDecision();
  }

  state.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

  return { success: true, state };
}

// ─── 亮身份 ──────────────────────────────────────────────────

export function handleReveal(
  roomId: string,
  playerId: string,
): PlayResult {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return { success: false, error: '游戏未开始' };

  const state = room.gameState;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { success: false, error: '玩家不存在' };

  if (player.revealStatus === 'revealed') {
    return { success: false, error: '已经亮过身份了' };
  }

  // 只有红桃3 / 黑桃3 / 梅花3 可以主动亮
  if (!player.isHolding_heart3 && !player.isHolding_black3) {
    return { success: false, error: '你没有亮身份的资格' };
  }

  player.revealStatus = 'revealed';
  return { success: true, state };
}

// ─── 超时处理 ────────────────────────────────────────────────

export function handleTimeout(roomId: string): PlayResult {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return { success: false, error: '游戏未开始' };

  const state = room.gameState;
  if (state.status !== 'playing') return { success: false, error: '游戏已结束' };
  if (!state.turnDeadline || Date.now() < state.turnDeadline) {
    return { success: false, error: '未超时' };
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  // 超时时：
  // - 如果是给风决策阶段，默认给风
  if (state.windDecision.required && state.windDecision.decisionPlayerId === currentPlayer.id) {
    return handleWindDecision(roomId, currentPlayer.id, true);
  }

  // - 否则自动跳过
  if (state.lastActivePlay) {
    return handlePass(roomId, currentPlayer.id);
  }

  // 自由出牌超时：随机出一张最小的牌
  const smallestCard = currentPlayer.hand.sort((a, b) => {
    const pa = buildPlay([a])?.power ?? 0;
    const pb = buildPlay([b])?.power ?? 0;
    return pa - pb;
  })[0];

  return handlePlay(roomId, currentPlayer.id, [smallestCard.id]);
}

// ─── 工具：找下一个未完成的玩家 ──────────────────────────────

function findNextActivePlayer(state: GameState, currentIdx: number): number {
  const total = state.players.length;
  let next = getNextIndex(currentIdx, total);
  let checked = 0;
  while (state.players[next].status === 'finished') {
    next = getNextIndex(next, total);
    checked++;
    if (checked >= total) return -1;
  }
  return next;
}
