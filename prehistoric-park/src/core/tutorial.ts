import { DEFS } from './catalog';
import type { Game } from './game';
import { MAP_H, MAP_W } from './grid';
import type { LevelDef } from './types';

/**
 * Обучение из оригинальной игры, переложенное на тач:
 * дорога → аттракционы → сервисы → работник → скамейки → охранник → свобода.
 */
export interface TutorialStep {
  title: string;
  text: string;
  done: (g: Game) => boolean;
}

function count(g: Game, key: string): number {
  return g.buildings.filter((b) => b.key === key).length;
}

function roads(g: Game): number {
  let n = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) if (g.map.road[i]) n++;
  return n;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'дорога',
    text: 'Гости ходят только по дорогам. Нажмите «строить», вкладка «дороги», возьмите грунтовую и проведите пальцем дорожку от входа — клеток на десять.',
    done: (g) => roads(g) >= 14,
  },
  {
    title: 'аттракционы',
    text: 'Постройте три аттракциона. Выберите его в меню, тапните по карте — примерить, тапните ещё раз — поставить. Белая рамка — вход, зелёная — выход, обе должны упираться в дорогу. Кнопка ⟳ разворачивает постройку.',
    done: (g) => g.buildings.filter((b) => DEFS[b.key].cat === 'ride').length >= 3,
  },
  {
    title: 'еда и вода',
    text: 'Кроме развлечений гости хотят есть и пить. Во вкладке «сервисы» постройте закусочную и источник.',
    done: (g) => count(g, 'zakusochnaya') >= 1 && count(g, 'istochnik') >= 1,
  },
  {
    title: 'работник',
    text: 'Закусочная не работает без повара. Тапните по ней на карте и наймите работника в её карточке.',
    done: (g) => g.buildings.some((b) => b.key === 'zakusochnaya' && b.staffId !== null),
  },
  {
    title: 'скамейки',
    text: 'Поставьте три скамейки — они во вкладке «растительность». На них гости восстанавливают силы.',
    done: (g) => count(g, 'skameyka') >= 3,
  },
  {
    title: 'охранник',
    text: 'Наймите охранника кнопкой 👷 справа внизу. Он не даст злым гостям устроить драку в парке.',
    done: (g) => g.staff.some((s) => s.kind === 'guard'),
  },
  {
    title: 'готово',
    text: 'Дальше сами: следите за иконками желаний над головами гостей и стройте то, чего не хватает. Цены на билеты меняются в карточке аттракциона.',
    done: () => false, // закрывается по таймеру, см. App.frame
  },
];

export const TUTORIAL: LevelDef = {
  key: 'tutorial',
  name: 'обучение',
  intro:
    'Короткий курс: построим парк по шагам. Подсказка всегда висит сверху, следующий шаг откроется сам.',
  money: 6000,
  unlocked: [
    'road_dirt',
    'batut',
    'kacheli',
    'tir',
    'istochnik',
    'tualet',
    'zakusochnaya',
    'skameyka',
    'cvety',
    'kust',
    'derevo',
  ],
  goals: {},
  seed: 31337,
  water: 0.3,
  rocks: 0.2,
};
