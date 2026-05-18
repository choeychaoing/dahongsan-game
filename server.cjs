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

// ─── AI 机器人配置 ────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const BOT_THINK_TIME = parseInt(process.env.BOT_THINK_TIME || '1000', 10); // 机器人思考延迟（毫秒）
const botTasks = new Map(); // botId -> { roomId, timer }

function clearBotTask(botId) {
  const task = botTasks.get(botId);
  if (task) { clearTimeout(task.timer); botTasks.delete(botId); }
}

function clearAllBotTasks(roomId) {
  botTasks.forEach((task, botId) => {
    if (task.roomId === roomId) { clearTimeout(task.timer); botTasks.delete(botId); }
  });
}

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

// ─── 机器人相关 ───────────────────────────────────────────────
const BOT_NAMES = [
  '枫叶', '星辰', '云淡', '清风', '明月', '流云', '寒霜', '暖阳',
  '墨竹', '青莲', '紫霞', '秋水', '长歌', '孤影', '天涯', '归途',
  '晨曦', '暮雨', '星河', '沧海', '白鹭', '飞鸿', '落英', '幽兰',
];

function makeBot(name) {
  const botName = name || BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + '·AI';
  return makePlayer('bot_' + Math.random().toString(36).slice(2, 10), botName);
}

