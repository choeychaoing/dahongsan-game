#!/usr/bin/env node
// ============================================================
// 生产/开发 统一服务器：Next.js + Socket.IO 同端口
// 部署到 Zeabur / Railway / 任意 PaaS 时只需 npm run build && npm start
// ============================================================
'use strict';

const { createServer } = require('http');
const { parse } = require('url');
const path = require('path');
const next = require('next');

const PORT = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

// ─── 内联游戏逻辑 ─────────────────────────────────────────────

const RANK_VALUES = {
  '5': 1, '6': 2, '7': 3, '8': 4, '9': 5, '10': 6,
  'J': 7, 'Q': 8, 'K': 9, 'A': 10, '2': 11, '3': 12,
  '4': 13, 'small_joker': 14, 'big_joker': 15
};
const RED3_SINGLE_POWER = 13.5;

function isRed3(card) {
  return card.rank === '3' && (card.suit === 'hearts' || card.suit === 'diamonds');
}
function isDoubleJoker(cards) {
  if (cards.length !== 2) return false;
  const ranks = cards.map(c => c.rank).sort();
  return ranks[0] === 'big_joker' && ranks[1] === 'small_joker';
}
function cardPower(card) { return RANK_VALUES[card.rank] || 0; }
function identifyPlayType(cards) {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return 'single';
  if (cards.length === 2) {
    if (isDoubleJoker(cards)) return 'bomb';
    if (cards[0].rank === cards[1].rank) return 'pair';
    return null;
  }
  if (cards.length === 3) {
    if (cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank) return 'bomb';
    return null;
  }
  if (cards.length === 4) {
    if (cards.every(c => c.rank === cards[0].rank)) return 'bomb';
    return null;
  }
  return null;
}
function computePower(cards, type) {
  if (type === 'single') {
    if (isRed3(cards[0])) return RED3_SINGLE_POWER;
    return cardPower(cards[0]);
  }
  if (type === 'pair') return cardPower(cards[0]);
  if (type === 'bomb') {
    if (isDoubleJoker(cards)) return 9999;
    const base = cards.length === 4 ? 1000 : 500;
    return base + cardPower(cards[0]);
  }
  return 0;
}
function buildPlay(cards) {
  const type = identifyPlayType(cards);
  if (!type) return null;
  return { cards, type, power: computePower(cards, type) };
}
function canBeat(attacker, defender) {
  if (attacker.type === 'bomb') {
    if (defender.type !== 'bomb') return true;
    return attacker.power > defender.power;
  }
  if (attacker.type !== defender.type) return false;
  return attacker.power > defender.power;
}
function validatePlay(cards, hand, lastActivePlay) {
  if (!cards || cards.length === 0) return { valid: false, reason: '未选择任何牌' };
  for (const card of cards) {
    if (!hand.some(c => c.id === card.id)) return { valid: false, reason: '出的牌不在手牌中' };
  }
  const play = buildPlay(cards);
  if (!play) return { valid: false, reason: '非法牌型，只允许单张、对子、炸弹' };
  if (!lastActivePlay) return { valid: true };
  if (!canBeat(play, lastActivePlay)) {
    if (play.type !== lastActivePlay.type && play.type !== 'bomb')
      return { valid: false, reason: `必须出${lastActivePlay.type === 'single' ? '单张' : '对子'}或炸弹` };
    return { valid: false, reason: '牌不够大，无法管牌' };
  }
  return { valid: true };
}
function createDeck() {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const symbols = { spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣', joker:'🃏' };
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ id:`${suit}_${rank}`, suit, rank, display:`${symbols[suit]}${rank}` });
    }
  }
  deck.push({ id:'joker_small', suit:'joker', rank:'small_joker', display:'小王' });
  deck.push({ id:'joker_big', suit:'joker', rank:'big_joker', display:'大王' });
  return deck;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function dealCards(n, deck) {
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => hands[i % n].push(c));
  return hands;
}
function checkVictory(state) {
  const { players, finishedPlayers } = state;
  if (finishedPlayers.length < 2) return null;
  const red3Players = players.filter(p => p.camp === 'red3');
  const trioPlayers = players.filter(p => p.camp === 'trio');
  const red3Finished = red3Players.filter(p => finishedPlayers.includes(p.id));
  const trioFinished = trioPlayers.filter(p => finishedPlayers.includes(p.id));
  if (trioFinished.length === 3) return buildResult(state, 'trio');
  if (red3Finished.length === 2) return buildResult(state, 'red3');
  if (finishedPlayers.length === 4) {
    if (red3Finished.length === 2) return buildResult(state, 'red3');
    return buildResult(state, 'trio');
  }
  return null;
}
function buildResult(state, winner) {
  const { players, finishedPlayers } = state;
  const allRanked = [...finishedPlayers];
  players.forEach(p => { if (!allRanked.includes(p.id)) allRanked.push(p.id); });
  const rankings = allRanked.map((id, idx) => {
    const player = players.find(p => p.id === id);
    return { playerId: player.id, playerName: player.name, camp: player.camp, rank: idx + 1,
      revealed: player.revealStatus === 'revealed' };
  });
  const red3Rankings = rankings.filter(r => r.camp === 'red3').map(r => r.rank).sort((a,b)=>a-b);
  const isLandslide = winner === 'red3' && red3Rankings.length === 2
    && red3Rankings[0] === 1 && red3Rankings[1] === 2;
  let doubleReward = false;
  if (winner === 'red3') {
    const heart3 = players.find(p => p.isHolding_heart3);
    if (heart3 && heart3.revealStatus === 'revealed') doubleReward = true;
  } else {
    const black3s = players.filter(p => p.isHolding_black3);
    if (black3s.some(p => p.revealStatus === 'revealed')) doubleReward = true;
  }
  const revealedPlayers = players
    .filter(p => p.revealStatus === 'revealed' && (p.isHolding_heart3 || p.isHolding_black3))
    .map(p => p.id);
  return { winner, isLandslide, doubleReward, revealedPlayers, rankings };
}

