/** Общие типы симуляции парка. Модуль core ничего не знает о рендере. */

export type Terrain = 0 | 1 | 2; // 0 — трава, 1 — вода, 2 — скала (не застраивается)
export type RoadKind = 0 | 1 | 2; // 0 — нет, 1 — грунтовая, 2 — каменная
export type Rot = 0 | 1 | 2 | 3;

export type Category = 'road' | 'ride' | 'service' | 'decor';

/** Потребности посетителя. `fun` — желание кататься, растёт со временем. */
export type NeedKey = 'hunger' | 'thirst' | 'bladder' | 'energy' | 'health' | 'fun';

export type StaffKind = 'seller' | 'cook' | 'repairman' | 'guard' | 'shaman';

/** Кто пришёл в парк: у детей, взрослых и стариков разные запросы. */
export type VisitorKind = 'child' | 'adult' | 'elder';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'heat' | 'cold';

export interface BuildingDef {
  key: string;
  name: string;
  cat: Category;
  /** Размер в клетках до поворота. */
  w: number;
  h: number;
  cost: number;
  /** Ежемесячное обслуживание. */
  upkeep: number;
  /** Клетка входа (относительно левого верхнего угла, до поворота). */
  door: { x: number; y: number };
  /** Клетка выхода. Есть у аттракционов: гость заходит в одну, выходит в другую. */
  exit?: { x: number; y: number };
  /** Аттракционы: привлекательность 0..100 — от неё зависит справедливая цена. */
  rating?: number;
  /** Сколько посетителей катается одновременно. */
  capacity?: number;
  /** Длительность катания/обслуживания, сек. */
  duration?: number;
  /** Стартовая цена билета/товара. */
  basePrice?: number;
  /** Какую потребность закрывает сервис. */
  serves?: NeedKey;
  /** Насколько сильно закрывает (0..100 пунктов потребности). */
  servePower?: number;
  /** Нужен работник этого типа, иначе объект не работает. */
  needsStaff?: StaffKind;
  /** Требует диномотор в зоне покрытия. */
  needsMotor?: boolean;
  /** Должен примыкать к воде — водные аттракционы. */
  needsWater?: boolean;
  /** Указатель: в его радиусе гости видят парк дальше. */
  sign?: boolean;
  /** Насколько аттракцион бодрый: сильнее радует, но и выматывает. */
  intensity?: number;
  /** Декор: прибавка к настроению в радиусе. */
  scenery?: number;
  sceneryRadius?: number;
  /** Скамейка — восстанавливает силы сидящему. */
  seat?: boolean;
  /** Порядок появления в меню строительства. */
  order: number;
}

export interface StaffDef {
  key: StaffKind;
  name: string;
  duty: string;
  salary: number;
  hireCost: number;
}

export interface Building {
  id: number;
  key: string;
  x: number;
  y: number;
  rot: Rot;
  price: number;
  /** Состояние 0..100, падает от использования. */
  condition: number;
  broken: boolean;
  /** Очередь: id посетителей. */
  queue: number[];
  /** Катаются сейчас: id и оставшееся время. */
  riders: { vid: number; left: number }[];
  /** Прикреплённый работник (для сервисов). */
  staffId: number | null;
  /** Заработано за всё время. */
  revenue: number;
  /** Сколько раз прокатились/обслужились. */
  uses: number;
  /** Таймер до следующего запуска. */
  cooldown: number;
  /** Клетки, по которым выстраивается очередь (кешируются при перестройке дорог). */
  slots?: { x: number; y: number }[];
}

export type VisitorState =
  | 'entering'
  | 'walking'
  | 'queue'
  | 'busy' // катается / ест / сидит
  | 'leaving'
  | 'fighting';

export interface Visitor {
  id: number;
  kind: VisitorKind;
  /** Позиция в клетках (дробная). */
  x: number;
  y: number;
  state: VisitorState;
  /** Маршрут в клетках, с конца. */
  path: { x: number; y: number }[];
  targetId: number | null;
  /** Что именно ищем. */
  seeking: NeedKey | null;
  needs: Record<NeedKey, number>;
  mood: number;
  wallet: number;
  spent: number;
  /** Сколько уже стоит в очереди, сек. */
  waited: number;
  /** Остаток текущего занятия, сек. */
  busyLeft: number;
  /** Косметика. */
  tint: number;
  /** Время жизни в парке, сек. */
  age: number;
  /** Кулдаун поиска цели, чтобы не искать каждый тик. */
  think: number;
  /** Последняя не найденная потребность — для иконки над головой. */
  wish: NeedKey | 'happy' | 'sad' | 'leave';
  /** Где гость занят: на скамейке его видно, внутри аттракциона — нет. */
  busyAt: { x: number; y: number } | null;
  busySeat: boolean;
}

export interface Staff {
  id: number;
  kind: StaffKind;
  x: number;
  y: number;
  path: { x: number; y: number }[];
  /** Для сервисного работника — к какому зданию прикреплён. */
  buildingId: number | null;
  /** Цель ремонта/разгона драки. */
  taskId: number | null;
  think: number;
  /** Остаток текущего действия (ремонт и т.п.), сек. */
  busy: number;
}

export interface GoalSpec {
  money?: number;
  rating?: number;
  visitorsServed?: number;
  rides?: number;
  /** Уложиться в N месяцев (0 — без ограничения). */
  months?: number;
}

export interface LevelDef {
  key: string;
  name: string;
  intro: string;
  money: number;
  /** Ключи построек, доступных с самого начала. */
  unlocked: string[];
  /** Что изобретается по ходу уровня, в порядке открытия. */
  inventions?: string[];
  goals: GoalSpec;
  /** Сид генератора карты. */
  seed: number;
  /** Доля воды/скал на карте. */
  water: number;
  rocks: number;
}

export interface Stats {
  income: number;
  expense: number;
  visitorsServed: number;
  visitorsLeftAngry: number;
  ridesTaken: number;
  /** Пик одновременных посетителей — для заданий. */
  peakVisitors: number;
  fights: number;
  breakdowns: number;
}

/** Долгое задание: считается по всем партиям сразу. */
export interface Achievement {
  key: string;
  name: string;
  desc: string;
  /** Текущее значение и цель — чтобы рисовать прогресс. */
  progress: (g: AchievementSource) => number;
  target: number;
}

/** Минимум, который нужен заданиям от игры. */
export interface AchievementSource {
  money: number;
  rating: number;
  stats: Stats;
  visitors: { length: number };
  buildings: { key: string }[];
  month: number;
}

/** Запись в таблице рекордов. */
export interface ScoreRecord {
  level: string;
  stars: number;
  money: number;
  rating: number;
  months: number;
  at: number;
}