function fillBotsIfNeeded(room) {
  if (!room || room.players.length >= 5) return 0;
  const needed = 5 - room.players.length;
  let added = 0;
  for (let i = 0; i < needed; i++) {
    room.players.push(makeBot());
    added++;
  }
  return added;
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
    id: room.id, hostId: room.hostId, hostName: room.hostName, status: room.status,
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
// ─── GPT 出牌决策 ─────────────────────────────────────────────

const GAME_SYSTEM_PROMPT = `你是"打红三"纸牌游戏的 AI 玩家。请根据游戏局面做出最优出牌决策。

游戏规则：
- 5人游戏，分两阵营：红3阵营（持红桃3或方片3，2人） vs 三人阵营（其余3人）
- 红3阵营目标：2人先跑完；三人阵营目标：3人全跑完
- 牌型：单张(1张)、对子(2张同点数)、炸弹(3/4张同点数、或双王)
- 单张大小：5<6<7<8<9<10<J<Q<K<A<2<3<4<小王<大王
- 特殊：红桃3/方片3 作为单张时牌力=13.5（大于4，小于小王）
- 管牌规则：必须同牌型且更大；炸弹可管任意牌型
- 自由出牌时可选任意合法牌型
- 给风规则：某玩家出完牌后，下家可选择"给风"（放弃管牌权，让再下家出牌）或"不给风"（保留管牌权）

策略建议：
- 优先跑完自己的牌，小牌优先出
- 有牌要管时，如果牌力差距不大可以管，差距大则 pass 保留实力
- 炸弹是强力牌，关键时刻使用
- 注意阵营配合，帮助队友跑牌`;

function formatCards(cards) {
  return cards.map(c => `${c.display}(${c.id})`).join('、');
}

function formatPlay(play) {
  if (!play) return '无';
  const typeMap = { single: '单张', pair: '对子', bomb: '炸弹' };
  return `${typeMap[play.type] || play.type} ${formatCards(play.cards)} (power:${play.power})`;
}

function buildGamePrompt(state, botPlayer) {
  const others = state.players.filter(p => p.id !== botPlayer.id).map(p => {
    const campInfo = p.revealStatus === 'revealed' ? `[${p.camp === 'red3' ? '红3' : '三人'}]` : '[?]';
    const statusInfo = p.status === 'finished' ? `已跑完(第${p.finishRank}名)` : `剩${p.hand.length}张`;
    return `- ${p.name} ${campInfo} ${statusInfo}`;
  }).join('\n');

  const history = state.playHistory.slice(-15).map((h, i) => {
    if (h.isPass) return `${i + 1}. ${h.playerName}: pass`;
    return `${i + 1}. ${h.playerName}: ${formatPlay(h.play)}`;
  }).join('\n') || '无';

  const handSorted = [...botPlayer.hand].sort((a, b) => (buildPlay([a])?.power ?? 0) - (buildPlay([b])?.power ?? 0));

  return `【你的身份】
- 玩家名：${botPlayer.name}
- 手牌（共${botPlayer.hand.length}张，已按牌力从小到大排序）：
${handSorted.map((c, i) => `  ${i + 1}. ${c.display} (${c.id}) power=${buildPlay([c])?.power ?? 0}`).join('\n')}
- 阵营：${botPlayer.camp === 'red3' ? '红3阵营' : '三人阵营'}（${botPlayer.revealStatus === 'revealed' ? '已亮明' : '未亮明'}）

【桌面状态】
- 需要管的牌：${formatPlay(state.lastActivePlay)}
- 最后出牌者：${state.lastPlayPlayerId ? state.players.find(p => p.id === state.lastPlayPlayerId)?.name || '?' : '无'}
- 当前轮次：第${state.round}轮

【出牌历史】(最近15条)
${history}

【其他玩家】
${others}

请输出你的决策（严格 JSON 格式，不要包含 markdown 代码块）：
{
  "action": "play" | "pass",
  "cardIds": ["card_id_1", "card_id_2"],
  "reason": "简短说明"
}

注意：
- action="play" 时必须提供 cardIds（1-4张，对应单张/对子/炸弹）
- action="pass" 时 cardIds 为空数组 []
- 必须确保 cardIds 中的牌都在你的手牌中
- 如果要管牌，必须出同类型且更大的牌，或者用炸弹`;
}

async function askGPTPlay(roomId, botId) {
  const room = rooms.get(roomId);
  if (!room?.gameState) return null;
  const state = room.gameState;
  const botPlayer = state.players.find(p => p.id === botId);
  if (!botPlayer) return null;

  if (!OPENAI_API_KEY) {
    console.log('[GPT] 未配置 API Key，使用降级策略');
    return getFallbackDecision(state, botPlayer);
  }

  const prompt = buildGamePrompt(state, botPlayer);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5秒超时

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: GAME_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[GPT] API 错误 ${response.status}:`, errText);
      return getFallbackDecision(state, botPlayer);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[GPT] 空响应');
      return getFallbackDecision(state, botPlayer);
    }

    return parseBotDecision(content, botPlayer, state);
  } catch (err) {
    console.error('[GPT] 请求失败:', err.message);
    return getFallbackDecision(state, botPlayer);
  }
}

function parseBotDecision(raw, botPlayer, state) {
  try {
    // 提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[GPT] 无法从响应中提取 JSON:', raw.slice(0, 200));
      return getFallbackDecision(state, botPlayer);
    }
    const decision = JSON.parse(jsonMatch[0]);

    if (decision.action === 'pass') {
      return { action: 'pass', cardIds: [], reason: decision.reason || 'GPT 选择 pass' };
    }

    if (decision.action === 'play' && Array.isArray(decision.cardIds) && decision.cardIds.length > 0) {
      const cards = botPlayer.hand.filter(c => decision.cardIds.includes(c.id));
      if (cards.length !== decision.cardIds.length) {
        console.error('[GPT] 包含不在手牌中的牌');
        return getFallbackDecision(state, botPlayer);
      }
      const v = validatePlay(cards, botPlayer.hand, state.lastActivePlay);
      if (!v.valid) {
        console.error('[GPT] 非法出牌:', v.reason);
        return getFallbackDecision(state, botPlayer);
      }
      return { action: 'play', cardIds: decision.cardIds, reason: decision.reason || 'GPT 出牌' };
    }

    return getFallbackDecision(state, botPlayer);
  } catch (err) {
    console.error('[GPT] 解析失败:', err.message);
    return getFallbackDecision(state, botPlayer);
  }
}

function getFallbackDecision(state, botPlayer) {
  const hand = botPlayer.hand;
  const lastPlay = state.lastActivePlay;

  // 1. 需要管牌
  if (lastPlay) {
    // 找能管的最小牌组合
    const candidates = [];
    // 单张
    if (lastPlay.type === 'single') {
      for (const c of hand) {
        const play = buildPlay([c]);
        if (play && canBeat(play, lastPlay)) candidates.push({ cards: [c], power: play.power });
      }
    }
    // 对子
    if (lastPlay.type === 'pair') {
      const rankGroups = {};
      for (const c of hand) { (rankGroups[c.rank] = rankGroups[c.rank] || []).push(c); }
      for (const rank in rankGroups) {
        if (rankGroups[rank].length >= 2) {
          const pair = rankGroups[rank].slice(0, 2);
          const play = buildPlay(pair);
          if (play && canBeat(play, lastPlay)) candidates.push({ cards: pair, power: play.power });
        }
      }
    }
    // 炸弹（可以管任意）
    const rankGroups = {};
    for (const c of hand) { (rankGroups[c.rank] = rankGroups[c.rank] || []).push(c); }
    for (const rank in rankGroups) {
      if (rankGroups[rank].length >= 3) {
        const bomb = rankGroups[rank].slice(0, 3);
        const play = buildPlay(bomb);
        if (play) candidates.push({ cards: bomb, power: play.power });
      }
    }
    // 双王炸弹
    const jokers = hand.filter(c => c.rank === 'small_joker' || c.rank === 'big_joker');
    if (jokers.length === 2) {
      const play = buildPlay(jokers);
      if (play) candidates.push({ cards: jokers, power: play.power });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.power - b.power);
      return { action: 'play', cardIds: candidates[0].cards.map(c => c.id), reason: '降级策略：最小能管的牌' };
    }
    return { action: 'pass', cardIds: [], reason: '降级策略：无法管牌' };
  }

  // 2. 自由出牌：优先出散张（不成对的小牌）
  const rankGroups = {};
  for (const c of hand) { (rankGroups[c.rank] = rankGroups[c.rank] || []).push(c); }
  const singles = hand.filter(c => !rankGroups[c.rank] || rankGroups[c.rank].length === 1);
  if (singles.length > 0) {
    singles.sort((a, b) => (buildPlay([a])?.power ?? 0) - (buildPlay([b])?.power ?? 0));
    return { action: 'play', cardIds: [singles[0].id], reason: '降级策略：出最小散张' };
  }

  // 3. 无散张，出最小对子
  const pairs = [];
  for (const rank in rankGroups) {
    if (rankGroups[rank].length >= 2) {
      const pair = rankGroups[rank].slice(0, 2);
      const play = buildPlay(pair);
      if (play) pairs.push({ cards: pair, power: play.power });
    }
  }
  if (pairs.length > 0) {
    pairs.sort((a, b) => a.power - b.power);
    return { action: 'play', cardIds: pairs[0].cards.map(c => c.id), reason: '降级策略：出最小对子' };
  }

  // 4. 最后手段：最小单张
  const sorted = [...hand].sort((a, b) => (buildPlay([a])?.power ?? 0) - (buildPlay([b])?.power ?? 0));
  return { action: 'play', cardIds: [sorted[0].id], reason: '降级策略：最小单张' };
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
  // 广播后检查是否需要触发 bot
  scheduleBotIfNeeded(roomId, io);
}

function scheduleBotIfNeeded(roomId, io) {
  const room = rooms.get(roomId);
  if (!room?.gameState) { console.log(`[BOT] scheduleBotIfNeeded: no room/gameState for ${roomId}`); return; }
  const state = room.gameState;
  if (state.status !== 'playing') { console.log(`[BOT] scheduleBotIfNeeded: status=${state.status}, not playing`); return; }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) { console.log(`[BOT] scheduleBotIfNeeded: no currentPlayer at idx ${state.currentPlayerIndex}`); return; }
  if (!currentPlayer.id.startsWith('bot_')) { return; } // human turn, skip

  const botId = currentPlayer.id;
  clearBotTask(botId);

  // 给风决策
  if (state.windDecision.required && state.windDecision.decisionPlayerId === botId) {
    const timer = setTimeout(() => executeBotWindDecision(botId, roomId, io), 500 + Math.random() * 500);
    botTasks.set(botId, { roomId, timer });
    return;
  }

  // 正常出牌
  const delay = BOT_THINK_TIME + Math.random() * 1000;
  const timer = setTimeout(() => executeBotTurn(botId, roomId, io), delay);
  botTasks.set(botId, { roomId, timer });
}

async function executeBotWindDecision(botId, roomId, io) {
  clearBotTask(botId);
  const room = rooms.get(roomId);
  if (!room?.gameState) return;
  const state = room.gameState;
  if (state.status !== 'playing') return;
  if (state.windDecision.decisionPlayerId !== botId) return;

  // 简单策略：如果是红3阵营且队友未跑完，给风帮助队友；否则不给风
  const botPlayer = state.players.find(p => p.id === botId);
  if (!botPlayer) return;

  let giveWind = false;
  if (botPlayer.camp === 'red3') {
    const teammate = state.players.find(p => p.camp === 'red3' && p.id !== botId);
    if (teammate && teammate.status !== 'finished') giveWind = true;
  } else {
    // trio 阵营：如果红3未亮身份，不给风（保留管牌权）
    const red3Revealed = state.players.some(p => p.camp === 'red3' && p.revealStatus === 'revealed');
    if (!red3Revealed) giveWind = false;
    else giveWind = true;
  }

  doWindDecision(roomId, botId, giveWind);
  broadcastGameState(roomId, io);
}

async function executeBotTurn(botId, roomId, io) {
  clearBotTask(botId);
  console.log(`[BOT] executeBotTurn: bot=${botId} room=${roomId}`);
  const room = rooms.get(roomId);
  if (!room?.gameState) { console.log("[BOT] room/gameState gone"); return; }
  const state = room.gameState;
  if (state.status !== 'playing') { console.log(`[BOT] status=${state.status}`); return; }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.id !== botId) { console.log("[BOT] not current player"); return; }

  console.log(`[BOT] ${currentPlayer.name} thinking...`);
  const decision = await askGPTPlay(roomId, botId);
  if (!decision) { console.log("[BOT] no decision, passing"); doPass(roomId, botId); broadcastGameState(roomId, io); return; }

  if (decision.action === 'pass') {
    console.log(`[BOT] ${currentPlayer.name} passes`);
    doPass(roomId, botId);
  } else if (decision.action === 'play') {
    console.log(`[BOT] ${currentPlayer.name} plays ${decision.cardIds.length} cards`);
    const result = doPlay(roomId, botId, decision.cardIds, io);
    if (!result.success) {
      console.error(`[BOT] ${currentPlayer.name} play failed:`, result.error);
      const fallback = getFallbackDecision(state, currentPlayer);
      if (fallback.action === 'play') doPlay(roomId, botId, fallback.cardIds, io);
      else doPass(roomId, botId);
    }
    if (result.finished) {
      io.to(roomId).emit('game_over', result.gameResult);
    }
  }

  broadcastGameState(roomId, io);
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
    const urlObj = parse(req.url || '', true);
    // 测试接口：直接注入机器人，跳过 Next.js
    if (req.method === 'POST' && urlObj.pathname === '/api/test/add-bots') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.once('end', () => {
        try {
          const data = JSON.parse(body);
          const room = rooms.get(String(data.roomId || '').toUpperCase());
          if (!room) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '房间不存在' }));
            return;
          }
          let joined = 0;
          (data.botNames || []).forEach((name) => {
            room.players.push(makePlayer(
              'bot_' + Math.random().toString(36).slice(2, 10),
              String(name).slice(0, 30)
            ));
            joined++;
          });
          io.to(room.id).emit('room_updated', sanitizeRoom(room));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, joined, playerCount: room.players.length }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '解析失败' }));
        }
      });
      return;
    }
    // 正常请求走 Next.js
    handle(req, res, urlObj);
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
      if (typeof name === 'string' && name.trim()) playerName = name.trim().slice(0, 30);
    });

    socket.on('create_room', (cb) => {
      const room = {
        id: Math.random().toString(36).slice(2, 8).toUpperCase(),
        hostId: socket.id,
        hostName: playerName,
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
      // 检查是否已有同名玩家（同一浏览器不同标签页）
      const existingByName = room.players.find(p => p.name === playerName);
      if (existingByName) {
        // 同名玩家：更新 socket id（视为同一人重连），不新增
        existingByName.id = socket.id;
        // 如果断线前是房主，更新房主
        if (room.hostName === playerName) room.hostId = socket.id;
      } else if (room.players.length >= 5) {
        cb({ success: false, error: '房间已满' }); return;
      } else {
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
      // 自动补位：人数不足时自动加入机器人
      if (room.players.length < 5) {
        const added = fillBotsIfNeeded(room);
        if (added > 0) {
          console.log(`[BOT] 房间 ${room.id} 自动补位 ${added} 个机器人`);
          io.to(room.id).emit('room_updated', sanitizeRoom(room));
        }
      }
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
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            room.hostName = room.players[0].name;
          }
          socket.to(currentRoomId).emit('room_updated', sanitizeRoom(room));
        }
      }
      // 游戏中断线：如果是真人玩家，可以替换为 bot 继续游戏
      if (room && room.status === 'playing') {
        const player = room.players.find(p => p.id === socket.id);
        if (player && !player.id.startsWith('bot_')) {
          // 将断线玩家替换为 bot
          const bot = makeBot(player.name + '·离线');
          bot.hand = player.hand;
          bot.status = player.status;
          bot.camp = player.camp;
          bot.revealStatus = player.revealStatus;
          bot.finishRank = player.finishRank;
          bot.isHolding_diamond3 = player.isHolding_diamond3;
          bot.isHolding_heart3 = player.isHolding_heart3;
          bot.isHolding_black3 = player.isHolding_black3;
          const idx = room.players.findIndex(p => p.id === socket.id);
          if (idx >= 0) room.players[idx] = bot;
          // 如果当前轮到该玩家，触发 bot 出牌
          if (room.gameState.currentPlayerIndex === idx) {
            scheduleBotIfNeeded(currentRoomId, io);
          }
          console.log(`[BOT] 玩家 ${player.name} 断线，已替换为机器人 ${bot.name}`);
        }
      }
    });
  });

  // 4. 启动监听
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Game server running on 0.0.0.0:${PORT}`);
    console.log(`[SERVER] BOT_THINK_TIME=${BOT_THINK_TIME}ms, API_TIMEOUT=5000ms`);
    console.log(`[SERVER] OPENAI_API_KEY: ${OPENAI_API_KEY ? 'configured' : 'NOT_SET (fallback)'}`);
  });
}

main().catch(err => {
  console.error('[SERVER] FAILED TO START:', err.message);
  process.exit(1);
});
