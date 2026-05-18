'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameStateView, GameResult } from '@/lib/rules/types';

let globalSocket: Socket | null = null;

export function useSocket(): { socket: Socket | null; connected: boolean } {
  const [connected, setConnected] = useState(false);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);

  useEffect(() => {
    if (globalSocket?.connected) {
      setSocketInstance(globalSocket);
      setConnected(true);
      return;
    }

    const socketUrl = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin)
      : 'http://localhost:3000';

    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    globalSocket = socket;
    setSocketInstance(socket);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      // 保持全局连接不断开（供其他组件复用）
    };
  }, []);

  return { socket: socketInstance, connected };
}

export function useGameSocket(roomId: string | null) {
  const { socket, connected } = useSocket();
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [gameOver, setGameOver] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 优先从 sessionStorage 读取（房间页面跳转时已缓存）
  useEffect(() => {
    const cached = sessionStorage.getItem('pendingGameState');
    if (cached) {
      try {
        const state = JSON.parse(cached) as GameStateView;
        setGameState(state);
        sessionStorage.removeItem('pendingGameState');
      } catch {}
    }
  }, []);

  // 进入游戏页时主动 join_room，同步状态
  useEffect(() => {
    if (!socket || !roomId) return;

    // 监听 join_room 返回的游戏状态（游戏已开始时 server 会附带返回）
    const onJoinRoomResult = (res: { success: boolean; gameState?: GameStateView; error?: string }) => {
      if (res.success && res.gameState) {
        setGameState(res.gameState);
        setError(null);
      }
    };
    socket.on('join_room_result', onJoinRoomResult);

    // 主动加入房间（安全网：防止 game_state 事件漏接）
    socket.emit('join_room', roomId, (res: { success: boolean; gameState?: GameStateView; error?: string }) => {
      if (res.success && res.gameState) {
        setGameState(res.gameState);
        setError(null);
      }
      if (!res.success && res.error) {
        setError(res.error);
      }
    });

    return () => {
      socket.off('join_room_result', onJoinRoomResult);
    };
  }, [socket, roomId]);

  // 注册游戏事件监听
  useEffect(() => {
    if (!socket) return;

    const onGameState = (state: GameStateView) => {
      setGameState(state);
      setError(null);
    };

    const onGameOver = (result: GameResult) => {
      setGameOver(result);
    };

    socket.on('game_state', onGameState);
    socket.on('game_over', onGameOver);

    return () => {
      socket.off('game_state', onGameState);
      socket.off('game_over', onGameOver);
    };
  }, [socket]);

  // 超时检查
  useEffect(() => {
    if (!socket || !gameState || gameState.status !== 'playing') return;

    const interval = setInterval(() => {
      socket.emit('check_timeout');
    }, 3000);

    return () => clearInterval(interval);
  }, [socket, gameState]);

  const playCards = useCallback((cardIds: string[]) => {
    if (!socket) return;
    socket.emit('play_cards', cardIds, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '出牌失败');
    });
  }, [socket]);

  const pass = useCallback(() => {
    if (!socket) return;
    socket.emit('pass', (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '跳过失败');
    });
  }, [socket]);

  const windDecision = useCallback((giveWind: boolean) => {
    if (!socket) return;
    socket.emit('wind_decision', giveWind, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '给风决策失败');
    });
  }, [socket]);

  const revealIdentity = useCallback(() => {
    if (!socket) return;
    socket.emit('reveal_identity', (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '亮身份失败');
    });
  }, [socket]);

  return {
    gameState,
    gameOver,
    error,
    connected,
    playCards,
    pass,
    windDecision,
    revealIdentity,
    clearError: () => setError(null),
  };
}
