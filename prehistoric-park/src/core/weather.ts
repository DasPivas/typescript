import type { Season, Weather } from './types';

/** Один сезон — три месяца, полный год цикличен. */
export function seasonOf(month: number): Season {
  const i = Math.floor((month % 12) / 3);
  return (['spring', 'summer', 'autumn', 'winter'] as const)[i];
}

export const SEASON_NAME: Record<Season, string> = {
  spring: 'весна',
  summer: 'лето',
  autumn: 'осень',
  winter: 'зима',
};

export const WEATHER_NAME: Record<Weather, string> = {
  clear: 'ясно',
  rain: 'дождь',
  heat: 'жара',
  cold: 'холод',
};

export const WEATHER_ICON: Record<Weather, string> = {
  clear: '☀️',
  rain: '🌧️',
  heat: '🔥',
  cold: '❄️',
};

/** Вероятности погоды по сезонам — сумма в каждой строке равна 1. */
const TABLE: Record<Season, [Weather, number][]> = {
  spring: [
    ['clear', 0.6],
    ['rain', 0.32],
    ['heat', 0.03],
    ['cold', 0.05],
  ],
  summer: [
    ['clear', 0.56],
    ['rain', 0.16],
    ['heat', 0.28],
    ['cold', 0],
  ],
  autumn: [
    ['clear', 0.45],
    ['rain', 0.4],
    ['heat', 0.02],
    ['cold', 0.13],
  ],
  winter: [
    ['clear', 0.42],
    ['rain', 0.16],
    ['heat', 0],
    ['cold', 0.42],
  ],
};

export function rollWeather(season: Season, rnd: () => number): Weather {
  let r = rnd();
  for (const [w, p] of TABLE[season]) {
    if (r < p) return w;
    r -= p;
  }
  return 'clear';
}

export interface WeatherEffect {
  /** Множитель притока гостей. */
  attendance: number;
  /** Множители скорости роста потребностей. */
  thirst: number;
  hunger: number;
  /** Постоянная поправка к настроению. */
  mood: number;
}

const WEATHER_EFFECT: Record<Weather, WeatherEffect> = {
  clear: { attendance: 1, thirst: 1, hunger: 1, mood: 2 },
  rain: { attendance: 0.45, thirst: 0.7, hunger: 1, mood: -10 },
  heat: { attendance: 1.15, thirst: 1.8, hunger: 0.85, mood: -3 },
  cold: { attendance: 0.6, thirst: 0.6, hunger: 1.35, mood: -6 },
};

const SEASON_ATTENDANCE: Record<Season, number> = {
  spring: 1,
  summer: 1.25,
  autumn: 0.9,
  winter: 0.65,
};

export function effectOf(weather: Weather, season: Season): WeatherEffect {
  const e = WEATHER_EFFECT[weather];
  return { ...e, attendance: e.attendance * SEASON_ATTENDANCE[season] };
}
