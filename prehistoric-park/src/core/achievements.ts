import type { Achievement, AchievementSource } from './types';
import { DEFS } from './catalog';

function rides(g: AchievementSource): number {
  return g.buildings.filter((b) => DEFS[b.key]?.cat === 'ride').length;
}

/**
 * Долгие задания: считаются по текущей партии, но факт выполнения
 * запоминается навсегда (см. progress в main.ts).
 */
export const ACHIEVEMENTS: Achievement[] = [
  {
    key: 'first_blood',
    name: 'первый прокат',
    desc: 'Кто-то наконец прокатился',
    progress: (g) => g.stats.ridesTaken,
    target: 1,
  },
  {
    key: 'crowd',
    name: 'толпа',
    desc: '50 гостей в парке одновременно',
    progress: (g) => g.stats.peakVisitors,
    target: 50,
  },
  {
    key: 'big_crowd',
    name: 'столпотворение',
    desc: '100 гостей в парке одновременно',
    progress: (g) => g.stats.peakVisitors,
    target: 100,
  },
  {
    key: 'rich',
    name: 'богач',
    desc: 'Накопить 50 000 монет',
    progress: (g) => g.money,
    target: 50000,
  },
  {
    key: 'tycoon',
    name: 'миллион',
    desc: 'Заработать 1 000 000 за всё время',
    progress: (g) => g.stats.income,
    target: 1000000,
  },
  {
    key: 'zoo',
    name: 'разнообразие',
    desc: '12 аттракционов в одном парке',
    progress: rides,
    target: 12,
  },
  {
    key: 'perfect',
    name: 'идеальный парк',
    desc: 'Рейтинг 90',
    progress: (g) => g.rating,
    target: 90,
  },
  {
    key: 'marathon',
    name: 'марафон',
    desc: '10 000 прокатов',
    progress: (g) => g.stats.ridesTaken,
    target: 10000,
  },
  {
    key: 'happy',
    name: 'все довольны',
    desc: '2000 гостей ушли довольными',
    progress: (g) => g.stats.visitorsServed,
    target: 2000,
  },
  {
    key: 'peaceful',
    name: 'без драк',
    desc: 'Продержаться 12 месяцев без единой драки',
    progress: (g) => (g.stats.fights === 0 ? g.month : 0),
    target: 12,
  },
];

export function achievementDone(a: Achievement, g: AchievementSource): boolean {
  return a.progress(g) >= a.target;
}
