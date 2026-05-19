'use client';
import { PlayerView } from '@/lib/rules/types';

interface PlayerSeatProps {
  player: PlayerView;
  isMe: boolean;
  isCurrentTurn: boolean;
}

const CAMP_LABEL: Record<string, string> = {
  red3: '🔴 红3阵营',
  trio: '⚫ 三人阵营',
};

export function PlayerSeat({ player, isMe, isCurrentTurn }: PlayerSeatProps) {
  const campLabel = player.camp ? CAMP_LABEL[player.camp] : null;
  const isFinished = player.status === 'finished';

  return (
    <div
      className={`
        flex flex-col items-center gap-1 p-3 rounded-xl border-2 min-w-[90px]
        transition-all
        ${isCurrentTurn ? 'border-yellow-400 bg-yellow-50 shadow-lg scale-105' : 'border-gray-200 bg-white'}
        ${isMe ? 'ring-2 ring-blue-400' : ''}
        ${isFinished ? 'opacity-60' : ''}
      `}
    >
      {/* 名字 - 最突出 */}
      <div className={`font-bold text-base truncate max-w-[100px] ${isCurrentTurn ? 'text-yellow-700' : 'text-gray-800'}`} title={player.name}>
        {isCurrentTurn && <span className="mr-1">▶</span>}
        {player.name}
        {isMe && <span className="text-blue-500 text-xs ml-1">（我）</span>}
      </div>

      {/* 手牌数量 / 已跑完 */}
      <div className="text-xs text-gray-500">
        {isFinished ? '🏁 已跑完' : `剩 ${player.handCount} 张`}
      </div>

      {/* 当前轮次指示 */}
      {isCurrentTurn && (
        <div className="text-xs text-yellow-700 font-bold animate-pulse bg-yellow-200 px-2 py-0.5 rounded-full">出牌中</div>
      )}

      {/* 完成名次 */}
      {player.finishRank && (
        <div className="text-sm font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded">
          🎉 第{player.finishRank}名
        </div>
      )}

      {/* 身份（只有亮出来才显示） */}
      {campLabel && (
        <div className={`text-xs px-1.5 py-0.5 rounded font-medium ${player.camp === 'red3' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
          {campLabel} 🎭 已亮
        </div>
      )}
    </div>
  );
}
