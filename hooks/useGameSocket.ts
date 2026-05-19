'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { GameStateView, GameResult, Card } from '@/lib/rules/types';
import { getGlobalSocket } from '@/lib/socket';
import { Socket } from 'socket.io-client';

export function useSocket(): { socket: Socket | null; connected: boolean } {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getGlobalSocket();
    socketRef.current = s;

    if (s.connected) {
      setConnected(true);
    }

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);

  return { socket: socketRef.current ?? (typeof window !== 'undefined' ? getGlobalSocket() : null), connected };
}

export function useGameSocket(roomId: string | null) {
  const { socket, connected } = useSocket();
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [gameOver, setGameOver] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // myId 始终跟着 socket.id 走
  const [myId, setMyId] = useState<string>('');
  // 保存上一次的手牌，防止 socket 事件覆盖时手牌消失
  const lastHandRef = useRef<Card[]>([]);

  // 从 sessionStorage 读取初始 gameState（room 页面跳转时存入）
  useEffect(() => {
    const cached = sessionStorage.getItem('pendingGameState');
    if (cached) {
      try {
        const state = JSON.parse(cached) as GameStateView;
        if (state.myHand && state.myHand.length > 0) {
          lastHandRef.current = state.myHand;
        }
        setGameState(state);
        sessionStorage.removeItem('pendingGameState');
      } catch {}
    }
  }, []);

  // socket 连接后同步 myId，并确保 socket 的 currentRoomId 已绑定
  useEffect(() => {
    if (!socket) return;

    const syncMyId = () => {
      if (socket.id) {
        setMyId(socket.id);
        // 同时更新 sessionStorage，供 GameTable fallback 使用
        sessionStorage.setItem('mySocketId', socket.id);
      }
    };

    // 如果已连接直接同步
    if (socket.connected && socket.id) {
      syncMyId();
    }

    socket.on('connect', syncMyId);
    return () => { socket.off('connect', syncMyId); };
  }, [socket]);

  // 注册游戏事件监听（不主动 join_room，room 页面已经处理过了）
  useEffect(() => {
    if (!socket) return;

    const onGameState = (state: GameStateView) => {
      // 防御：如果新手牌为空但 ref 有手牌，且玩家还在游戏中，保留旧手牌
      const me = state.players.find(p => p.id === myId || p.id === socket?.id);
      if (state.myHand.length === 0 && lastHandRef.current.length > 0 && me?.status === 'playing') {
        setGameState({ ...state, myHand: lastHandRef.current });
        return;
      }
      // 更新 ref 中的手牌
      if (state.myHand.length > 0) {
        lastHandRef.current = state.myHand;
      }
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
    myId,
    playCards,
    pass,
    windDecision,
    revealIdentity,
    clearError: () => setError(null),
  };
}
