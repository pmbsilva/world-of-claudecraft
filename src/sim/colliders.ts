import { generateDecorations } from './world';
import { DUNGEON_X_THRESHOLD, INSTANCE_SLOT_COUNT, instanceOrigin } from './data';

// Static world collision. This module is the single source of truth for prop
// placement: the renderer builds its meshes from these defs and the sim blocks
// movement against them, so what you see is what you collide with.
// Sim layer: no three.js imports.

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
}

export type Collider = CircleCollider | ObbCollider;

// ---------------------------------------------------------------------------
// Prop placement data (shared with src/render/props.ts)
// ---------------------------------------------------------------------------

export interface BuildingDef {
  kind: 'house' | 'inn' | 'chapel';
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export const BUILDINGS: BuildingDef[] = [
  { kind: 'house', x: 10, z: 12, w: 7, d: 6, rot: -0.4 },
  { kind: 'house', x: -10, z: 10, w: 6, d: 5, rot: 0.5 },
  { kind: 'inn', x: 12, z: -6, w: 6, d: 7, rot: 2.4 },
  { kind: 'chapel', x: -16, z: -8, w: 5, d: 7, rot: 0.9 },
];

export const WELL_POS = { x: 0, z: 2, r: 1.5 };
export const STALL = { x: -8.5, z: 3, rot: Math.PI / 2, r: 1.7 };
export const MINE = { x: -88, z: -68, rot: 0.8 };
export const DOCK = { x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } };
export const TENTS: { x: number; z: number; rot: number; scale: number }[] = [
  { x: 62, z: -61, rot: 0.4, scale: 1 },
  { x: 69, z: -69, rot: 2.1, scale: 1 },
  { x: 88, z: -86, rot: 1.2, scale: 1.3 },
  { x: 95, z: -94, rot: -0.6, scale: 1 },
];
export const BANDIT_CRATES: [number, number][] = [[60, -63], [66, -67], [87, -88], [93, -90], [70, -72]];
export const CAMPFIRES: [number, number][] = [[3, -4], [65, -65], [90, -90], [-80, -60], [-61, 56]];
export const MURLOC_HUTS: [number, number][] = [[-73, 59], [-78, 54], [-69, 55]];
export const RUINS = { x: 80, z: 78, ringR: 7, columns: 7 };

// rotate a local offset by a three.js rotation.y angle
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

// ---------------------------------------------------------------------------
// Collider sets
// ---------------------------------------------------------------------------

function staticWorldColliders(seed: number): Collider[] {
  const out: Collider[] = [];

  for (const b of BUILDINGS) {
    out.push({ type: 'obb', x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot });
  }
  out.push({ type: 'circle', x: WELL_POS.x, z: WELL_POS.z, r: WELL_POS.r });
  out.push({ type: 'circle', x: STALL.x, z: STALL.z, r: STALL.r });

  // mine: mound behind the timber portal
  const mound = rotY(0, -3.4, MINE.rot);
  out.push({ type: 'circle', x: MINE.x + mound.x, z: MINE.z + mound.z, r: 5 });

  // dock hut
  const hut = rotY(DOCK.hutLocal.x, DOCK.hutLocal.z, DOCK.rot);
  out.push({ type: 'obb', x: DOCK.x + hut.x, z: DOCK.z + hut.z, hw: DOCK.hutLocal.hw, hd: DOCK.hutLocal.hd, rot: DOCK.rot });

  for (const t of TENTS) out.push({ type: 'circle', x: t.x, z: t.z, r: 1.5 * t.scale });
  for (const [x, z] of BANDIT_CRATES) out.push({ type: 'circle', x, z, r: 0.65 });
  for (const [x, z] of CAMPFIRES) out.push({ type: 'circle', x, z, r: 0.85 });
  for (const [x, z] of MURLOC_HUTS) out.push({ type: 'circle', x, z, r: 1.1 });
  for (let i = 0; i < RUINS.columns; i++) {
    const ang = (i / RUINS.columns) * Math.PI * 2;
    out.push({ type: 'circle', x: RUINS.x + Math.sin(ang) * RUINS.ringR, z: RUINS.z + Math.cos(ang) * RUINS.ringR, r: 0.6 });
  }

  // trees & large rocks from the deterministic decoration field
  for (const d of generateDecorations(seed)) {
    if (d.kind === 'rock') {
      if (d.scale >= 0.8) out.push({ type: 'circle', x: d.x, z: d.z, r: 0.7 * d.scale });
    } else {
      // tree trunks only — canopies don't block
      out.push({ type: 'circle', x: d.x, z: d.z, r: 0.55 * d.scale });
    }
  }
  return out;
}

