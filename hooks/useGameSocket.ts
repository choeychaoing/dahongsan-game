'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameStateView, GameResult } from '@/lib/rules/types';

let globalSocket: Socket | null = null;

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (globalSocket?.connected) {
      socketRef.current = globalSocket;
      setConnected(true);
      return;
    }

    // Socket.IO 连接 URL（同域名同端口，兼容 Zeabur 部署）
    const socketUrl = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin)
      : 'http://localhost:3000';

    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    globalSocket = socket;
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      // 不在组件卸载时断开（保持全局连接）
    };
  }, []);

  return { socket: socketRef.current, connected };
}

export function useGameSocket(roomId: string | null) {
  const { socket, connected } = useSocket();
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [gameOver, setGameOver] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    socket?.emit('play_cards', cardIds, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '出牌失败');
    });
  }, [socket]);

  const pass = useCallback(() => {
    socket?.emit('pass', (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '跳过失败');
    });
  }, [socket]);

  const windDecision = useCallback((giveWind: boolean) => {
    socket?.emit('wind_decision', giveWind, (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '给风决策失败');
    });
  }, [socket]);

  const revealIdentity = useCallback(() => {
    socket?.emit('reveal_identity', (res: { success: boolean; error?: string }) => {
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
