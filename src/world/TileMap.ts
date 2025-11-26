export type TileIndex = number;

export const BaseType = {
  Dirt: 1,
  Stone: 2,
  Floor: 3,
  Wall: 4,
  Water: 5,
  Void: 6,
} as const;
export type BaseType = typeof BaseType[keyof typeof BaseType];

export const DecorOverlay = {
  None: 0,
  Grass: 1,
  Blood: 2,
  Crack: 3,
} as const;
export type DecorOverlay = typeof DecorOverlay[keyof typeof DecorOverlay];

export const EffectOverlay = {
  None: 0,
  Fire: 1,
  Smoke: 2,
  Slime: 3,
} as const;
export type EffectOverlay = typeof EffectOverlay[keyof typeof EffectOverlay];

export const FlagBits = {
  Walkable: 1 << 0,
  Blocked: 1 << 1,
  LosBlock: 1 << 2,
} as const;

export const StateFlagBits = {
  Burning: 1 << 0,
  Poisoned: 1 << 1,
  Wet: 1 << 2,
  Cracked: 1 << 3,
} as const;

export const TileTag = {
  Walkable: 1,
  Blocked: 2,
  Liquid: 3,
  Solid: 4,
} as const;
export type TileTag = typeof TileTag[keyof typeof TileTag];

export interface TileSnapshot {
  base: BaseType;
  flags: number;
  decor: DecorOverlay;
  effect: EffectOverlay;
  state: number;
  hp: number;
  durability: number;
  usage: number;
  occupants: any[];
}

const SHIFT_FLAGS = 8;
const SHIFT_DECOR = 16;
const SHIFT_EFFECT = 20;
const SHIFT_STATE = 24;

const MASK_BASE = 0xff >>> 0;
const MASK_FLAGS = (0xff << SHIFT_FLAGS) >>> 0;
const MASK_DECOR = (0x0f << SHIFT_DECOR) >>> 0;
const MASK_EFFECT = (0x0f << SHIFT_EFFECT) >>> 0;
const MASK_STATE = (0x0f << SHIFT_STATE) >>> 0;

