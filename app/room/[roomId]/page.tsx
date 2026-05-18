'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
function getSocketUrl() {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
}
function getSocket() {
  if (!socket) socket = io(getSocketUrl(), { path: '/socket.io', transports: ['websocket', 'polling'] });
  return socket;
}

interface PlayerInfo {
  id: string;
  name: string;
  status: string;
}

interface RoomInfo {
  id: string;
  hostId: string;
  hostName?: string;
  status: string;
  playerCount: number;
  players: PlayerInfo[];
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [myId, setMyId] = useState('');
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);

  // 读取玩家名称（支持 URL 参数中的 botName）
  const getPlayerName = () => {
    if (typeof window === 'undefined') return '玩家';
    // 优先取 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const botName = urlParams.get('botName');
    if (botName) {
      localStorage.setItem('playerName', botName);
      return botName;
    }
    return localStorage.getItem('playerName') ?? '玩家';
  };

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    const onConnect = () => {
      setMyId(s.id!);
      sessionStorage.setItem('mySocketId', s.id!);

      // 重连时重新加入房间
      const name = getPlayerName();
      s.emit('set_name', name);
      s.emit('join_room', roomId, (res: { success: boolean; room?: RoomInfo; error?: string }) => {
        if (res.success && res.room) {
          setRoom(res.room);
        } else {
          setError(res.error ?? '加入失败');
        }
      });
    };

    const onRoomUpdated = (updatedRoom: RoomInfo) => {
      setRoom(updatedRoom);
    };

    const onGameState = (state: unknown) => {
      // 存入 sessionStorage，game 页面直接读取（避免 socket 还没好就跳转）
      sessionStorage.setItem('pendingGameState', JSON.stringify(state));
      router.push(`/game/${roomId}`);
    };

    if (s.connected) onConnect();
    s.on('connect', onConnect);
    s.on('room_updated', onRoomUpdated);
    s.on('game_state', onGameState);

    return () => {
      s.off('connect', onConnect);
      s.off('room_updated', onRoomUpdated);
      s.off('game_state', onGameState);
    };
  }, [roomId, router]);

  const startGame = () => {
    socketRef.current?.emit('start_game', (res: { success: boolean; error?: string }) => {
      if (!res.success) setError(res.error ?? '开始失败');
    });
  };

  const copyRoomId = () => {
    navigator.clipboard?.writeText(roomId).catch(() => {});
  };

  const playerName = getPlayerName();
  const isHost = room?.hostId === myId || room?.hostName === playerName;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
        <div className="text-center mb-4">
          <div className="text-2xl font-bold text-green-700">等待游戏开始</div>
          <div
            className="text-4xl font-mono font-bold text-gray-800 mt-2 cursor-pointer hover:text-green-600"
            onClick={copyRoomId}
            title="点击复制房间号"
          >
            {roomId}
          </div>
          <div className="text-xs text-gray-400 mt-1">点击复制房间号，分享给朋友</div>
        </div>

        {error && (
          <div className="mb-3 text-red-500 text-sm text-center bg-red-50 rounded-lg py-2">
            {error}
          </div>
        )}

        {/* 座位列表 */}
        <div className="space-y-2 mb-4">
          {Array.from({ length: 5 }).map((_, i) => {
            const player = room?.players[i];
            return (
              <div
                key={i}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 ${
                  player ? 'border-green-300 bg-green-50' : 'border-dashed border-gray-200 bg-gray-50'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center font-bold text-green-700">
                  {i + 1}
                </div>
                {player ? (
                  <div className="flex-1">
                    <div className="font-semibold text-gray-800">
                      {player.name}
                      {player.id === myId && <span className="text-blue-500 text-xs ml-1">（我）</span>}
                      {player.id === room?.hostId && <span className="text-yellow-500 text-xs ml-1">👑 房主</span>}
                    </div>
                    <div className="text-xs text-green-600">已就绪</div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">等待玩家加入...</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-center text-sm text-gray-500 mb-4">
          {room?.playerCount ?? 0}/5 人就绪
        </div>

        {isHost ? (
          <button
            onClick={startGame}
            disabled={room?.playerCount !== 5}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-lg hover:bg-red-700 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {room?.playerCount === 5 ? '🚀 开始游戏' : `等待 ${5 - (room?.playerCount ?? 0)} 人加入`}
          </button>
        ) : (
          <div className="text-center text-gray-500 py-3">
            等待房主开始游戏...
          </div>
        )}

        <button
          onClick={() => router.push('/')}
          className="w-full mt-2 py-2 text-gray-500 text-sm hover:text-gray-700"
        >
          ← 返回大厅
        </button>
      </div>
    </div>
  );
}