// ─── 房间管理 ─────────────────────────────────────────────────
const rooms = new Map();
const TURN_TIMEOUT = 60000;

function makePlayer(id, name) {
  return {
    id, name, hand: [], status: 'waiting', camp: null,
    revealStatus: 'hidden', finishRank: null,
    isHolding_diamond3: false, isHolding_heart3: false, isHolding_black3: false,
  };
}
function getNextActive(state, currentIdx) {
  const total = state.players.length;
  let next = (currentIdx + 1) % total;
  let checked = 0;
  while (state.players[next].status === 'finished') {
    next = (next + 1) % total;
    if (++checked >= total) return -1;
  }
  return next;
}
function sanitizeRoom(room) {
  return {
    id: room.id, hostId: room.hostId, status: room.status,
    playerCount: room.players.length,
    players: room.players.map(p => ({ id: p.id, name: p.name, status: p.status })),
  };
}
function buildGameStateView(roomId, viewerId) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return null;
  const state = room.gameState;
  const playerViews = state.players.map((p, idx) => ({
    id: p.id, name: p.name, handCount: p.hand.length, status: p.status,
    camp: p.revealStatus === 'revealed' ? p.camp : null,
    revealStatus: p.revealStatus, finishRank: p.finishRank,
    isCurrentPlayer: idx === state.currentPlayerIndex,
  }));
  const myPlayer = state.players.find(p => p.id === viewerId);
  return {
    roomId, status: state.status, players: playerViews,
    myHand: myPlayer?.hand ?? [],
    currentPlayerId: state.players[state.currentPlayerIndex]?.id ?? null,
    lastActivePlay: state.lastActivePlay,
    lastPlayPlayerId: state.lastPlayPlayerId,
    windDecision: state.windDecision,
    playHistory: state.playHistory.slice(-20),
    round: state.round,
    turnDeadline: state.turnDeadline,
    result: state.result,
  };
}
function broadcastGameState(roomId, io) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return;
  room.gameState.players.forEach(player => {
    const view = buildGameStateView(roomId, player.id);
    if (!view) return;
    const s = io.sockets.sockets.get(player.id);
    if (s) s.emit('game_state', view);
  });
}
function doPlay(roomId, playerId, cardIds, io) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return { success: false, error: '游戏未开始' };
  const state = room.gameState;
  if (state.status !== 'playing') return { success: false, error: '游戏已结束' };
  const cp = state.players[state.currentPlayerIndex];
  if (cp.id !== playerId) return { success: false, error: '还没轮到你' };
  if (state.windDecision.required && state.windDecision.decisionPlayerId === playerId)
    return { success: false, error: '请先做给风决策' };
  const cards = cp.hand.filter(c => cardIds.includes(c.id));
  if (cards.length !== cardIds.length) return { success: false, error: '手牌中没有这些牌' };
  const v = validatePlay(cards, cp.hand, state.lastActivePlay);
  if (!v.valid) return { success: false, error: v.reason };
  const play = buildPlay(cards);
  cp.hand = cp.hand.filter(c => !cardIds.includes(c.id));
  state.playHistory.push({ playerId, playerName: cp.name, play, timestamp: Date.now(), isPass: false });
  state.lastActivePlay = play;
  state.lastPlayPlayerId = playerId;
  if (cp.hand.length === 0) {
    cp.status = 'finished';
    cp.finishRank = state.finishedPlayers.length + 1;
    state.finishedPlayers.push(playerId);
    state.lastFinishedPlayer = playerId;
    const result = checkVictory(state);
    if (result) {
      state.result = result; state.status = 'finished'; room.status = 'finished';
      return { success: true, finished: true, gameResult: result };
    }
    const nextIdx = getNextActive(state, state.currentPlayerIndex);
    if (nextIdx === -1) return { success: true, finished: true, gameResult: null };
    state.windDecision = {
      required: true, decisionPlayerId: state.players[nextIdx].id,
      lastFinishedPlayerId: playerId, lastActivePlay: play,
    };
    state.currentPlayerIndex = nextIdx;
    state.turnDeadline = Date.now() + TURN_TIMEOUT;
    return { success: true };
  }
  const nextIdx = getNextActive(state, state.currentPlayerIndex);
  if (nextIdx === -1) return { success: true, finished: true, gameResult: null };
  state.currentPlayerIndex = nextIdx;
  state.turnDeadline = Date.now() + TURN_TIMEOUT;
  return { success: true };
}
function doPass(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return { success: false, error: '游戏未开始' };
  const state = room.gameState;
  const cp = state.players[state.currentPlayerIndex];
  if (cp.id !== playerId) return { success: false, error: '还没轮到你' };
  if (!state.lastActivePlay) return { success: false, error: '自由出牌不能跳过' };
  if (state.windDecision.required) return { success: false, error: '请先做给风决策' };
  state.playHistory.push({ playerId, playerName: cp.name, play: null, timestamp: Date.now(), isPass: true });
  const nextIdx = getNextActive(state, state.currentPlayerIndex);
  if (nextIdx === -1) return { success: true };
  const nextPlayer = state.players[nextIdx];
  if (nextPlayer.id === state.lastPlayPlayerId) state.lastActivePlay = null;
  state.currentPlayerIndex = nextIdx;
  state.turnDeadline = Date.now() + TURN_TIMEOUT;
  return { success: true };
}
function doWindDecision(roomId, playerId, giveWind) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return { success: false, error: '游戏未开始' };
  const state = room.gameState;
  if (!state.windDecision.required) return { success: false, error: '当前不需要给风决策' };
  if (state.windDecision.decisionPlayerId !== playerId) return { success: false, error: '不是你做决策' };
  state.lastActivePlay = giveWind ? null : state.windDecision.lastActivePlay;
  state.windDecision = { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null };
  state.turnDeadline = Date.now() + TURN_TIMEOUT;
  return { success: true };
}