export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly virtualPixelScale: number;

  private mask: Uint32Array;
  private hp: Int16Array;
  private durability: Uint8Array;
  private usage: Uint16Array;
  private overlayTTL: Uint16Array;
  private occupants: any[][];
  private dirtyTiles: TileIndex[] = [];

  constructor(widthTiles: number, heightTiles: number, virtualPixelScale = 4) {
    this.width = widthTiles;
    this.height = heightTiles;
    this.virtualPixelScale = virtualPixelScale;
    const count = this.width * this.height;
    this.mask = new Uint32Array(count);
    this.hp = new Int16Array(count);
    this.durability = new Uint8Array(count);
    this.usage = new Uint16Array(count);
    this.overlayTTL = new Uint16Array(count);
    this.occupants = new Array(count);
    for (let i = 0; i < count; i++) this.occupants[i] = [];
  }

  initFromNoise(density = 0.5): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const r = Math.random();
        let base: BaseType = BaseType.Floor;
        let flags: number = FlagBits.Walkable;
        if (r < 0.08) {
          base = BaseType.Wall;
          flags = FlagBits.Blocked | FlagBits.LosBlock;
        } else if (r < 0.12) {
          base = BaseType.Water;
          flags = 0;
        } else if (r < 0.22) {
          base = BaseType.Stone;
          flags = FlagBits.Walkable;
        } else if (r < density) {
          base = BaseType.Dirt;
          flags = FlagBits.Walkable;
        }
        const idx = this.index(x, y);
        this.mask[idx] = this.encode(base, flags, DecorOverlay.None, EffectOverlay.None, 0);
        this.hp[idx] = 0;
        this.durability[idx] = 0;
        this.usage[idx] = 0;
        this.overlayTTL[idx] = 0;
      }
    }
  }

  getTile(x: number, y: number): TileSnapshot | null {
    if (!this.inBounds(x, y)) return null;
    const idx = this.index(x, y);
    const m = this.mask[idx];
    return {
      base: this.decodeBase(m),
      flags: this.decodeFlags(m),
      decor: this.decodeDecor(m),
      effect: this.decodeEffect(m),
      state: this.decodeState(m),
      hp: this.hp[idx],
      durability: this.durability[idx],
      usage: this.usage[idx],
      occupants: this.occupants[idx],
    };
  }

  setTile(x: number, y: number, base: BaseType): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const prev = this.mask[idx];
    const prevBase = this.decodeBase(prev);
    const flags = this.defaultFlagsForBase(base);
    const decor = this.decodeDecor(prev);
    const effect = this.decodeEffect(prev);
    const state = this.decodeState(prev);
    this.mask[idx] = this.encode(base, flags, decor, effect, state);
    if (base !== prevBase) this.markDirty(idx);
  }

  setWallTile(x: number, y: number, hitPoints = 3, indestructible = false): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const prev = this.mask[idx];
    const prevBase = this.decodeBase(prev);
    const decor = this.decodeDecor(prev);
    const effect = this.decodeEffect(prev);
    const state = this.decodeState(prev);
    const flags = FlagBits.Blocked | FlagBits.LosBlock;
    this.mask[idx] = this.encode(BaseType.Wall, flags, decor, effect, state);
    this.hp[idx] = indestructible ? 32767 : hitPoints;
    this.durability[idx] = indestructible ? 255 : hitPoints;
    if (prevBase !== BaseType.Wall) this.markDirty(idx);
  }

  damageWallTile(x: number, y: number, amount: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const idx = this.index(x, y);
    const base = this.decodeBase(this.mask[idx]);
    if (base !== BaseType.Wall) return false;
    if (this.durability[idx] >= 200) return false; // treat as indestructible

    this.hp[idx] = Math.max(-32768, Math.min(32767, this.hp[idx] - amount));
    if (this.hp[idx] <= 0) {
      this.setTile(x, y, BaseType.Floor);
      this.hp[idx] = 0;
      this.durability[idx] = 0;
      this.markDirty(idx);
      return true;
    }
    return false;
  }

  consumeDirtyTiles(): { x: number; y: number }[] {
    const coords: { x: number; y: number }[] = [];
    for (const idx of this.dirtyTiles) {
      const y = Math.floor(idx / this.width);
      const x = idx - y * this.width;
      coords.push({ x, y });
    }
    this.dirtyTiles.length = 0;
    return coords;
  }

  private markDirty(idx: TileIndex): void {
    this.dirtyTiles.push(idx);
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const flags = this.decodeFlags(this.mask[this.index(x, y)]);
    return (flags & FlagBits.Walkable) !== 0;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const flags = this.decodeFlags(this.mask[this.index(x, y)]);
    return (flags & FlagBits.Blocked) !== 0;
  }

  setWalkable(x: number, y: number, walkable: boolean): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    let m = this.mask[idx];
    let flags = this.decodeFlags(m);
    if (walkable) flags |= FlagBits.Walkable; else flags &= ~FlagBits.Walkable;
    this.mask[idx] = this.encode(this.decodeBase(m), flags, this.decodeDecor(m), this.decodeEffect(m), this.decodeState(m));
  }

  setBlocked(x: number, y: number, blocked: boolean): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    let m = this.mask[idx];
    let flags = this.decodeFlags(m);
    if (blocked) flags |= FlagBits.Blocked; else flags &= ~FlagBits.Blocked;
    this.mask[idx] = this.encode(this.decodeBase(m), flags, this.decodeDecor(m), this.decodeEffect(m), this.decodeState(m));
  }

  getNeighbors(x: number, y: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (this.inBounds(nx, ny)) out.push({ x: nx, y: ny });
      }
    }
    return out;
  }

  getAreaRect(x: number, y: number, w: number, h: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (this.inBounds(xx, yy)) out.push({ x: xx, y: yy });
      }
    }
    return out;
  }

  getAreaRadius(x: number, y: number, r: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const r2 = r * r;
    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx + dy * dy <= r2 && this.inBounds(xx, yy)) out.push({ x: xx, y: yy });
      }
    }
    return out;
  }

  tileHasTag(tile: TileSnapshot, tag: TileTag): boolean {
    if (tag === TileTag.Walkable) return (tile.flags & FlagBits.Walkable) !== 0;
    if (tag === TileTag.Blocked) return (tile.flags & FlagBits.Blocked) !== 0;
    if (tag === TileTag.Liquid) return tile.base === BaseType.Water;
    if (tag === TileTag.Solid) return tile.base === BaseType.Wall || tile.base === BaseType.Stone;
    return false;
  }

  setDecorOverlay(x: number, y: number, decor: DecorOverlay): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const m = this.mask[idx];
    this.mask[idx] = this.encode(this.decodeBase(m), this.decodeFlags(m), decor, this.decodeEffect(m), this.decodeState(m));
  }

  setEffectOverlay(x: number, y: number, effect: EffectOverlay, ttl = 0): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const m = this.mask[idx];
    this.mask[idx] = this.encode(this.decodeBase(m), this.decodeFlags(m), this.decodeDecor(m), effect, this.decodeState(m));
    this.overlayTTL[idx] = ttl;
  }

  applyDamage(x: number, y: number, amount: number): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    this.hp[idx] = Math.max(-32768, Math.min(32767, this.hp[idx] - amount));
  }

  setStateFlag(x: number, y: number, flag: number, enabled: boolean): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const m = this.mask[idx];
    let state = this.decodeState(m);
    if (enabled) state |= flag; else state &= ~flag;
    this.mask[idx] = this.encode(this.decodeBase(m), this.decodeFlags(m), this.decodeDecor(m), this.decodeEffect(m), state);
  }

  getCost(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Infinity;
    const base = this.decodeBase(this.mask[this.index(x, y)]);
    if (base === BaseType.Water) return 4;
    if (base === BaseType.Dirt) return 1;
    if (base === BaseType.Stone) return 2;
    if (base === BaseType.Floor) return 1;
    if (base === BaseType.Wall) return Infinity;
    return 1;
  }

  addOccupant(x: number, y: number, object: any): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    this.occupants[idx].push(object);
  }

  removeOccupant(x: number, y: number, object: any): void {
    if (!this.inBounds(x, y)) return;
    const idx = this.index(x, y);
    const arr = this.occupants[idx];
    const i = arr.indexOf(object);
    if (i >= 0) arr.splice(i, 1);
  }

  getOccupants(x: number, y: number): any[] {
    if (!this.inBounds(x, y)) return [];
    return this.occupants[this.index(x, y)];
  }

  tick(deltaMs: number): void {
    const count = this.width * this.height;
    for (let i = 0; i < count; i++) {
      if (this.overlayTTL[i] > 0) {
        const d = Math.min(this.overlayTTL[i], deltaMs);
        this.overlayTTL[i] -= d;
        if (this.overlayTTL[i] === 0) {
          const m = this.mask[i];
          const base = this.decodeBase(m);
          const flags = this.decodeFlags(m);
          const decor = this.decodeDecor(m);
          const state = this.decodeState(m);
          this.mask[i] = this.encode(base, flags, decor, EffectOverlay.None, state);
        }
      }
    }
  }

  getPixelColorForTile(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0x000000;
    const m = this.mask[this.index(x, y)];
    const base = this.decodeBase(m);
    const decor = this.decodeDecor(m);
    const effect = this.decodeEffect(m);
    let color = this.baseColor(base);
    if (decor === DecorOverlay.Grass) color = this.mix(color, 0x2a7f2a, 0.25);
    else if (decor === DecorOverlay.Blood) color = this.mix(color, 0x7f1a1a, 0.35);
    else if (decor === DecorOverlay.Crack) color = this.mix(color, 0x2a2a2a, 0.2);
    if (effect === EffectOverlay.Fire) color = this.mix(color, 0xff8c00, 0.5);
    else if (effect === EffectOverlay.Smoke) color = this.mix(color, 0x555555, 0.3);
    else if (effect === EffectOverlay.Slime) color = this.mix(color, 0x5fd35f, 0.4);
    return color >>> 0;
  }

  private baseColor(base: BaseType): number {
    if (base === BaseType.Dirt) return 0x5a3b1e;
    if (base === BaseType.Stone) return 0x777777;
    if (base === BaseType.Floor) return 0x444444;
    if (base === BaseType.Wall) return 0x2a2a2a;
    if (base === BaseType.Water) return 0x2e6fd5;
    return 0x000000;
  }

  private mix(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    const r = Math.floor(ar + (br - ar) * t) & 0xff;
    const g = Math.floor(ag + (bg - ag) * t) & 0xff;
    const bl = Math.floor(ab + (bb - ab) * t) & 0xff;
    return (r << 16) | (g << 8) | bl;
  }

  private defaultFlagsForBase(base: BaseType): number {
    if (base === BaseType.Wall) return FlagBits.Blocked | FlagBits.LosBlock;
    if (base === BaseType.Water) return 0;
    return FlagBits.Walkable;
  }

  private encode(base: BaseType, flags: number, decor: DecorOverlay, effect: EffectOverlay, state: number): number {
    return (
      (base & MASK_BASE) |
      ((flags << SHIFT_FLAGS) & MASK_FLAGS) |
      ((decor << SHIFT_DECOR) & MASK_DECOR) |
      ((effect << SHIFT_EFFECT) & MASK_EFFECT) |
      ((state << SHIFT_STATE) & MASK_STATE)
    ) >>> 0;
  }

  private decodeBase(m: number): BaseType {
    return (m & MASK_BASE) as BaseType;
  }

  private decodeFlags(m: number): number {
    return (m & MASK_FLAGS) >>> SHIFT_FLAGS;
  }

  private decodeDecor(m: number): DecorOverlay {
    return ((m & MASK_DECOR) >>> SHIFT_DECOR) as DecorOverlay;
  }

  private decodeEffect(m: number): EffectOverlay {
    return ((m & MASK_EFFECT) >>> SHIFT_EFFECT) as EffectOverlay;
  }

  private decodeState(m: number): number {
    return (m & MASK_STATE) >>> SHIFT_STATE;
  }

  private index(x: number, y: number): TileIndex {
    return y * this.width + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
}
