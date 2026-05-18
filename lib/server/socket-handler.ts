// ============================================================
// Socket.IO 服务端路由 (Next.js App Router API Route)
// ============================================================
import { Server as SocketIOServer } from 'socket.io';
import { NextRequest } from 'next/server';
import {
  createRoom, joinRoom, leaveRoom, getRoom, getAllRooms,
  startGame, handlePlay, handlePass, handleWindDecision,
  handleReveal, handleTimeout,
} from '@/lib/server/game-manager';
import { GameStateView, PlayerView, Player } from '@/lib/rules/types';

// Next.js App Router 不直接支持 socket.io，需要用 custom server
// 这里导出 setupSocketIO 供 server.ts 调用

let io: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return io;
}

/** 构建客户端可见的游戏状态视图 */
function buildGameStateView(roomId: string, viewerId: string): GameStateView | null {
  const room = getRoom(roomId);
  if (!room || !room.gameState) return null;

  const state = room.gameState;

  const playerViews: PlayerView[] = state.players.map((p, idx) => ({
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    status: p.status,
    camp: p.revealStatus === 'revealed' ? p.camp : null,
    revealStatus: p.revealStatus,
    finishRank: p.finishRank,
    isCurrentPlayer: idx === state.currentPlayerIndex,
  }));

  const myPlayer = state.players.find(p => p.id === viewerId);

  return {
    roomId,
    status: state.status,
    players: playerViews,
    myHand: myPlayer?.hand ?? [],
    currentPlayerId: state.players[state.currentPlayerIndex]?.id ?? null,
    lastActivePlay: state.lastActivePlay,
    lastPlayPlayerId: state.lastPlayPlayerId,
    windDecision: state.windDecision,
    playHistory: state.playHistory.slice(-20), // 最近20条
    round: state.round,
    turnDeadline: state.turnDeadline,
    result: state.result,
  };
}

