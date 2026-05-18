'use client';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import dynamic from 'next/dynamic';

const GameTable = dynamic(() => import('@/components/GameTable'), { ssr: false });

export default function TestPage() {
  const [status, setStatus] = useState('⚙️ 初始化中...');
  const [roomId, setRoomId] = useState('');
  const [step, setStep] = useState<'init' | 'bots' | 'ready'>('init');
  const [botCount, setBotCount] = useState(0);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
    const hostName = '测试玩家';
    const botNames = ['小明', '小红', '小刚', '小美'];

    const socket = io(socketUrl, { path: '/socket.io', transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      setStatus('✅ 已连接服务器，创建房间...');
      socket.emit('set_name', hostName);

      socket.emit('create_room', (res: { success: boolean; roomId?: string; error?: string }) => {
        if (!res.success || !res.roomId) {
          setStatus('❌ 创建房间失败: ' + res.error);
          return;
        }
        const rid = res.roomId;
        setRoomId(rid);
        setStatus(`🏠 房间 ${rid} 已创建，正在召唤机器人...`);

        // 请求服务器直接注入4个机器人
        fetch(`${socketUrl}/api/test/add-bots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: rid, botNames }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.ok) {
              setBotCount(data.joined);
              setStatus(`🤖 ${data.joined} 个机器人已就位！`);

              // 监听 game_state，收到后缓存并跳转
              socket.once('game_state', (state) => {
                sessionStorage.setItem('pendingGameState', JSON.stringify(state));
                setStep('ready');
              });

              // 1秒后开始游戏
              setTimeout(() => {
                socket.emit('start_game', (startRes: { success: boolean; error?: string }) => {
                  if (!startRes.success) {
                    setStatus('❌ 开始失败: ' + startRes.error);
                    return;
                  }
                  // game_state 会触发上面的 once 监听器，然后跳转
                });
              }, 1000);
            } else {
              setStatus('❌ 机器人加入失败: ' + data.error);
            }
          })
          .catch(e => {
            setStatus('❌ 网络错误: ' + String(e));
          });
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  if (step === 'ready' && roomId) {
    return <GameTable roomId={roomId} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm w-full">
        <div className="text-5xl mb-4">🎮</div>
        <h1 className="text-xl font-bold text-green-700 mb-2">🎯 单机测试模式</h1>
        <p className="text-gray-500 text-sm mb-6">
          自动创建房间 + 召唤4个机器人 + 开始游戏
        </p>

        <div className="bg-green-50 rounded-xl p-4 text-sm text-green-700 text-left mb-6 whitespace-pre-line">
          {status}
          {botCount > 0 && (
            <span className="block mt-1 font-semibold">
              ✅ {botCount}/4 机器人已加入
            </span>
          )}
        </div>

        {roomId && (
          <div className="text-xs text-gray-400">
            房间号：<span className="font-mono font-bold text-gray-600">{roomId}</span>
          </div>
        )}
      </div>
    </div>
  );
}
