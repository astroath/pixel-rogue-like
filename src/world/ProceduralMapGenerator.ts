import { BaseType, TileMap } from './TileMap';

export interface MapGenerationConfig {
  seed?: number;
  obstacleDensity: number;
  blobCountMin: number;
  blobCountMax: number;
  blobRadiusMin: number;
  blobRadiusMax: number;
  blobEdgeJitter: number;
  safeZoneRadius: number;
  carveLoopCount: number;
  carveLoopRadius: number;
  carveThickness: number;
  requiredConnectedRatio: number;
  maxAttempts: number;
  spawn: { x: number; y: number };
  edgeJaggedThicknessMin: number;
  edgeJaggedThicknessMax: number;
  edgeJaggedStep: number;
}

export interface MapObstacleBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapGenerationResult {
  seed: number;
  safeZoneRadius: number;
  spawn: { x: number; y: number };
  obstacleBounds: MapObstacleBounds[];
  walkableTiles: { x: number; y: number }[];
  obstacleTiles: { x: number; y: number }[];
  spawnableTiles: { x: number; y: number }[];
  collisionGrid: Uint8Array;
  reachableRatio: number;
  walkableRatio: number;
}

const DEFAULT_CONFIG: MapGenerationConfig = {
  obstacleDensity: 0.18,
  blobCountMin: 5,
  blobCountMax: 11,
  blobRadiusMin: 10,
  blobRadiusMax: 32,
  blobEdgeJitter: 0.32,
  safeZoneRadius: 14,
  carveLoopCount: 2,
  carveLoopRadius: 26,
  carveThickness: 2,
  requiredConnectedRatio: 0.55,
  maxAttempts: 8,
  spawn: { x: 0, y: 0 },
  edgeJaggedThicknessMin: 2,
  edgeJaggedThicknessMax: 6,
  edgeJaggedStep: 1,
};

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    // Xorshift32 for speed and determinism.
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

export class ProceduralMapGenerator {
  private baseConfig: Partial<MapGenerationConfig>;

  constructor(baseConfig: Partial<MapGenerationConfig> = {}) {
    this.baseConfig = baseConfig;
  }

  generate(tileMap: TileMap, overrides: Partial<MapGenerationConfig> = {}): MapGenerationResult {
    const config = this.buildConfig(tileMap, overrides);
    let attemptSeed = config.seed ?? Math.floor(Math.random() * 0x7fffffff);

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      const seed = (attemptSeed + attempt * 1013904223) >>> 0;
      const rng = new SeededRng(seed || 1);
      const obstacleBounds: MapObstacleBounds[] = [];

      this.paintBase(tileMap);
      this.applyJaggedBorders(tileMap, rng, config);
      this.scatterBlobs(tileMap, rng, config, obstacleBounds);
      this.clearSafeZone(tileMap, config);
      this.carveLoops(tileMap, rng, config);
      this.reinforceOuterWall(tileMap);

      const reachable = this.countReachable(tileMap, config.spawn);
      const walkableCount = this.countWalkable(tileMap);
      const totalTiles = tileMap.width * tileMap.height;
      const reachableRatio = totalTiles > 0 ? reachable / totalTiles : 0;
      const walkableRatio = totalTiles > 0 ? walkableCount / totalTiles : 0;

      if (reachableRatio >= config.requiredConnectedRatio) {
        const metadata = this.extractMetadata(tileMap, config);
        return {
          seed,
          safeZoneRadius: config.safeZoneRadius,
          spawn: { ...config.spawn },
          obstacleBounds,
          reachableRatio,
          walkableRatio,
          ...metadata,
        };
      }
    }

