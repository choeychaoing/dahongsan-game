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
  // 对手牌排序：按 suit 和 rank 排列
  const sorted = [...cards].sort((a, b) => {
    const rankOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A','small_joker','big_joker'];
    return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
  });

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
