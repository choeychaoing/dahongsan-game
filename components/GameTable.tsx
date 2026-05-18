'use client';
import { useState, useEffect } from 'react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { Hand, CardComponent } from '@/components/Card';
import { PlayerSeat } from '@/components/PlayerSeat';
import { Play } from '@/lib/rules/types';
import { useRouter } from 'next/navigation';

interface GameTableProps {
  roomId: string;
}

export default function GameTable({ roomId }: GameTableProps) {
  const router = useRouter();
  const { gameState, gameOver, error, connected, playCards, pass, windDecision, revealIdentity, clearError } =
    useGameSocket(roomId);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);

  // 关键修复：从 sessionStorage 读取创建房间时保存的 socketId，而不是用新 socket 的 id
  const myId = (typeof window !== 'undefined' && sessionStorage.getItem('mySocketId')) || '';
  const me = gameState?.players.find(p => p.id === myId);
  const isMyTurn = gameState?.currentPlayerId === myId;

  // 倒计时
  useEffect(() => {
    if (!gameState?.turnDeadline) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((gameState.turnDeadline! - Date.now()) / 1000));
      setCountdown(remaining);
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [gameState?.turnDeadline]);

  const toggleCard = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handlePlay = () => {
    if (selectedIds.length === 0) return;
    playCards(selectedIds);
    setSelectedIds([]);
  };

  const handlePass = () => {
    pass();
    setSelectedIds([]);
  };

  // 游戏结束跳转
  useEffect(() => {
    if (gameOver) {
      setTimeout(() => {
        router.push(`/result?roomId=${roomId}`);
      }, 2000);
    }
  }, [gameOver, roomId, router]);

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-screen bg-green-800">
        <div className="text-white text-xl animate-pulse">正在加载游戏...</div>
      </div>
    );
  }

  const otherPlayers = gameState.players.filter(p => p.id !== myId);
  const windRequired = gameState.windDecision.required && gameState.windDecision.decisionPlayerId === myId;

  // 渲染当前桌面牌
  const renderLastPlay = (play: Play | null) => {
    if (!play) return <div className="text-gray-400 italic text-sm">（无需管牌，自由出牌）</div>;
    return (
      <div className="flex gap-1 items-center">
        <span className="text-xs text-gray-500 mr-1">
          {play.type === 'single' ? '单张' : play.type === 'pair' ? '对子' : '炸弹'} |
        </span>
        {play.cards.map(c => <CardComponent key={c.id} card={c} small />)}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-green-800 flex flex-col text-white select-none">
      {/* 顶部状态栏 */}
      <div className="bg-green-900 px-4 py-2 flex items-center justify-between text-sm">
        <span>房间 <strong>{roomId}</strong></span>
        <span>第 {gameState.round} 轮</span>
        {connected ? (
          <span className="text-green-300">● 已连接</span>
        ) : (
          <span className="text-red-400 animate-pulse">● 断线中</span>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="bg-red-600 text-white text-center py-2 text-sm cursor-pointer"
          onClick={clearError}
        >
          ❌ {error}（点击关闭）
        </div>
      )}

      {/* 其他玩家 */}
      <div className="flex gap-2 justify-center flex-wrap p-3">
        {otherPlayers.map(p => (
          <PlayerSeat
            key={p.id}
            player={p}
            isMe={false}
            isCurrentTurn={gameState.currentPlayerId === p.id}
          />
        ))}
      </div>

      {/* 桌面区 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        {/* 当前需要管的牌 */}
        <div className="bg-green-700 rounded-xl px-4 py-3 text-center w-full max-w-sm">
          <div className="text-xs text-green-300 mb-1">
            {gameState.lastPlayPlayerId
              ? `${gameState.players.find(p => p.id === gameState.lastPlayPlayerId)?.name} 出的牌`
              : '当前桌面'
            }
          </div>
          {renderLastPlay(gameState.lastActivePlay)}
        </div>

        {/* 给风决策 */}
        {windRequired && (
          <div className="bg-yellow-500 text-gray-900 rounded-xl p-4 text-center w-full max-w-sm shadow-xl">
            <div className="font-bold text-lg mb-1">🌬️ 给风决策</div>
            <div className="text-sm mb-3">
              上家 <strong>{gameState.players.find(p => p.id === gameState.windDecision.lastFinishedPlayerId)?.name}</strong> 已出完牌。
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => windDecision(true)}
                className="px-5 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 active:scale-95"
              >
                给风（自由出）
              </button>
              <button
                onClick={() => windDecision(false)}
                className="px-5 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 active:scale-95"
              >
                不给风（续管）
              </button>
            </div>
          </div>
        )}

        {/* 倒计时 */}
        {isMyTurn && !windRequired && countdown !== null && (
          <div className={`text-2xl font-bold ${countdown <= 10 ? 'text-red-400 animate-pulse' : 'text-yellow-300'}`}>
            ⏱ {countdown}s
          </div>
        )}

        {/* 出牌历史 */}
        <div className="text-xs text-green-300 max-h-20 overflow-y-auto w-full max-w-sm">
          {gameState.playHistory.slice(-8).reverse().map((r, i) => (
            <div key={i} className="truncate">
              <span className="font-semibold">{r.playerName}</span>：
              {r.isPass ? '⏭ 跳过' : r.play ? r.play.cards.map(c => c.display).join(' ') : ''}
            </div>
          ))}
        </div>
      </div>

      {/* 底部：我的手牌 + 操作 */}
      <div className="bg-green-900 pb-safe">
        {/* 我的玩家信息 */}
        {me && (
          <div className="flex items-center justify-between px-4 pt-2 text-sm">
            <div>
              <span className="font-semibold">{me.name}</span>
              {me.camp && (
                <span className={`ml-2 text-xs px-1 rounded ${me.camp === 'red3' ? 'text-red-300' : 'text-gray-300'}`}>
                  {me.camp === 'red3' ? '🔴 红3阵营' : '⚫ 三人阵营'}
                </span>
              )}
            </div>
            <div className="text-gray-400 text-xs">手牌 {gameState.myHand.length} 张</div>
          </div>
        )}

        {/* 手牌 */}
        <div className="overflow-x-auto">
          <Hand
            cards={gameState.myHand}
            selectedIds={selectedIds}
            onToggle={toggleCard}
            disabled={!isMyTurn || windRequired}
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 justify-center pb-4 px-4 pt-2 flex-wrap">
          {isMyTurn && !windRequired && (
            <>
              <button
                onClick={handlePlay}
                disabled={selectedIds.length === 0}
                className="px-6 py-2 bg-blue-500 text-white rounded-xl font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 active:scale-95 transition"
              >
                出牌 {selectedIds.length > 0 ? `(${selectedIds.length}张)` : ''}
              </button>

              {gameState.lastActivePlay && (
                <button
                  onClick={handlePass}
                  className="px-6 py-2 bg-gray-500 text-white rounded-xl font-bold hover:bg-gray-600 active:scale-95 transition"
                >
                  跳过
                </button>
              )}
            </>
          )}

          {/* 亮身份按钮 */}
          {me && me.revealStatus === 'hidden' && (
            <button
              onClick={revealIdentity}
              className="px-4 py-2 bg-purple-500 text-white rounded-xl text-sm hover:bg-purple-600 active:scale-95 transition"
            >
              🎭 亮身份
            </button>
          )}

          {/* 选中信息 */}
          {selectedIds.length > 0 && (
            <button
              onClick={() => setSelectedIds([])}
              className="px-4 py-2 bg-gray-700 text-white rounded-xl text-sm hover:bg-gray-800 active:scale-95 transition"
            >
              清空选择
            </button>
          )}
        </div>
      </div>

      {/* 游戏结束浮层 */}
      {gameOver && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white text-gray-900 rounded-2xl p-8 text-center shadow-2xl max-w-xs w-full mx-4">
            <div className="text-4xl mb-2">{gameOver.isLandslide ? '🏆' : '🎮'}</div>
            <div className="text-2xl font-bold mb-1">
              {gameOver.winner === 'red3' ? '🔴 红3阵营胜利！' : '⚫ 三人阵营胜利！'}
            </div>
            {gameOver.isLandslide && (
              <div className="text-yellow-500 font-bold text-lg">✨ 大胜利！</div>
            )}
            {gameOver.doubleReward && (
              <div className="text-purple-600 font-semibold mt-1">🎭 亮身份翻倍！</div>
            )}
            <div className="text-gray-500 text-sm mt-3">正在跳转结算页...</div>
          </div>
        </div>
      )}
    </div>
  );
}
