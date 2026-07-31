import type { Building, ScoreRecord, Season, Staff, Stats, Visitor, Weather } from './types';

const DB = 'prehistoric-park';
const STORE = 'kv';
const SAVE_KEY = 'save';
const PROFILE_KEY = 'profile';

export interface SaveData {
  version: 2;
  levelKey: string;
  money: number;
  time: number;
  month: number;
  roads: number[];
  buildings: Building[];
  visitors: Visitor[];
  staff: Staff[];
  stats: Stats;
  invented: string[];
  weather: Weather;
  season: Season;
  tutorialStep: number;
  savedAt: number;
}

export interface Profile {
  /** Ключ уровня → лучшее число звёзд. */
  stars: Record<string, number>;
  achievements: string[];
  records: ScoreRecord[];
}

export const EMPTY_PROFILE: Profile = { stars: {}, achievements: [], records: [] };

/** Открываем базу лениво: если IndexedDB недоступен, живём на localStorage. */
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Если база не отвечает (приватный режим Safari), не ждём вечно.
    setTimeout(() => resolve(null), 1500);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return lsGet<T>(key);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(lsGet<T>(key));
    } catch {
      resolve(lsGet<T>(key));
    }
  });
}

async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await open();
  if (!db) return lsSet(key, value);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(lsSet(key, value));
    } catch {
      resolve(lsSet(key, value));
    }
  });
}

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`pp.${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(`pp.${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const store = {
  loadSave: () => idbGet<SaveData>(SAVE_KEY),
  saveSave: (data: SaveData) => idbSet(SAVE_KEY, data),
  loadProfile: async (): Promise<Profile> => {
    const p = await idbGet<Profile>(PROFILE_KEY);
    return p ? { ...EMPTY_PROFILE, ...p } : { ...EMPTY_PROFILE, stars: {}, achievements: [], records: [] };
  },
  saveProfile: (p: Profile) => idbSet(PROFILE_KEY, p),
};

/** Доход за время отсутствия: четверть обычного, не больше восьми часов. */
export function offlineIncome(perMinute: number, savedAt: number, now = Date.now()): {
  minutes: number;
  money: number;
} {
  const minutes = Math.max(0, Math.min(480, (now - savedAt) / 60000));
  if (minutes < 2 || perMinute <= 0) return { minutes: 0, money: 0 };
  return { minutes: Math.round(minutes), money: Math.round(perMinute * minutes * 0.25) };
}