// ─── 启动服务器 ───────────────────────────────────────────────
async function main() {
  // 1. 初始化 Next.js（不指定 dir，使用当前工作目录）
  const app = next({ dev, dir: path.resolve(__dirname) });
  const handle = app.getRequestHandler();
  await app.prepare();
  console.log(`[INFO] Next.js 已就绪 (${dev ? '开发' : '生产'} 模式)`);

  // 2. 创建 HTTP 服务器，代理给 Next.js
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // 3. 挂载 Socket.IO
  const { Server: SocketIOServer } = require('socket.io');
  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    let currentRoomId = null;
    let playerName = '玩家' + socket.id.slice(0, 4);
    console.log(`[+] 连接: ${socket.id}`);

    socket.on('set_name', (name) => {
      if (typeof name === 'string' && name.trim()) playerName = name.trim().slice(0, 12);
    });

    socket.on('create_room', (cb) => {
      const room = {
        id: Math.random().toString(36).slice(2, 8).toUpperCase(),
        hostId: socket.id,
        players: [makePlayer(socket.id, playerName)],
        status: 'waiting', gameState: null, createdAt: Date.now(),
      };
      rooms.set(room.id, room);
      currentRoomId = room.id;
      socket.join(room.id);
      cb({ success: true, roomId: room.id, room: sanitizeRoom(room) });
      console.log(`[R] 创建房间 ${room.id} by ${playerName}`);
    });

    socket.on('join_room', (roomId, cb) => {
      roomId = String(roomId).toUpperCase();
      const room = rooms.get(roomId);
      if (!room) { cb({ success: false, error: '房间不存在' }); return; }
      if (room.status !== 'waiting') { cb({ success: false, error: '游戏已开始' }); return; }
      if (room.players.length >= 5 && !room.players.some(p => p.id === socket.id)) {
        cb({ success: false, error: '房间已满' }); return;
      }
      if (!room.players.some(p => p.id === socket.id)) {
        room.players.push(makePlayer(socket.id, playerName));
      }
      currentRoomId = roomId;
      socket.join(roomId);
      socket.to(roomId).emit('room_updated', sanitizeRoom(room));
      cb({ success: true, room: sanitizeRoom(room) });
      console.log(`[R] ${playerName} 加入房间 ${roomId}`);
    });

    socket.on('get_rooms', (cb) => {
      const waiting = [];
      rooms.forEach(r => { if (r.status === 'waiting') waiting.push(sanitizeRoom(r)); });
      cb({ rooms: waiting });
    });

    socket.on('start_game', (cb) => {
      const room = rooms.get(currentRoomId);
      if (!room) { cb({ success: false, error: '不在房间' }); return; }
      if (room.hostId !== socket.id) { cb({ success: false, error: '只有房主可以开始' }); return; }
      if (room.players.length !== 5) { cb({ success: false, error: `需要5人，当前${room.players.length}人` }); return; }
      const deck = shuffle(createDeck());
      const hands = dealCards(5, deck);
      room.players.forEach((player, i) => {
        player.hand = hands[i];
        player.status = 'playing';
        player.isHolding_diamond3 = hands[i].some(c => c.suit === 'diamonds' && c.rank === '3');
        player.isHolding_heart3 = hands[i].some(c => c.suit === 'hearts' && c.rank === '3');
        player.isHolding_black3 = hands[i].some(c => c.rank === '3' && (c.suit === 'spades' || c.suit === 'clubs'));
        player.camp = (player.isHolding_diamond3 || player.isHolding_heart3) ? 'red3' : 'trio';
        if (player.isHolding_diamond3) player.revealStatus = 'revealed';
      });
      let startIdx = room.players.findIndex(p => p.hand.some(c => c.suit === 'hearts' && c.rank === '5'));
      if (startIdx < 0) startIdx = 0;
      room.gameState = {
        roomId: currentRoomId, status: 'playing', players: room.players,
        currentPlayerIndex: startIdx, lastActivePlay: null, lastPlayPlayerId: null,
        lastFinishedPlayer: null,
        windDecision: { required: false, decisionPlayerId: null, lastFinishedPlayerId: null, lastActivePlay: null },
        playHistory: [], finishedPlayers: [], round: 1,
        turnDeadline: Date.now() + TURN_TIMEOUT, result: null,
      };
      room.status = 'playing';
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
      console.log(`[G] 房间 ${currentRoomId} 游戏开始，先手: ${room.players[startIdx].name}`);
    });

    socket.on('play_cards', (cardIds, cb) => {
      const result = doPlay(currentRoomId, socket.id, cardIds, io);
      if (!result.success) { cb({ success: false, error: result.error }); return; }
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
      if (result.finished) io.to(currentRoomId).emit('game_over', result.gameResult);
    });

    socket.on('pass', (cb) => {
      const result = doPass(currentRoomId, socket.id);
      if (!result.success) { cb({ success: false, error: result.error }); return; }
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
    });

    socket.on('wind_decision', (giveWind, cb) => {
      const result = doWindDecision(currentRoomId, socket.id, giveWind);
      if (!result.success) { cb({ success: false, error: result.error }); return; }
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
    });

    socket.on('reveal_identity', (cb) => {
      const room = rooms.get(currentRoomId);
      if (!room?.gameState) { cb({ success: false, error: '游戏未开始' }); return; }
      const player = room.gameState.players.find(p => p.id === socket.id);
      if (!player) { cb({ success: false, error: '玩家不存在' }); return; }
      if (player.revealStatus === 'revealed') { cb({ success: false, error: '已经亮过了' }); return; }
      if (!player.isHolding_heart3 && !player.isHolding_black3) { cb({ success: false, error: '没有亮身份资格' }); return; }
      player.revealStatus = 'revealed';
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
    });

    socket.on('check_timeout', () => {
      const room = rooms.get(currentRoomId);
      if (!room?.gameState) return;
      const state = room.gameState;
      if (state.status !== 'playing' || !state.turnDeadline || Date.now() <= state.turnDeadline) return;
      const current = state.players[state.currentPlayerIndex];
      if (state.windDecision.required && state.windDecision.decisionPlayerId === current.id) {
        doWindDecision(currentRoomId, current.id, true);
      } else if (state.lastActivePlay) {
        doPass(currentRoomId, current.id);
      } else {
        const sorted = [...current.hand].sort((a, b) => (buildPlay([a])?.power ?? 0) - (buildPlay([b])?.power ?? 0));
        if (sorted.length > 0) doPlay(currentRoomId, current.id, [sorted[0].id], io);
      }
      broadcastGameState(currentRoomId, io);
    });

    socket.on('disconnect', () => {
      console.log(`[-] 断线: ${socket.id}`);
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (room && room.status === 'waiting') {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(currentRoomId);
        } else {
          if (room.hostId === socket.id) room.hostId = room.players[0].id;
          socket.to(currentRoomId).emit('room_updated', sanitizeRoom(room));
        }
      }
    });
  });

  // 4. 启动监听
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🃏 打红三 运行在 http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
