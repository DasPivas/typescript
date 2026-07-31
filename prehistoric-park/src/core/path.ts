import { MAP_H, MAP_W, type ParkMap } from './grid';

const NEI_X = [0, 1, 0, -1];
const NEI_Y = [-1, 0, 1, 0];

export interface Field {
  dist: Int32Array;
  prev: Int32Array;
}

/**
 * Волна по дорожным клеткам от точки старта.
 * Дороги — единственная поверхность, по которой ходят посетители,
 * поэтому граф маленький и волну можно гонять «в лоб».
 */
export function walkField(map: ParkMap, sx: number, sy: number): Field {
  const n = MAP_W * MAP_H;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  if (!map.inside(sx, sy) || map.roadAt(sx, sy) === 0) return { dist, prev };

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const s = map.idx(sx, sy);
  dist[s] = 0;
  queue[tail++] = s;

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % MAP_W;
    const cy = (cur / MAP_W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + NEI_X[k];
      const ny = cy + NEI_Y[k];
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (dist[ni] !== -1) continue;
      if (map.road[ni] === 0) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  return { dist, prev };
}

/** Восстановить маршрут из волны: массив клеток от следующей к цели. */
export function tracePath(field: Field, tx: number, ty: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let cur = ty * MAP_W + tx;
  if (field.dist[cur] < 0) return out;
  while (cur !== -1) {
    out.push({ x: cur % MAP_W, y: (cur / MAP_W) | 0 });
    cur = field.prev[cur];
  }
  out.reverse();
  out.shift(); // текущая клетка не нужна
  return out;
}
