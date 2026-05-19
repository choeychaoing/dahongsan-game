/**
 * 全局单例 Socket 管理器
 * 所有页面/组件都应通过此模块获取 socket，确保 socket.id 全程一致
 */
import { io, Socket } from 'socket.io-client';

let _socket: Socket | null = null;

export function getGlobalSocket(): Socket {
  if (_socket) return _socket;

  const url = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin)
    : 'http://localhost:3000';

  _socket = io(url, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  return _socket;
}

/** 当前 socket.id（连接建立前可能为 undefined） */
export function getMySocketId(): string | undefined {
  return _socket?.id;
}
