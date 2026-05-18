'use client';
import { useState } from 'react';
import { Card as CardType } from '@/lib/rules/types';

interface CardProps {
  card: CardType;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
}

const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-gray-900',
  spades: 'text-gray-900',
  joker: 'text-purple-600',
};

export function CardComponent({ card, selected, onClick, small }: CardProps) {
  const color = SUIT_COLOR[card.suit] ?? 'text-gray-900';
  const isRed3Special = card.rank === '3' && (card.suit === 'hearts' || card.suit === 'diamonds');
  const isJoker = card.suit === 'joker';

  return (
    <button
      onClick={onClick}
      className={`
        relative inline-flex flex-col items-center justify-between
        rounded-lg border-2 select-none transition-all cursor-pointer
        ${small ? 'w-9 h-14 text-xs' : 'w-12 h-18 text-sm'}
        ${selected
          ? 'border-blue-500 bg-blue-50 -translate-y-3 shadow-lg'
          : 'border-gray-300 bg-white hover:border-blue-300 hover:shadow'
        }
        ${isRed3Special ? 'ring-2 ring-red-400' : ''}
        ${isJoker ? 'ring-2 ring-purple-400' : ''}
        p-1
      `}
      aria-label={card.display}
    >
      <span className={`font-bold leading-none ${color} ${small ? 'text-xs' : 'text-sm'}`}>
        {card.rank === 'small_joker' ? '小' : card.rank === 'big_joker' ? '大' : card.rank}
      </span>
      <span className={`${color} ${small ? 'text-sm' : 'text-lg'}`}>
        {card.suit === 'hearts' ? '♥' :
          card.suit === 'diamonds' ? '♦' :
          card.suit === 'clubs' ? '♣' :
          card.suit === 'spades' ? '♠' : '🃏'}
      </span>
    </button>
  );
}

interface HandProps {
  cards: CardType[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}

export function Hand({ cards, selectedIds, onToggle, disabled }: HandProps) {
  // 手牌按牌力从大到小排序：大王→小王→4→3→2→A→K→Q→J→10→9→8→7→6→5（游戏规则中 4最大 5最小）
  const RANK_POWER: Record<string, number> = {
    'big_joker': 15, 'small_joker': 14,
    '4': 13, '3': 12, '2': 11, 'A': 10,
    'K': 9, 'Q': 8, 'J': 7,
    '10': 6, '9': 5, '8': 4, '7': 3, '6': 2, '5': 1,
  };
  const sorted = [...cards].sort((a, b) =>
    (RANK_POWER[b.rank] ?? 0) - (RANK_POWER[a.rank] ?? 0)
  );

  return (
    <div className="flex flex-wrap gap-1 justify-center p-2">
      {sorted.map(card => (
        <CardComponent
          key={card.id}
          card={card}
          selected={selectedIds.includes(card.id)}
          onClick={disabled ? undefined : () => onToggle(card.id)}
        />
      ))}
    </div>
  );
}