    // Fallback to ensure we return something even if all attempts failed.
    const seed = attemptSeed >>> 0;
    const rng = new SeededRng(seed || 1);
    const obstacleBounds: MapObstacleBounds[] = [];
    this.paintBase(tileMap);
    this.scatterBlobs(tileMap, rng, config, obstacleBounds);
    this.clearSafeZone(tileMap, config);
    this.carveLoops(tileMap, rng, config);
    const metadata = this.extractMetadata(tileMap, config);
    return {
      seed,
      safeZoneRadius: config.safeZoneRadius,
      spawn: { ...config.spawn },
      obstacleBounds,
      reachableRatio: this.countReachable(tileMap, config.spawn) / (tileMap.width * tileMap.height),
      walkableRatio: this.countWalkable(tileMap) / (tileMap.width * tileMap.height),
      ...metadata,
    };
  }

  private buildConfig(tileMap: TileMap, overrides: Partial<MapGenerationConfig>): MapGenerationConfig {
    const spawn = overrides.spawn ?? this.baseConfig.spawn ?? { x: Math.floor(tileMap.width / 2), y: Math.floor(tileMap.height / 2) };
    return {
      ...DEFAULT_CONFIG,
      ...this.baseConfig,
      ...overrides,
      spawn,
    };
  }

  private paintBase(tileMap: TileMap): void {
    for (let y = 0; y < tileMap.height; y++) {
      for (let x = 0; x < tileMap.width; x++) {
        tileMap.setTile(x, y, BaseType.Floor);
      }
    }
  }

  private applyJaggedBorders(tileMap: TileMap, rng: SeededRng, config: MapGenerationConfig): void {
    const minT = Math.max(1, config.edgeJaggedThicknessMin);
    const maxT = Math.max(minT, config.edgeJaggedThicknessMax);
    const step = Math.max(1, config.edgeJaggedStep);

    let top = rng.int(minT, maxT);
    let bottom = rng.int(minT, maxT);
    for (let x = 0; x < tileMap.width; x++) {
      top = this.clampInt(top + rng.int(-step, step), minT, maxT);
      bottom = this.clampInt(bottom + rng.int(-step, step), minT, maxT);
      for (let y = 0; y < top; y++) {
        tileMap.setWallTile(x, y, 999, true);
      }
      for (let y = tileMap.height - bottom; y < tileMap.height; y++) {
        tileMap.setWallTile(x, y, 999, true);
      }
    }

    let left = rng.int(minT, maxT);
    let right = rng.int(minT, maxT);
    for (let y = 0; y < tileMap.height; y++) {
      left = this.clampInt(left + rng.int(-step, step), minT, maxT);
      right = this.clampInt(right + rng.int(-step, step), minT, maxT);
      for (let x = 0; x < left; x++) {
        tileMap.setWallTile(x, y, 999, true);
      }
      for (let x = tileMap.width - right; x < tileMap.width; x++) {
        tileMap.setWallTile(x, y, 999, true);
      }
    }
  }

  private scatterBlobs(tileMap: TileMap, rng: SeededRng, config: MapGenerationConfig, bounds: MapObstacleBounds[]): void {
    const totalTiles = tileMap.width * tileMap.height;
    const targetObstacleTiles = Math.floor(totalTiles * config.obstacleDensity);
    let painted = 0;

    const blobTargetCount = rng.int(config.blobCountMin, config.blobCountMax);
    for (let i = 0; i < blobTargetCount || painted < targetObstacleTiles * 0.85; i++) {
      const radius = rng.int(config.blobRadiusMin, config.blobRadiusMax);
      const cx = rng.int(radius + 2, Math.max(radius + 2, tileMap.width - radius - 2));
      const cy = rng.int(radius + 2, Math.max(radius + 2, tileMap.height - radius - 2));
      const blobPainted = this.paintBlob(tileMap, cx, cy, radius, config.blobEdgeJitter, rng);
      if (blobPainted > 0) {
        painted += blobPainted;
        bounds.push({
          x: Math.max(0, cx - radius),
          y: Math.max(0, cy - radius),
          w: Math.min(tileMap.width - 1, cx + radius) - Math.max(0, cx - radius) + 1,
          h: Math.min(tileMap.height - 1, cy + radius) - Math.max(0, cy - radius) + 1,
        });
      }
    }
  }

  private paintBlob(tileMap: TileMap, cx: number, cy: number, radius: number, jitter: number, rng: SeededRng): number {
    const r2 = radius * radius;
    let painted = 0;
    const minX = Math.max(0, cx - radius - 1);
    const maxX = Math.min(tileMap.width - 1, cx + radius + 1);
    const minY = Math.max(0, cy - radius - 1);
    const maxY = Math.min(tileMap.height - 1, cy + radius + 1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;

        const dist = Math.sqrt(dist2);
        const normalized = dist / radius;
        const threshold = 1 + (rng.next() - 0.5) * jitter;
        if (normalized <= threshold) {
          const before = tileMap.getTile(x, y);
          if (before?.base !== BaseType.Wall) {
            tileMap.setWallTile(x, y, 3, false);
            painted++;
          }
        }
      }
    }

    return painted;
  }

  private clearSafeZone(tileMap: TileMap, config: MapGenerationConfig): void {
    const { x: sx, y: sy } = config.spawn;
    const r = config.safeZoneRadius;
    const r2 = r * r;
    for (let y = Math.max(0, sy - r); y <= Math.min(tileMap.height - 1, sy + r); y++) {
      for (let x = Math.max(0, sx - r); x <= Math.min(tileMap.width - 1, sx + r); x++) {
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy <= r2) {
          tileMap.setTile(x, y, BaseType.Floor);
        }
      }
    }
  }

  private carveLoops(tileMap: TileMap, rng: SeededRng, config: MapGenerationConfig): void {
    for (let i = 0; i < config.carveLoopCount; i++) {
      const jitter = rng.float(-config.carveLoopRadius * 0.15, config.carveLoopRadius * 0.15);
      const radius = Math.max(4, config.carveLoopRadius + jitter + i * 2);
      this.carveLoop(tileMap, config.spawn, radius, config.carveThickness, rng);
    }
  }

  private reinforceOuterWall(tileMap: TileMap): void {
    const w = tileMap.width;
    const h = tileMap.height;
    for (let x = 0; x < w; x++) {
      tileMap.setWallTile(x, 0, 999, true);
      tileMap.setWallTile(x, h - 1, 999, true);
    }
    for (let y = 0; y < h; y++) {
      tileMap.setWallTile(0, y, 999, true);
      tileMap.setWallTile(w - 1, y, 999, true);
    }
  }

  private carveLoop(tileMap: TileMap, center: { x: number; y: number }, radius: number, thickness: number, rng: SeededRng): void {
    const steps = Math.max(24, Math.floor(radius * 0.75));
    let prevX = Math.floor(center.x + Math.cos(0) * radius);
    let prevY = Math.floor(center.y + Math.sin(0) * radius);

    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const jitter = rng.float(-radius * 0.08, radius * 0.08);
      const r = radius + jitter;
      const x = Math.floor(center.x + Math.cos(t) * r);
      const y = Math.floor(center.y + Math.sin(t) * r);
      this.carveLine(tileMap, prevX, prevY, x, y, thickness);
      prevX = x;
      prevY = y;
    }
  }

  private carveLine(tileMap: TileMap, x0: number, y0: number, x1: number, y1: number, thickness: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;
    while (true) {
      this.carveDisk(tileMap, x, y, thickness);
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  private carveDisk(tileMap: TileMap, cx: number, cy: number, radius: number): void {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        if (x < 0 || y < 0 || x >= tileMap.width || y >= tileMap.height) continue;
        tileMap.setTile(x, y, BaseType.Floor);
      }
    }
  }

  private countReachable(tileMap: TileMap, spawn: { x: number; y: number }): number {
    if (!tileMap.isWalkable(spawn.x, spawn.y)) return 0;
    const visited = new Uint8Array(tileMap.width * tileMap.height);
    const queue: { x: number; y: number }[] = [{ x: spawn.x, y: spawn.y }];
    const index = (x: number, y: number) => y * tileMap.width + x;
    visited[index(spawn.x, spawn.y)] = 1;
    let count = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      count++;
      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];

      for (const n of neighbors) {
        if (n.x < 0 || n.y < 0 || n.x >= tileMap.width || n.y >= tileMap.height) continue;
        const idx = index(n.x, n.y);
        if (visited[idx]) continue;
        if (!tileMap.isWalkable(n.x, n.y)) continue;
        visited[idx] = 1;
        queue.push(n);
      }
    }

    return count;
  }

  private countWalkable(tileMap: TileMap): number {
    let count = 0;
    for (let y = 0; y < tileMap.height; y++) {
      for (let x = 0; x < tileMap.width; x++) {
        if (tileMap.isWalkable(x, y)) count++;
      }
    }
    return count;
  }

  private extractMetadata(tileMap: TileMap, config: MapGenerationConfig): Omit<MapGenerationResult, 'seed' | 'safeZoneRadius' | 'spawn' | 'obstacleBounds' | 'reachableRatio' | 'walkableRatio'> {
    const walkableTiles: { x: number; y: number }[] = [];
    const obstacleTiles: { x: number; y: number }[] = [];
    const spawnableTiles: { x: number; y: number }[] = [];
    const collisionGrid = new Uint8Array(tileMap.width * tileMap.height);
    const safeR2 = config.safeZoneRadius * config.safeZoneRadius;
    const spawn = config.spawn;

    for (let y = 0; y < tileMap.height; y++) {
      for (let x = 0; x < tileMap.width; x++) {
        const idx = y * tileMap.width + x;
        const walkable = tileMap.isWalkable(x, y);
        collisionGrid[idx] = walkable ? 0 : 1;
        if (walkable) {
          walkableTiles.push({ x, y });
          const dx = x - spawn.x;
          const dy = y - spawn.y;
          if (dx * dx + dy * dy > safeR2 + 9 && this.hasClearNeighbors(tileMap, x, y)) {
            spawnableTiles.push({ x, y });
          }
        } else {
          obstacleTiles.push({ x, y });
        }
      }
    }

    return { walkableTiles, obstacleTiles, collisionGrid, spawnableTiles };
  }

  private hasClearNeighbors(tileMap: TileMap, x: number, y: number): boolean {
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    return neighbors.every((n) => n.x >= 0 && n.y >= 0 && n.x < tileMap.width && n.y < tileMap.height && tileMap.isWalkable(n.x, n.y));
  }

  private clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