export function setupSocketIO(httpServer: import('http').Server): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/api/socket',
  });

  // 超时检查（每5秒）
  setInterval(() => {
    if (!io) return;
    // 遍历所有活跃房间，检查超时
    // 这里用简化方式：通过 io.sockets.adapter.rooms 获取活跃房间
    // 实际应维护一个活跃房间Map
  }, 5000);

  io.on('connection', (socket) => {
    console.log(`[Socket] 连接: ${socket.id}`);

    let currentRoomId: string | null = null;
    let currentPlayerId: string = socket.id;
    let currentPlayerName: string = '玩家' + socket.id.slice(0, 4);

    // ── 设置昵称 ──
    socket.on('set_name', (name: string) => {
      if (typeof name === 'string' && name.trim()) {
        currentPlayerName = name.trim().slice(0, 12);
      }
    });

    // ── 创建房间 ──
    socket.on('create_room', (callback: (data: unknown) => void) => {
      const room = createRoom(currentPlayerId, currentPlayerName);
      currentRoomId = room.id;
      socket.join(room.id);
      callback({ success: true, roomId: room.id, room: sanitizeRoom(room) });
    });

    // ── 加入房间 ──
    socket.on('join_room', (roomId: string, callback: (data: unknown) => void) => {
      const result = joinRoom(roomId, currentPlayerId, currentPlayerName);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      currentRoomId = roomId;
      socket.join(roomId);
      const room = result.room!;
      // 通知房间内其他人
      socket.to(roomId).emit('room_updated', sanitizeRoom(room));
      callback({ success: true, room: sanitizeRoom(room) });
    });

    // ── 获取房间列表 ──
    socket.on('get_rooms', (callback: (data: unknown) => void) => {
      callback({ rooms: getAllRooms().map(sanitizeRoom) });
    });

    // ── 开始游戏 ──
    socket.on('start_game', (callback: (data: unknown) => void) => {
      if (!currentRoomId) {
        callback({ success: false, error: '你不在任何房间' });
        return;
      }
      const room = getRoom(currentRoomId);
      if (!room || room.hostId !== currentPlayerId) {
        callback({ success: false, error: '只有房主可以开始游戏' });
        return;
      }
      const result = startGame(currentRoomId);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      // 向每个玩家单独发送状态（含各自手牌）
      broadcastGameState(currentRoomId);
      callback({ success: true });
    });

    // ── 出牌 ──
    socket.on('play_cards', (cardIds: string[], callback: (data: unknown) => void) => {
      if (!currentRoomId) {
        callback({ success: false, error: '你不在任何房间' });
        return;
      }
      const result = handlePlay(currentRoomId, currentPlayerId, cardIds);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      broadcastGameState(currentRoomId);
      callback({ success: true });
      if (result.finished) {
        io?.to(currentRoomId).emit('game_over', result.state?.result);
      }
    });

    // ── 跳过 ──
    socket.on('pass', (callback: (data: unknown) => void) => {
      if (!currentRoomId) {
        callback({ success: false, error: '你不在任何房间' });
        return;
      }
      const result = handlePass(currentRoomId, currentPlayerId);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      broadcastGameState(currentRoomId);
      callback({ success: true });
    });

    // ── 给风决策 ──
    socket.on('wind_decision', (giveWind: boolean, callback: (data: unknown) => void) => {
      if (!currentRoomId) {
        callback({ success: false, error: '你不在任何房间' });
        return;
      }
      const result = handleWindDecision(currentRoomId, currentPlayerId, giveWind);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      broadcastGameState(currentRoomId);
      callback({ success: true });
    });

    // ── 亮身份 ──
    socket.on('reveal_identity', (callback: (data: unknown) => void) => {
      if (!currentRoomId) {
        callback({ success: false, error: '你不在任何房间' });
        return;
      }
      const result = handleReveal(currentRoomId, currentPlayerId);
      if (!result.success) {
        callback({ success: false, error: result.error });
        return;
      }
      broadcastGameState(currentRoomId);
      callback({ success: true });
    });

    // ── 断线 ──
    socket.on('disconnect', () => {
      console.log(`[Socket] 断线: ${socket.id}`);
      if (currentRoomId) {
        leaveRoom(currentRoomId, currentPlayerId);
        const room = getRoom(currentRoomId);
        if (room) {
          socket.to(currentRoomId).emit('room_updated', sanitizeRoom(room));
        }
      }
    });

    // ── 超时检查（客户端上报） ──
    socket.on('check_timeout', () => {
      if (!currentRoomId) return;
      const room = getRoom(currentRoomId);
      if (!room?.gameState) return;
      const state = room.gameState;
      if (state.turnDeadline && Date.now() > state.turnDeadline) {
        const result = handleTimeout(currentRoomId);
        if (result.success) {
          broadcastGameState(currentRoomId);
          if (result.finished) {
            io?.to(currentRoomId).emit('game_over', result.state?.result);
          }
        }
      }
    });
  });

  return io;
}

/** 向房间内每位玩家单独广播含各自手牌的状态 */
function broadcastGameState(roomId: string): void {
  if (!io) return;
  const room = getRoom(roomId);
  if (!room?.gameState) return;

  room.gameState.players.forEach((player) => {
    const view = buildGameStateView(roomId, player.id);
    if (!view) return;
    // 找到对应 socket
    const sockets = io!.sockets.sockets;
    sockets.forEach((s) => {
      // socket.id 等于 playerId（我们用 socket.id 作为 playerId）
      if (s.id === player.id) {
        s.emit('game_state', view);
      }
    });
  });

  // 也发全局（不含手牌的公共状态，用于观战等）
  // 这里省略，只做个人推送
}

/** 清理房间对象（不暴露手牌） */
function sanitizeRoom(room: ReturnType<typeof getRoom>) {
  if (!room) return null;
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    playerCount: room.players.length,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
    })),
  };
}
