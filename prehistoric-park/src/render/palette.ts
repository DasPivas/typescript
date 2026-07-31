/** Палитра в духе оригинального «Первобытного парка»: сочные цвета, тёмная обводка. */
export const C = {
  outline: 0x2a1c10,
  grass1: 0x5aa32e,
  grass2: 0x4e9427,
  grass3: 0x66b035,
  rock: 0x8d8577,
  rockDark: 0x6c655a,
  water: 0x2f8ecf,
  waterLight: 0x54aee6,
  dirt: 0xb98b46,
  sand: 0xc79a52,
  stone: 0x9a9384,
  wood: 0x8b5a2b,
  woodDark: 0x6b4320,
  leaf: 0x2f7a24,
  leafDark: 0x23601b,
  leafLight: 0x49a032,
  skin: 0xe8b07a,
  hair: 0x3b2415,
  fur: 0xf0c24e,
  furSpot: 0x8a5a1e,
  red: 0xd94141,
  orange: 0xef8a2b,
  yellow: 0xf5cf3d,
  bone: 0xf0e6cf,
  sky: 0x7ec8f0,
  shadow: 0x000000,
  cloth: 0xd8452f,
  cloth2: 0xf2e3c0,
} as const;

/** Оттенки одежды посетителей — чтобы толпа была разноцветной. */
export const VISITOR_TINTS = [0xf0c24e, 0xe08a3c, 0xd9d1b0, 0xc46a5a, 0xa8c05a, 0xdca9c8];

export const STAFF_COLORS: Record<string, number> = {
  seller: 0x3fa9d6,
  cook: 0xf2e3c0,
  repairman: 0xef8a2b,
  guard: 0xd94141,
  shaman: 0x9a5ad9,
};
