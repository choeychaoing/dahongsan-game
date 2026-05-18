'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const { Server } = require("socket.io");
const next_1 = __importDefault(require("next"));

const dev = process.env.NODE_ENV !== 'production';
const app = next_1.default({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express_1.default();
  const httpServer = http_1.default.createServer(server);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ==================== 游戏配置 ====================
  const TURN_TIMEOUT = 30000; // 30秒出牌超时
  const BOT_NAMES = ['小智', '小明', '小红', '阿强', '大黄', '小花', '老王', '铁柱',
    '翠花', '二狗', '三炮', '石头', '木头', '阿福', '小胖', '瘦子',
    '胖子', '矮子', '高个', '小美', '大壮', '猴子', '老虎', '老外'];
  const WINDS = ['东', '南', '西', '北'];

  // ==================== 房间/玩家管理 ====================
  const rooms = new Map();
  function makePlayer(id, name) {
    return { id, name, hand: [], status: 'waiting', isHolding_diamond3: false,
      isHolding_heart3: false, isHolding_black3: false, isHolding_heart5: false,
      isRevealed: false, revealStatus: 'none', camp: null };
  }
  function sanitizeRoom(room) {
    return { id: room.id, hostId: room.hostId, status: room.status,
      players: room.players.map(p => ({ id: p.id, name: p.name, status: p.status })),
      playerCount: room.players.length };
  }
  function broadcastGameState(roomId, io) {
    const room = rooms.get(roomId);
    if (!room) return;
    io.to(roomId).emit('game_state', { roomId, status: room.status, players: room.players,
      currentPlayerIndex: room.gameState?.currentPlayerIndex ?? 0,
      lastActivePlay: room.gameState?.lastActivePlay ?? null,
      lastPlayPlayerId: room.gameState?.lastPlayPlayerId ?? null,
      lastFinishedPlayer: room.gameState?.lastFinishedPlayer ?? null,
      windDecision: room.gameState?.windDecision ?? null,
      playHistory: room.gameState?.playHistory ?? [],
      finishedPlayers: room.gameState?.finishedPlayers ?? [],
      round: room.gameState?.round ?? 1,
      turnDeadline: room.gameState?.turnDeadline ?? Date.now() + TURN_TIMEOUT,
      result: room.gameState?.result ?? null });
  }
  function broadcastRoom(roomId, io) { io.to(roomId).emit('room_updated', sanitizeRoom(rooms.get(roomId))); }

  // ==================== 发牌/出牌逻辑 ====================
  function createDeck() {
    const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
    const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    const deck = [];
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, id: `${suit}_${rank}` });
        if (!(suit === 'hearts' && rank === '5')) deck.push({ suit, rank, id: `${suit}_${rank}_2` });
      }
    }
    return deck;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function dealCards(playerCount, deck) {
    const hands = Array.from({ length: playerCount }, () => []);
    deck.forEach((card, idx) => { hands[idx % playerCount].push(card); });
    return hands;
  }
  function cardValue(card) {
    const rankOrder = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
    let base = rankOrder.indexOf(card.rank);
    if (card.suit === 'hearts' && card.rank === '5') base = -1;
    return base * 4 + ['spades','hearts','clubs','diamonds'].indexOf(card.suit);
  }
  function sortHand(hand) { return hand.sort((a, b) => cardValue(a) - cardValue(b)); }
  function formatCards(cards) {
    if (!cards || cards.length === 0) return '空';
    const suitMap = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
    const rankMap = { '10': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A', '2': '2' };
    return cards.map(c => {
      const suitSym = suitMap[c.suit] || c.suit;
      const isRed = c.suit === 'hearts' || c.suit === 'diamonds';
      const rankStr = rankMap[c.rank] || c.rank;
      return `${isRed ? '❤️' : '⚫'}${rankStr}${suitSym}`;
    }).join(' | ');
  }
  function formatPlay(play) {
    if (!play) return '无';
    const suitMap = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
    const rankMap = { '10': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A', '2': '2' };
    return play.cards.map(c => {
      const suitSym = suitMap[c.suit] || c.suit;
      const isRed = c.suit === 'hearts' || c.suit === 'diamonds';
      return `${isRed ? '❤️' : '⚫'}${rankMap[c.rank] || c.rank}${suitSym}`;
    }).join(' | ');
  }
  function canBeat(playCards, lastCards) {
    if (!lastCards || lastCards.length !== playCards.length) return false;
    if (playCards.length === 1) return cardValue(playCards[0]) > cardValue(lastCards[0]);
    if (playCards.length === 2) {
      const pVals = playCards.map(cardValue).sort((a, b) => a - b);
      const lVals = lastCards.map(cardValue).sort((a, b) => a - b);
      if (pVals[0] === pVals[1] && lVals[0] === lVals[1]) return pVals[0] > lVals[0];
    }
    return false;
  }
  function validatePlay(cards, player, lastPlay, isFirstPlay) {
    if (!cards || cards.length === 0) return { valid: false, reason: '无牌' };
    const hand = player.hand;
    if (!cards.every(c => hand.some(h => h.id === c.id))) return { valid: false, reason: '手牌不足' };
    const types = [...new Set(cards.map(c => `${c.suit}_${c.rank}`))];
    if (cards.length === 1) return { valid: true, type: 'single', value: cardValue(cards[0]) };
    if (cards.length === 2) {
      if (types.length === 1) return { valid: true, type: 'pair', value: cardValue(cards[0]) };
      const vals = cards.map(cardValue).sort((a, b) => a - b);
      if (vals[0] === vals[1]) return { valid: true, type: 'pair', value: vals[0] };
    }
    if (cards.length === 4 && types.length === 1) return { valid: true, type: 'bomb', value: 100 + cardValue(cards[0]) };
    if (cards.length === 4) {
      const vals = cards.map(cardValue).sort((a, b) => a - b);
      if (vals[0] === vals[1] && vals[2] === vals[3]) return { valid: true, type: 'fullhouse', value: vals[2] };
    }
    return { valid: false, reason: '不支持的牌型' };
  }

  // ==================== GPT 决策 ====================
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.jiekou.ai/openai';
  const BOT_THINK_TIME = parseInt(process.env.BOT_THINK_TIME || '2000');
  const GAME_SYSTEM_PROMPT = `你是一个5人"打红三"扑克游戏的AI玩家。

【游戏规则】
- 5人玩54张牌（52张标准牌 + 方片3 + 红桃5各2张）
- 方片3为公开红3（持有者必须亮明身份，加入红3阵营）
- 红桃5为特殊牌（最小，必须首个出，出完后持有者成为红3阵营）
- 红3阵营：方片3持有者 + 红桃5持有者（共2人，♥5持有者初始不公开）
- 三人阵营：其余3人
- 阵营信息通过出牌顺序和亮牌行为推测

【出牌规则】
- 首个出牌者可出任意合法牌型（单张、对子、炸弹）
- 后续必须出比上家大的牌（同数量、同牌型）
- 单张：对子只能管单张，炸弹可管任意牌
- 对子：必须出更大的对子
- 炸弹：可管任意牌型

【出牌阶段】
- 自由出牌阶段：可出任意合法牌型
- 管牌阶段：必须出比上家大的牌，或选择跳过（跳过后本轮不能再出）

【获胜条件】
- 红3阵营：红3阵营玩家全部出完手牌
- 三人阵营：三人阵营玩家全部出完手牌

请根据当前局面和手牌做出最优决策。`;

  function buildGamePrompt(state, botPlayer) {
    const me = state.players.find(p => p.id === botPlayer.id);
    const hand = sortHand(me?.hand || []);
    const lastPlay = state.lastActivePlay;
    const lastPlayer = state.players.find(p => p.id === state.lastPlayPlayerId);
    const others = state.players.filter(p => p.id !== botPlayer.id)
      .map(p => `${p.name} (${p.status === 'finished' ? '已出完' : '剩余' + p.hand.length + '张'})`).join('\n');
    const history = (state.playHistory || []).slice(-10)
      .map(h => `${h.playerName}: ${formatPlay(h.play)}`).join('\n') || '暂无';
    const handStr = formatCards(hand);
    let lastPlayStr = '无（自由出牌）';
    if (lastPlay) {
      const playerName = lastPlayer?.name || '?';
      lastPlayStr = `${playerName} 出: ${formatPlay(lastPlay.cards)}`;
    }
    return `${GAME_SYSTEM_PROMPT}

【你的身份】
- 玩家名：${botPlayer.name}
- 剩余手牌数：${hand.length}
- 手牌：${handStr}

【当前局面】
- 最后出牌：${lastPlayStr}
- 当前轮次：第${state.round}轮
- 是否轮到你：true

【出牌历史】(最近10条)
${history}

【其他玩家】
${others}

【决策要求】
1. 如果能管住上家的牌，选择最小的能管住的牌
2. 如果管不住，选择跳过(pass)
3. 优先保留炸弹和高牌

输出JSON格式：
{
  "action": "play" | "pass",
  "cardIds": ["card_id_1"],
  "reason": "简短原因"
}`;
  }

  async function askGPTPlay(roomId, botId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return null;
    const state = room.gameState;
    const botPlayer = state.players.find(p => p.id === botId);
    if (!botPlayer) return null;
    const prompt = buildGamePrompt(state, botPlayer);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: 'user', content: prompt }],
          temperature: 0.7, max_tokens: 300 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || '';
      return raw;
    } catch { return null; }
  }

  function parseBotDecision(raw, botPlayer, state) {
    if (!raw) return null;
    try {
      let json = raw;
      const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) json = codeBlockMatch[1];
      const obj = JSON.parse(json);
      if (obj.action === 'pass') return [];
      if (!Array.isArray(obj.cardIds) || obj.cardIds.length === 0) return null;
      const cards = botPlayer.hand.filter(c => obj.cardIds.includes(c.id));
      if (cards.length === 0) return null;
      const lastPlay = state.lastActivePlay;
      const isFirst = !lastPlay;
      const validation = validatePlay(cards, botPlayer, lastPlay, isFirst);
      if (!validation.valid) return null;
      if (!isFirst && !canBeat(cards, lastPlay.cards)) return null;
      return cards;
    } catch { return null; }
  }

  function getFallbackDecision(state, botPlayer) {
    const lastPlay = state.lastActivePlay;
    const hand = sortHand(botPlayer.hand || []);
    if (!lastPlay) {
      if (hand.length > 0) {
        const nonBomb = hand.filter(c => {
          const sameRank = hand.filter(h => h.rank === c.rank);
          return sameRank.length < 4;
        });
        const toPlay = nonBomb.length > 0 ? [nonBomb[0]] : [hand[0]];
        return toPlay;
      }
      return [];
    }
    const beatable = hand.filter(c => cardValue(c) > cardValue(lastPlay.cards[0]));
    if (beatable.length > 0) {
      const nonBomb = beatable.filter(c => {
        const sameRank = hand.filter(h => h.rank === c.rank);
        return sameRank.length < 4;
      });
      return nonBomb.length > 0 ? [nonBomb[0]] : [beatable[0]];
    }
    return [];
  }

  // ==================== Bot 调度 ====================
  const botTasks = new Map();
  function clearBotTask(botId) { if (botTasks.has(botId)) { clearTimeout(botTasks.get(botId)); botTasks.delete(botId); } }
  function clearAllBotTasks() { botTasks.forEach(t => clearTimeout(t)); botTasks.clear(); }

  async function executeBotTurn(botId, roomId, io) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState || room.status !== 'playing') return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== botId) return;
    const botPlayer = currentPlayer;
    clearBotTask(botId);
    await new Promise(r => setTimeout(r, BOT_THINK_TIME));
    let cards = null;
    if (OPENAI_API_KEY) {
      const raw = await askGPTPlay(roomId, botId);
      cards = parseBotDecision(raw, botPlayer, state);
    }
    if (!cards) cards = getFallbackDecision(state, botPlayer);
    if (cards && cards.length > 0) {
      cards.forEach(c => {
        const idx = botPlayer.hand.findIndex(h => h.id === c.id);
        if (idx >= 0) botPlayer.hand.splice(idx, 1);
      });
      state.lastActivePlay = { cards, playerId: botId, playerName: botPlayer.name };
      state.lastPlayPlayerId = botId;
      state.playHistory.push({ playerId: botId, playerName: botPlayer.name, play: state.lastActivePlay, timestamp: Date.now() });
      if (botPlayer.hand.length === 0) {
        botPlayer.status = 'finished';
        state.finishedPlayers.push({ playerId: botId, playerName: botPlayer.name, handSize: 0 });
        state.lastFinishedPlayer = { playerId: botId, playerName: botPlayer.name };
      }
    } else {
      state.lastActivePlay = null;
      state.lastPlayPlayerId = null;
    }
    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    let found = false;
    for (let i = 0; i < state.players.length; i++) {
      const idx = (nextIdx + i) % state.players.length;
      if (state.players[idx].status !== 'finished') { state.currentPlayerIndex = idx; found = true; break; }
    }
    if (!found) {
      const red3Players = state.players.filter(p => p.camp === 'red3' && p.status !== 'finished');
      const trioPlayers = state.players.filter(p => p.camp === 'trio' && p.status !== 'finished');
      if (red3Players.length === 0) state.gameState.result = '三人阵营胜利！';
      else if (trioPlayers.length === 0) state.gameState.result = '红三阵营胜利！';
      else state.gameState.result = '平局？';
      room.status = 'finished';
    }
    state.round++;
    state.turnDeadline = Date.now() + TURN_TIMEOUT;
    broadcastGameState(roomId, io);
    if (room.status === 'playing') setTimeout(() => scheduleBotIfNeeded(roomId, io), 500);
  }

  function scheduleBotIfNeeded(roomId, io) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState || room.status !== 'playing') return;
    const state = room.gameState;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer) return;
    if (!currentPlayer.id.startsWith('bot_')) return;
    const delay = TURN_TIMEOUT - 2000;
    const taskId = setTimeout(() => executeBotTurn(currentPlayer.id, roomId, io), delay);
    botTasks.set(currentPlayer.id, taskId);
  }

  function makeBot(id, name) {
    return { id, name, hand: [], status: 'waiting', isHolding_diamond3: false,
      isHolding_heart3: false, isHolding_black3: false, isHolding_heart5: false,
      isRevealed: false, revealStatus: 'none', camp: null };
  }

  // ==================== Socket.IO 事件 ====================
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentPlayerName = '玩家';

    socket.on('set_name', (name) => { if (name) currentPlayerName = String(name).slice(0, 30); });

    socket.on('create_room', (cb) => {
      if (currentRoomId) { cb({ success: false, error: '已在房间中' }); return; }
      const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
      const player = makePlayer(socket.id, currentPlayerName);
      const room = { id: roomId, hostId: socket.id, status: 'waiting', players: [player] };
      rooms.set(roomId, room);
      currentRoomId = roomId;
      socket.join(roomId);
      cb({ success: true, roomId });
    });

    socket.on('join_room', (roomId, cb) => {
      const id = String(roomId || '').toUpperCase();
      const room = rooms.get(id);
      if (!room) { cb({ success: false, error: '房间不存在' }); return; }
      if (room.status !== 'waiting') { cb({ success: false, error: '游戏已开始' }); return; }
      if (room.players.length >= 5) { cb({ success: false, error: '房间已满' }); return; }
      if (room.players.some(p => p.id === socket.id)) { cb({ success: true, room: sanitizeRoom(room), alreadyIn: true }); return; }
      room.players.push(makePlayer(socket.id, currentPlayerName));
      currentRoomId = id;
      socket.join(id);
      cb({ success: true, room: sanitizeRoom(room) });
    });

    socket.on('start_game', (cb) => {
      const room = rooms.get(currentRoomId);
      if (!room) { cb({ success: false, error: '不在房间' }); return; }
      if (room.hostId !== socket.id) { cb({ success: false, error: '只有房主可以开始' }); return; }
      // 自动补位机器人
      const botsToAdd = 5 - room.players.length;
      if (botsToAdd > 0) {
        for (let i = 0; i < botsToAdd; i++) {
          const botName = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? Math.floor(i / BOT_NAMES.length) : '');
          room.players.push(makeBot('bot_' + Math.random().toString(36).slice(2, 10), botName));
        }
        broadcastRoom(currentRoomId, io);
      }
      if (room.players.length < 2) { cb({ success: false, error: `至少需要2人` }); return; }
      const deck = shuffle(createDeck());
      const hands = dealCards(room.players.length, deck);
      room.players.forEach((player, i) => {
        player.hand = sortHand(hands[i]);
        player.status = 'playing';
        player.isHolding_diamond3 = hands[i].some(c => c.suit === 'diamonds' && c.rank === '3');
        player.isHolding_heart3 = hands[i].some(c => c.suit === 'hearts' && c.rank === '3');
        player.isHolding_black3 = hands[i].some(c => c.rank === '3' && (c.suit === 'spades' || c.suit === 'clubs'));
        player.isHolding_heart5 = hands[i].some(c => c.suit === 'hearts' && c.rank === '5');
        player.camp = (player.isHolding_diamond3 || player.isHolding_heart5) ? 'red3' : 'trio';
        if (player.isHolding_diamond3) player.revealStatus = 'revealed';
      });
      let startIdx = room.players.findIndex(p => p.hand.some(c => c.suit === 'hearts' && c.rank === '5'));
      if (startIdx < 0) startIdx = Math.floor(Math.random() * room.players.length);
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
      setTimeout(() => scheduleBotIfNeeded(currentRoomId, io), 1000);
    });

    socket.on('play_cards', (cardIds, cb) => {
      const room = rooms.get(currentRoomId);
      if (!room || !room.gameState || room.status !== 'playing') { cb({ success: false, error: '游戏未开始' }); return; }
      const state = room.gameState;
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer || currentPlayer.id !== socket.id) { cb({ success: false, error: '还没轮到你' }); return; }
      const cards = (cardIds || []).map(cid => currentPlayer.hand.find(c => c.id === cid)).filter(Boolean);
      const lastPlay = state.lastActivePlay;
      const isFirst = !lastPlay;
      const validation = validatePlay(cards, currentPlayer, lastPlay, isFirst);
      if (!validation.valid) { cb({ success: false, error: validation.reason || '无效出牌' }); return; }
      if (!isFirst && !canBeat(cards, lastPlay.cards)) { cb({ success: false, error: '管不住' }); return; }
      cards.forEach(c => { const idx = currentPlayer.hand.findIndex(h => h.id === c.id); if (idx >= 0) currentPlayer.hand.splice(idx, 1); });
      state.lastActivePlay = { cards, playerId: socket.id, playerName: currentPlayer.name };
      state.lastPlayPlayerId = socket.id;
      state.playHistory.push({ playerId: socket.id, playerName: currentPlayer.name, play: state.lastActivePlay, timestamp: Date.now() });
      if (currentPlayer.hand.length === 0) { currentPlayer.status = 'finished'; state.finishedPlayers.push({ playerId: socket.id, playerName: currentPlayer.name }); state.lastFinishedPlayer = { playerId: socket.id, playerName: currentPlayer.name }; }
      let nextIdx = (state.currentPlayerIndex + 1) % state.players.length, found = false;
      for (let i = 0; i < state.players.length; i++) { const idx = (nextIdx + i) % state.players.length; if (state.players[idx].status !== 'finished') { state.currentPlayerIndex = idx; found = true; break; } }
      if (!found) {
        const red3 = state.players.filter(p => p.camp === 'red3' && p.status !== 'finished');
        const trio = state.players.filter(p => p.camp === 'trio' && p.status !== 'finished');
        state.result = red3.length === 0 ? '三人阵营胜利！' : trio.length === 0 ? '红三阵营胜利！' : '游戏结束';
        room.status = 'finished';
      }
      state.round++;
      state.turnDeadline = Date.now() + TURN_TIMEOUT;
      broadcastGameState(currentRoomId, io);
      cb({ success: true });
      if (room.status === 'playing') setTimeout(() => scheduleBotIfNeeded(currentRoomId, io), 500);
    });

    socket.on('pass', (cb) => {
      const room = rooms.get(currentRoomId);
      if (!room || !room.gameState || room.status !== 'playing') { cb?.({ success: false, error: '游戏未开始' }); return; }
      const state = room.gameState;
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer || currentPlayer.id !== socket.id) { cb?.({ success: false, error: '还没轮到你' }); return; }
      if (!state.lastActivePlay) { cb?.({ success: false, error: '必须出牌' }); return; }
      state.lastActivePlay = null;
      state.lastPlayPlayerId = null;
      let nextIdx = (state.currentPlayerIndex + 1) % state.players.length, found = false;
      for (let i = 0; i < state.players.length; i++) { const idx = (nextIdx + i) % state.players.length; if (state.players[idx].status !== 'finished') { state.currentPlayerIndex = idx; found = true; break; } }
      if (!found) {
        const red3 = state.players.filter(p => p.camp === 'red3' && p.status !== 'finished');
        const trio = state.players.filter(p => p.camp === 'trio' && p.status !== 'finished');
        state.result = red3.length === 0 ? '三人阵营胜利！' : trio.length === 0 ? '红三阵营胜利！' : '游戏结束';
        room.status = 'finished';
      }
      state.round++;
      state.turnDeadline = Date.now() + TURN_TIMEOUT;
      broadcastGameState(currentRoomId, io);
      cb?.({ success: true });
      if (room.status === 'playing') setTimeout(() => scheduleBotIfNeeded(currentRoomId, io), 500);
    });

    socket.on('get_rooms', (cb) => { cb({ rooms: Array.from(rooms.values()).filter(r => r.status === 'waiting').map(sanitizeRoom) }); });

    socket.on('disconnect', () => {
      clearAllBotTasks();
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) { rooms.delete(currentRoomId); return; }
        if (room.hostId === socket.id) room.hostId = room.players[0].id;
        if (room.status === 'waiting') broadcastRoom(currentRoomId, io);
      }
    });
  });

  // ==================== HTTP 接口 ====================
  server.all('*', (req, res) => {
    const urlObj = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && urlObj.pathname === '/api/test/add-bots') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.once('end', () => {
        try {
          const data = JSON.parse(body);
          const room = rooms.get(String(data.roomId || '').toUpperCase());
          if (!room) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '房间不存在' })); return; }
          let joined = 0;
          (data.botNames || []).forEach((name) => {
            room.players.push(makeBot('bot_' + Math.random().toString(36).slice(2, 10), String(name).slice(0, 30)));
            joined++;
          });
          io.to(room.id).emit('room_updated', sanitizeRoom(room));
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, joined, playerCount: room.players.length }));
        } catch { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '解析失败' })); }
      });
      return;
    }
    return handle(req, res);
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