// The Hollow Crypt interior, in instance-local coordinates.
// Mirrors Renderer.buildCrypt geometry.
const CRYPT_COLLIDERS: Collider[] = (() => {
  const out: Collider[] = [];
  out.push({ type: 'obb', x: -23, z: 52, hw: 1, hd: 61, rot: 0 }); // side walls
  out.push({ type: 'obb', x: 23, z: 52, hw: 1, hd: 61, rot: 0 });
  out.push({ type: 'obb', x: 0, z: 112, hw: 24, hd: 1, rot: 0 }); // back wall
  out.push({ type: 'obb', x: 0, z: -9, hw: 24, hd: 1, rot: 0 }); // front wall
  for (let z = 10; z <= 100; z += 15) {
    for (const sx of [-14, 14]) out.push({ type: 'circle', x: sx, z, r: 1.0 });
  }
  for (let z = 16; z <= 92; z += 19) {
    for (const sx of [-19, 19]) out.push({ type: 'obb', x: sx, z, hw: 1.1, hd: 2.1, rot: 0 });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Spatial grid + movement resolution
// ---------------------------------------------------------------------------

const GRID_CELL = 16;
const MAX_BODY_RADIUS = 0.8; // largest mover we resolve for

interface ColliderGrid {
  cells: Map<string, Collider[]>;
}

const gridCache = new Map<number, ColliderGrid>();

function colliderBounds(c: Collider): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  const ext = Math.hypot(c.hw, c.hd);
  return { minX: c.x - ext, maxX: c.x + ext, minZ: c.z - ext, maxZ: c.z + ext };
}

function gridFor(seed: number): ColliderGrid {
  let grid = gridCache.get(seed);
  if (grid) return grid;
  grid = { cells: new Map() };
  for (const c of staticWorldColliders(seed)) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx + ',' + gz;
        const list = grid.cells.get(key);
        if (list) list.push(c);
        else grid.cells.set(key, [c]);
      }
    }
  }
  gridCache.set(seed, grid);
  return grid;
}

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
function pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
  if (c.type === 'circle') {
    const dx = x - c.x, dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z };
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  // OBB: into local frame
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r, ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const pushX = ex - Math.abs(local.x);
  const pushZ = ez - Math.abs(local.z);
  const out = { x: local.x, z: local.z };
  if (pushX < pushZ) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

function resolveAgainst(list: Collider[], x: number, z: number, r: number): { x: number; z: number } {
  let px = x, pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      const res = pushOut(c, px, pz, r);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

function instanceLocal(x: number, z: number): { slot: number; ox: number; oz: number } {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(i);
    const d = Math.abs(z - o.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  const o = instanceOrigin(best);
  return { slot: best, ox: o.x, oz: o.z };
}

// Resolve a movement destination against all static geometry. Movers slide
// along obstacles. `r` is the body radius.
export function resolvePosition(seed: number, x: number, z: number, r = 0.5): { x: number; z: number } {
  if (x > DUNGEON_X_THRESHOLD) {
    const { ox, oz } = instanceLocal(x, z);
    const local = resolveAgainst(CRYPT_COLLIDERS, x - ox, z - oz, r);
    return { x: local.x + ox, z: local.z + oz };
  }
  const grid = gridFor(seed);
  const key = Math.floor(x / GRID_CELL) + ',' + Math.floor(z / GRID_CELL);
  const list = grid.cells.get(key);
  if (!list) return { x, z };
  return resolveAgainst(list, x, z, r);
}

export function isBlocked(seed: number, x: number, z: number, r = 0.5): boolean {
  const res = resolvePosition(seed, x, z, r);
  return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
}
