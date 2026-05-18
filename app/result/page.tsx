'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { GameResult, RankEntry } from '@/lib/rules/types';
import { Suspense } from 'react';

let socket: Socket | null = null;
function getSocketUrl() {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}
function getSocket() {
  if (!socket) socket = io(getSocketUrl(), { transports: ['websocket', 'polling'] });
  return socket;
}

function ResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roomId = searchParams.get('roomId');
  const [result, setResult] = useState<GameResult | null>(null);

  useEffect(() => {
    const s = getSocket();
    const onGameOver = (r: GameResult) => setResult(r);
    s.on('game_over', onGameOver);

    // 如果已有结果（从 sessionStorage 获取）
    const saved = sessionStorage.getItem('gameResult');
    if (saved) {
      try { setResult(JSON.parse(saved)); } catch {}
    }

    return () => { s.off('game_over', onGameOver); };
  }, []);

  useEffect(() => {
    if (result) {
      sessionStorage.setItem('gameResult', JSON.stringify(result));
    }
  }, [result]);

  if (!result) {
    return (
      <div className="min-h-screen bg-green-800 flex items-center justify-center text-white">
        <div className="text-center">
          <div className="text-2xl animate-pulse">加载结算结果...</div>
          <div className="text-sm mt-2 text-gray-400">
            <a href="/" className="underline">返回大厅</a>
          </div>
        </div>
      </div>
    );
  }

  const rankMedals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md text-center">
        {/* 大标题 */}
        <div className="text-5xl mb-2">
          {result.isLandslide ? '🏆' : result.winner === 'red3' ? '🔴' : '⚫'}
        </div>
        <h1 className="text-2xl font-bold text-gray-800">
          {result.winner === 'red3' ? '红3阵营 胜利！' : '三人阵营 胜利！'}
        </h1>

        {/* 特殊奖励 */}
        <div className="flex gap-2 justify-center mt-2 flex-wrap">
          {result.isLandslide && (
            <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-bold">
              ✨ 大胜利
            </span>
          )}
          {result.doubleReward && (
            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-bold">
              🎭 亮身份翻倍
            </span>
          )}
        </div>

        {/* 名次 */}
        <div className="mt-5">
          <h2 className="text-sm font-medium text-gray-500 mb-3">玩家名次</h2>
          <div className="space-y-2">
            {result.rankings.sort((a, b) => a.rank - b.rank).map((r: RankEntry) => (
              <div
                key={r.playerId}
                className={`flex items-center gap-3 p-3 rounded-xl ${
                  r.camp === 'red3' ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'
                }`}
              >
                <span className="text-2xl">{rankMedals[r.rank - 1] ?? r.rank}</span>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-gray-800">
                    {r.playerName}
                    {r.revealed && <span className="text-purple-500 text-xs ml-1">🎭</span>}
                  </div>
                  <div className={`text-xs ${r.camp === 'red3' ? 'text-red-500' : 'text-gray-500'}`}>
                    {r.camp === 'red3' ? '🔴 红3阵营' : '⚫ 三人阵营'}
                  </div>
                </div>
                {r.camp === result.winner && (
                  <span className="text-green-500 text-sm font-bold">胜</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 规则说明 */}
        <div className="mt-4 text-xs text-gray-400 text-left bg-gray-50 rounded-lg p-3">
          <div className="font-semibold text-gray-600 mb-1">本局说明</div>
          {result.isLandslide && <div>· 大胜利：红3阵营拿下第1、2名</div>}
          {result.doubleReward && <div>· 翻倍：有玩家主动亮身份，获胜阵营奖励×2</div>}
          {result.revealedPlayers.length > 0 && (
            <div>· 亮身份玩家：{result.revealedPlayers.length} 人</div>
          )}
        </div>

        {/* 操作 */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => router.push('/')}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 active:scale-95 transition"
          >
            🏠 返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-green-800 flex items-center justify-center text-white">加载中...</div>}>
      <ResultContent />
    </Suspense>
  );
}
