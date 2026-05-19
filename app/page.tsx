'use client';
import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { getGlobalSocket } from '@/lib/socket';

interface RoomInfo {
  id: string;
  hostId: string;
  status: string;
  playerCount: number;
  players: Array<{ id: string; name: string }>;
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getGlobalSocket();
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      s.emit('get_rooms', (res: { rooms: RoomInfo[] }) => {
        setRooms(res.rooms);
      });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('room_updated', () => {
      s.emit('get_rooms', (res: { rooms: RoomInfo[] }) => setRooms(res.rooms));
    });

    if (s.connected) {
      setConnected(true);
      s.emit('get_rooms', (res: { rooms: RoomInfo[] }) => {
        setRooms(res.rooms);
      });
    }

    const savedName = localStorage.getItem('playerName');
    if (savedName) setName(savedName);

    return () => {
      s.off('room_updated');
    };
  }, []);

  const setPlayerName = () => {
    const n = name.trim();
    if (!n) return;
    localStorage.setItem('playerName', n);
    socketRef.current?.emit('set_name', n);
  };

  const createRoom = () => {
    if (!name.trim()) {
      setError('请先输入昵称');
      return;
    }
    setPlayerName();
    socketRef.current?.emit('create_room', (res: { success: boolean; roomId?: string; error?: string }) => {
      if (res.success && res.roomId) {
        sessionStorage.setItem('mySocketId', socketRef.current!.id!);
        router.push(`/room/${res.roomId}`);
      } else {
        setError(res.error ?? '创建失败');
      }
    });
  };

  const quickStart = () => {
    if (!name.trim()) {
      setError('请先输入昵称');
      return;
    }
    setPlayerName();
    socketRef.current?.emit('create_room', (res: { success: boolean; roomId?: string; error?: string }) => {
      if (res.success && res.roomId) {
        const roomId = res.roomId;
        sessionStorage.setItem('mySocketId', socketRef.current!.id!);
        socketRef.current?.emit('start_game', (startRes: { success: boolean; gameState?: unknown; error?: string }) => {
          if (startRes.success && startRes.gameState) {
            // 关键修复：保存 gameState 到 sessionStorage，供游戏页面直接读取
            sessionStorage.setItem('pendingGameState', JSON.stringify(startRes.gameState));
            // 跳转到房间页面（它会监听 game_state 并跳转到游戏）
            router.push(`/room/${roomId}`);
          } else {
            setError(startRes.error ?? '开始失败');
          }
        });
      } else {
        setError(res.error ?? '创建失败');
      }
    });
  };

  const joinRoom = (roomId?: string) => {
    const id = (roomId ?? joinRoomId).trim().toUpperCase();
    if (!id) {
      setError('请输入房间号');
      return;
    }
    if (!name.trim()) {
      setError('请先输入昵称');
      return;
    }
    setPlayerName();
    socketRef.current?.emit('join_room', id, (res: { success: boolean; error?: string }) => {
      if (res.success) {
        sessionStorage.setItem('mySocketId', socketRef.current!.id!);
        router.push(`/room/${id}`);
      } else {
        setError(res.error ?? '加入失败');
      }
    });
  };

  const refreshRooms = () => {
    socketRef.current?.emit('get_rooms', (res: { rooms: RoomInfo[] }) => setRooms(res.rooms));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-4xl font-bold text-red-600">🃏 打红三</div>
          <div className="text-gray-500 text-sm mt-1">5人在线扑克游戏</div>
          <div className={`text-xs mt-1 ${connected ? 'text-green-500' : 'text-red-400 animate-pulse'}`}>
            {connected ? '● 已连接' : '● 连接中...'}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">我的昵称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={setPlayerName}
            placeholder="输入昵称（最多30字）"
            maxLength={30}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>

        {error && (
          <div className="mb-3 text-red-500 text-sm text-center bg-red-50 rounded-lg py-2 px-3">
            {error}
          </div>
        )}

        {/* 快速开始：创建房间 + 自动补位机器人 + 直接开始 */}
        <button
          onClick={quickStart}
          className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold text-lg hover:from-purple-700 hover:to-pink-700 active:scale-95 transition mb-3 shadow-lg"
        >
          🚀 快速开始（AI 对战）
        </button>

        <div className="text-center text-xs text-gray-400 mb-3">— 或 —</div>

        {/* 创建房间 */}
        <button
          onClick={createRoom}
          className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-lg hover:bg-red-700 active:scale-95 transition mb-3"
        >
          ✨ 创建房间
        </button>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={joinRoomId}
            onChange={e => setJoinRoomId(e.target.value.toUpperCase())}
            placeholder="输入房间号"
            maxLength={6}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
          />
          <button
            onClick={() => joinRoom()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 active:scale-95 transition"
          >
            加入
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">等待中的房间</span>
            <button
              onClick={refreshRooms}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              刷新
            </button>
          </div>
          {rooms.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-4">暂无等待中的房间</div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {rooms.map(room => (
                <div
                  key={room.id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2 hover:bg-gray-50"
                >
                  <div>
                    <span className="font-mono font-bold text-green-700">{room.id}</span>
                    <span className="text-gray-500 text-xs ml-2">
                      {room.players[0]?.name} 的房间 · {room.playerCount}/5人
                    </span>
                  </div>
                  <button
                    onClick={() => joinRoom(room.id)}
                    className="px-3 py-1 bg-green-500 text-white rounded text-xs font-semibold hover:bg-green-600 active:scale-95"
                  >
                    加入
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-xs text-gray-400 text-center">
          5人 · 54张牌 · 方片3公开 · 红桃5先出<br />
          只能出单张、对子、炸弹 · 红桃5最小
        </div>
      </div>
    </div>
  );
}
