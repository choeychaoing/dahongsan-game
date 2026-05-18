// ============================================================
// 胜负判定、阵营分配
// ============================================================
import { Player, GameState, Camp, GameResult, RankEntry } from './types';

/** 为玩家分配阵营和身份 */
export function assignCamps(players: Player[]): void {
  for (const player of players) {
    if (player.isHolding_diamond3 || player.isHolding_heart3) {
      player.camp = 'red3';
    } else {
      player.camp = 'trio';
    }
    // 方片3自动公开
    if (player.isHolding_diamond3) {
      player.revealStatus = 'revealed';
    }
  }
}

/**
 * 检查胜负
 * 返回 GameResult 或 null（游戏未结束）
 *
 * 红3阵营胜利：
 *   方片3 或 红桃3 任意一人先跑完，
 *   且另一个红3阵营玩家必须在其他玩家都走完之前也跑完
 *   -> 简化：红3阵营两人都已 finishedPlayers 中，且没有第三个三人阵营玩家排在他们前面导致提前结束
 *
 * 实现策略：
 *   - 当任意玩家出完牌时，检查：
 *     a) 红3阵营两人是否都在 finishedPlayers 中 -> 红3胜
 *     b) 三人阵营中已有3人跑完 -> 三人阵营胜（红3不可能两人都先跑完）
 *     c) finishedPlayers.length == 4 -> 看最后一人，触发结算
 *
 * 大胜利（Landslide）：
 *   红3阵营的两人占据 finishedPlayers[0] 和 finishedPlayers[1]
 *
 * 亮身份翻倍：
 *   红桃3主动亮 -> 红3胜时翻倍
 *   黑桃3/梅花3主动亮 -> 三人阵营胜时翻倍
 */
export function checkVictory(state: GameState): GameResult | null {
  const { players, finishedPlayers } = state;

  if (finishedPlayers.length < 2) return null;

  const red3Players = players.filter(p => p.camp === 'red3');
  const trioPlayers = players.filter(p => p.camp === 'trio');

  const red3Finished = red3Players.filter(p => finishedPlayers.includes(p.id));
  const trioFinished = trioPlayers.filter(p => finishedPlayers.includes(p.id));

  // 三人阵营胜利条件：三人阵营已有足够玩家跑完，导致红3阵营不可能两人全部先完成
  // 简化：三人阵营已有2人跑完，但红3还有人没跑完 -> 三人阵营胜
  // 更精确：统计 finishedPlayers 中，如果红3阵营只有1人跑完，但已有2名三人阵营跑完，
  //         则红3阵营那个剩余玩家如果排在第4或第5，不影响；
  //         关键判断：若三人阵营已3人全部跑完，必然红3阵营不可能2人都在前3 -> 三人阵营胜

  if (trioFinished.length === 3) {
    // 三人阵营全跑完，游戏结束
    return buildResult(state, 'trio');
  }

  if (red3Finished.length === 2) {
    // 红3阵营两人都跑完
    return buildResult(state, 'red3');
  }

  // 只剩1人未完成（4人已跑完）
  if (finishedPlayers.length === 4) {
    // 找出未跑完的那个人
    const remaining = players.find(p => !finishedPlayers.includes(p.id));
    if (!remaining) return null;

    // 此时4人已完成，游戏结束，判断阵营
    if (red3Finished.length === 2) {
      return buildResult(state, 'red3');
    } else {
      return buildResult(state, 'trio');
    }
  }

  return null;
}

function buildResult(state: GameState, winner: Camp): GameResult {
  const { players, finishedPlayers } = state;

  // 为未跑完的玩家补充名次
  const allRanked = [...finishedPlayers];
  players.forEach(p => {
    if (!allRanked.includes(p.id)) allRanked.push(p.id);
  });

  const rankings: RankEntry[] = allRanked.map((id, idx) => {
    const player = players.find(p => p.id === id)!;
    return {
      playerId: player.id,
      playerName: player.name,
      camp: player.camp!,
      rank: idx + 1,
      revealed: player.revealStatus === 'revealed',
    };
  });

  // 大胜利：红3阵营两人占第1、第2名
  const red3Rankings = rankings.filter(r => r.camp === 'red3').map(r => r.rank).sort();
  const isLandslide = winner === 'red3' && red3Rankings.length === 2
    && red3Rankings[0] === 1 && red3Rankings[1] === 2;

  // 翻倍：
  // 红桃3主动亮了 -> 红3赢时翻倍
  // 黑3（黑桃3或梅花3）主动亮了 -> 三人阵营赢时翻倍
  const revealedPlayers = players
    .filter(p => p.revealStatus === 'revealed' && (p.isHolding_heart3 || p.isHolding_black3))
    .map(p => p.id);

  let doubleReward = false;
  if (winner === 'red3') {
    const heart3Player = players.find(p => p.isHolding_heart3);
    if (heart3Player && heart3Player.revealStatus === 'revealed') {
      doubleReward = true;
    }
  } else {
    const black3Players = players.filter(p => p.isHolding_black3);
    if (black3Players.some(p => p.revealStatus === 'revealed')) {
      doubleReward = true;
    }
  }

  return {
    winner,
    isLandslide,
    doubleReward,
    revealedPlayers,
    rankings,
  };
}
