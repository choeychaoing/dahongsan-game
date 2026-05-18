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
  const revealBadge = player.revealStatus === 'revealed' ? '🎭 已亮' : null;

  return (
    <div
      className={`
        flex flex-col items-center gap-1 p-2 rounded-xl border-2 min-w-[80px]
        transition-all
        ${isCurrentTurn ? 'border-yellow-400 bg-yellow-50 shadow-lg scale-105' : 'border-gray-200 bg-white'}
        ${isMe ? 'ring-2 ring-blue-400' : ''}
        ${player.status === 'finished' ? 'opacity-60' : ''}
      `}
    >
      <div className="font-semibold text-sm truncate max-w-[72px]">
        {player.name}
        {isMe && <span className="text-blue-400 text-xs ml-1">（我）</span>}
      </div>

      {/* 当前轮次指示 */}
      {isCurrentTurn && (
        <div className="text-xs text-yellow-600 font-bold animate-pulse">⬆ 出牌中</div>
      )}

      {/* 完成名次 */}
      {player.finishRank && (
        <div className="text-xs font-bold text-green-600">第{player.finishRank}名 🎉</div>
      )}

      {/* 身份 */}
      {campLabel && (
        <div className={`text-xs px-1 rounded ${player.camp === 'red3' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
          {campLabel}
        </div>
      )}
      {!campLabel && player.status !== 'finished' && (
        <div className="text-xs text-gray-400">身份未知</div>
      )}

      {revealBadge && (
        <div className="text-xs text-purple-600">{revealBadge}</div>
      )}
    </div>
  );
}
