'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// GameTable 使用客户端 Socket.IO，需要动态导入（禁用 SSR）
const GameTable = dynamic(() => import('@/components/GameTable'), { ssr: false });

export default function GamePage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 从房间页面跳转过来时，socket 已连接，无需等待 mySocketId
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-green-800 text-white">
        <div className="animate-pulse">正在加载...</div>
      </div>
    );
  }

  return <GameTable roomId={roomId} />;
}
