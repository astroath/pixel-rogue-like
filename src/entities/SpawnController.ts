import { Entity } from "./Entity";
import { EntityManager } from "./EntityManager";
import { TransformComponent } from "./components/TransformComponent";
import { HealthComponent } from "./components/HealthComponent";
import { CollisionComponent } from "./components/CollisionComponent";
import { TileMap } from "../world/TileMap";
import { EnemyInfoComponent } from "./components/EnemyInfoComponent";
import { AIComponent, type AIBehaviorConfig } from "./components/AIComponent";
import { AttackComponent } from "./components/AttackComponent";

export type SpawnMode = "world" | "around-player" | "tile";

export interface EnemyBaseStats {
  health: number;
  damage: number;
  speed: number;
}

export interface EnemyTypeConfig {
  type: string;
  baseSize: number;
  sizeVariance: number;
  spawnWeight: number;
  baseStats: EnemyBaseStats;
  xpReward?: number;
}

export interface SpawnControllerConfig {
  initialSpawnCount: number;
  spawnIntervalMs: number;
  intervalSpawnCount: number;
  maxEnemies: number;
  spawnRadiusMin: number;
  spawnRadiusMax: number;
  spawnMode: SpawnMode;
  useWeightedSpawns: boolean;
  useTileMapSpawns: boolean;
  allowSizeVariance: boolean;
  debugLogBatches: boolean;
}

export interface SpawnControllerOptions {
  worldWidth: number;
  worldHeight: number;
  tileSize: number;
  tileMap?: TileMap;
  getPlayer?: () => Entity | null;
  registry?: EnemyTypeConfig[];
  config?: Partial<SpawnControllerConfig>;
  onEnemyAttack?: (enemy: Entity, dirX: number, dirY: number) => void;
  onEnemySpawn?: (enemy: Entity, type: EnemyTypeConfig) => void;
}

const DEFAULT_CONFIG: SpawnControllerConfig = {
  initialSpawnCount: 100,
  spawnIntervalMs: 0,
  intervalSpawnCount: 5,
  maxEnemies: 300,
  spawnRadiusMin: 96,
  spawnRadiusMax: 168,
  spawnMode: "around-player",
  useWeightedSpawns: true,
  useTileMapSpawns: false,
  allowSizeVariance: true,
  debugLogBatches: false,
};

const DEFAULT_REGISTRY: EnemyTypeConfig[] = [
  {
    type: "SmallChaser",
    baseSize: 1.0,
    sizeVariance: 0.2,
    spawnWeight: 60,
    baseStats: { health: 10, damage: 5, speed: 1.5 },
    xpReward: 5,
  },
  {
    type: "MediumChaser",
    baseSize: 1.4,
    sizeVariance: 0.15,
    spawnWeight: 25,
    baseStats: { health: 20, damage: 8, speed: 1.7 },
    xpReward: 9,
  },
  {
    type: "RangedShooter",
    baseSize: 1.2,
    sizeVariance: 0.15,
    spawnWeight: 15,
    baseStats: { health: 22, damage: 7, speed: 1 },
    xpReward: 10,
  },
  {
    type: "Tank",
    baseSize: 2.2,
    sizeVariance: 0.2,
    spawnWeight: 6,
    baseStats: { health: 50, damage: 12, speed: 0.5 },
    xpReward: 20,
  },
];

const ENEMY_BEHAVIORS: Record<string, AIBehaviorConfig> = {
  SmallChaser: {
    behavior: "slime",
    aggressionRadius: 220,
    attackRange: 10,
    attackCooldown: 35,
    attackLockDuration: 12,
    moveSpeed: 0.7,
  },
  MediumChaser: {
    behavior: "slime",
    aggressionRadius: 240,
    attackRange: 14,
    attackCooldown: 45,
    attackLockDuration: 14,
    moveSpeed: 0.65,
  },
  Tank: {
    behavior: "brute",
    aggressionRadius: 240,
    attackRange: 16,
    attackCooldown: 80,
    attackWindup: 18,
    attackLockDuration: 16,
    recoveryDuration: 14,
    moveSpeed: 0.3,
  },
  RangedShooter: {
    behavior: "spitter",
    aggressionRadius: 260,
    attackRange: 250,
    idealRangeMin: 50,
    idealRangeMax: 100,
    retreatRange: 80,
    attackCooldown: 90,
    attackLockDuration: 10,
    moveSpeed: 0.5,
  },
};

export class SpawnController {
  private registry: EnemyTypeConfig[];
  private config: SpawnControllerConfig;
  private entityManager: EntityManager;
  private worldWidth: number;
  private worldHeight: number;
  private tileSize: number;
  private tileMap?: TileMap;
  private getPlayer?: () => Entity | null;
  private onEnemyAttack?: (enemy: Entity, dirX: number, dirY: number) => void;
  private onEnemySpawn?: (enemy: Entity, type: EnemyTypeConfig) => void;

  private spawnTimerMs = 0;
  private initialized = false;
  private weightTotal = 0;
  private spawnCounts: Record<string, number> = {};

  constructor(entityManager: EntityManager, options: SpawnControllerOptions) {
    this.entityManager = entityManager;
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.tileSize = options.tileSize;
    this.tileMap = options.tileMap;
    this.getPlayer = options.getPlayer;
    this.onEnemyAttack = options.onEnemyAttack;
    this.onEnemySpawn = options.onEnemySpawn;

    this.config = { ...DEFAULT_CONFIG, ...options.config };
    if (this.config.useTileMapSpawns) {
      this.config.spawnMode = "tile";
    }

    this.registry = options.registry ?? DEFAULT_REGISTRY;
    this.rebuildWeights();
  }

  public setRegistry(registry: EnemyTypeConfig[]): void {
    this.registry = [...registry];
    this.rebuildWeights();
  }

  public updateSpawnWeights(weights: Record<string, number>): void {
    this.registry = this.registry.map((entry) => ({
      ...entry,
      spawnWeight: weights[entry.type] ?? entry.spawnWeight,
    }));
    this.rebuildWeights();
  }

  public getRegistry(): EnemyTypeConfig[] {
    return [...this.registry];
  }

  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (this.config.initialSpawnCount > 0) {
      this.spawnBatch(this.config.initialSpawnCount);
    }
  }

  public update(dt: number): void {
    if (!this.initialized) this.initialize();

    if (this.config.spawnIntervalMs <= 0) return;

    // Pixi ticker deltaTime is ~1 at 60fps. Convert to milliseconds for interval handling.
    this.spawnTimerMs += dt * (1000 / 60);
    if (this.spawnTimerMs >= this.config.spawnIntervalMs) {
      this.spawnTimerMs = 0;
      this.spawnToFill();
    }
  }

  public spawnBatch(count: number): void {
    if (count <= 0) return;
    const currentEnemies = this.entityManager.enemies.length;
    const spaceAvailable = Math.max(0, this.config.maxEnemies - currentEnemies);
    const toSpawn =
      this.config.maxEnemies > 0 ? Math.min(count, spaceAvailable) : count;
    if (toSpawn <= 0) return;

    const batchCounts: Record<string, number> = {};
    for (let i = 0; i < toSpawn; i++) {
      const spawned = this.spawnOne();
      if (!spawned) break;
      batchCounts[spawned] = (batchCounts[spawned] ?? 0) + 1;
      this.spawnCounts[spawned] = (this.spawnCounts[spawned] ?? 0) + 1;
    }

    if (this.config.debugLogBatches) {
      const summary = Object.entries(batchCounts)
        .map(([type, qty]) => `${type}: ${qty}`)
        .join(", ");
      console.log(`[SpawnController] Spawned ${toSpawn} -> ${summary}`);
    }
  }

  public getSpawnCounts(): Record<string, number> {
    return { ...this.spawnCounts };
  }

  public spawnEnemyType(type: string, count: number = 1): number {
    const enemyType = this.registry.find((e) => e.type === type);
    if (!enemyType) {
      console.warn(`[SpawnController] Unknown enemy type: ${type}`);
      return 0;
    }
    const currentEnemies = this.entityManager.enemies.length;
    const spaceAvailable =
      this.config.maxEnemies > 0
        ? Math.max(0, this.config.maxEnemies - currentEnemies)
        : count;
    const toSpawn =
      this.config.maxEnemies > 0 ? Math.min(count, spaceAvailable) : count;
    if (toSpawn <= 0) return 0;

    let spawned = 0;
    for (let i = 0; i < toSpawn; i++) {
      const result = this.spawnOne(enemyType);
      if (!result) break;
      spawned += 1;
      this.spawnCounts[result] = (this.spawnCounts[result] ?? 0) + 1;
    }
    return spawned;
  }

  public getAvailableSlots(): number {
    if (this.config.maxEnemies <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(
      0,
      this.config.maxEnemies - this.entityManager.enemies.length
    );
  }

  private spawnToFill(): void {
    if (this.config.maxEnemies <= 0) {
      this.spawnBatch(this.config.intervalSpawnCount);
      return;
    }

    const currentEnemies = this.entityManager.enemies.length;
    if (currentEnemies >= this.config.maxEnemies) return;
    const deficit = this.config.maxEnemies - currentEnemies;
    const toSpawn = Math.min(this.config.intervalSpawnCount, deficit);
    this.spawnBatch(toSpawn);
  }

  private spawnOne(forcedType?: EnemyTypeConfig): string | null {
    const enemyType = forcedType ?? this.pickEnemyType();
    if (!enemyType) return null;

    const sizeScale = this.pickSizeScale(enemyType);
    const pixelSize = Math.max(1, Math.round(sizeScale * this.tileSize));
    const spawnPos = this.pickSpawnPosition();

    const enemy = this.entityManager.createEntity("enemy");
    const transform = new TransformComponent(
      spawnPos.x,
      spawnPos.y,
      pixelSize,
      pixelSize
    );
    transform.speed = enemyType.baseStats.speed;
    enemy.addComponent(transform);
    enemy.addComponent(new HealthComponent(enemyType.baseStats.health));
    enemy.addComponent(new CollisionComponent(pixelSize * 0.4));
    enemy.addComponent(
      new EnemyInfoComponent(enemyType.type, enemyType.xpReward ?? 1)
    );
    const aiConfig = this.createAIConfig(enemyType, pixelSize);
    const attackRange = aiConfig.attackRange ?? pixelSize;
    enemy.addComponent(
      new AttackComponent(
        enemyType.baseStats.damage,
        aiConfig.attackCooldown ?? 45,
        attackRange
      )
    );
    enemy.addComponent(new AIComponent(aiConfig));
    enemy.flags.hostile = true;
    this.onEnemySpawn?.(enemy, enemyType);

    return enemyType.type;
  }

  private pickEnemyType(): EnemyTypeConfig | null {
    if (this.registry.length === 0) {
      console.warn("Enemy registry is empty; cannot spawn enemies.");
      return null;
    }
    if (!this.config.useWeightedSpawns || this.weightTotal <= 0) {
      const idx = Math.floor(Math.random() * this.registry.length);
      return this.registry[idx];
    }

    const roll = Math.random() * this.weightTotal;
    let cumulative = 0;
    for (const entry of this.registry) {
      cumulative += Math.max(0, entry.spawnWeight);
      if (roll <= cumulative) return entry;
    }
    return this.registry[this.registry.length - 1];
  }

  private pickSizeScale(type: EnemyTypeConfig): number {
    if (!this.config.allowSizeVariance) return type.baseSize;
    const variance = (Math.random() * 2 - 1) * type.sizeVariance;
    return Math.max(0.1, type.baseSize + variance);
  }

  private createAIConfig(
    enemyType: EnemyTypeConfig,
    pixelSize: number
  ): AIBehaviorConfig {
    const base = ENEMY_BEHAVIORS[enemyType.type] ?? {
      behavior: "slime",
      aggressionRadius: 200,
      attackRange: Math.max(8, pixelSize),
      attackCooldown: 45,
    };
    const moveSpeed = base.moveSpeed ?? enemyType.baseStats.speed;

    return {
      ...base,
      attackRange: base.attackRange ?? Math.max(8, pixelSize),
      idealRangeMin:
        base.idealRangeMin ?? base.attackRange ?? Math.max(8, pixelSize),
      idealRangeMax:
        base.idealRangeMax ?? base.attackRange ?? Math.max(8, pixelSize * 2),
      moveSpeed,
      targetResolver: this.getPlayer,
      attackHandler: this.onEnemyAttack,
    };
  }

  private pickSpawnPosition(): { x: number; y: number } {
    switch (this.config.spawnMode) {
      case "around-player":
        return this.pickAroundPlayerPosition();
      case "tile":
        return this.pickTilePosition();
      case "world":
      default:
        return this.pickRandomWorldPosition();
    }
  }

  private pickRandomWorldPosition(): { x: number; y: number } {
    const x = Math.random() * (this.worldWidth - this.tileSize);
    const y = Math.random() * (this.worldHeight - this.tileSize);
    if (this.tileMap) {
      const tx = Math.floor(x / this.tileSize);
      const ty = Math.floor(y / this.tileSize);
      if (!this.tileMap.isWalkable(tx, ty)) {
        return this.pickTilePosition();
      }
    }
    return { x, y };
  }

  private pickAroundPlayerPosition(): { x: number; y: number } {
    const player = this.getPlayer?.();
    const transform = player?.getComponent<TransformComponent>("Transform");
    if (!transform) return this.pickRandomWorldPosition();

    const angle = Math.random() * Math.PI * 2;
    const rMin = this.config.spawnRadiusMin;
    const rMax = Math.max(rMin, this.config.spawnRadiusMax);
    const radius = rMin + Math.random() * (rMax - rMin);
    const x = transform.x + Math.cos(angle) * radius;
    const y = transform.y + Math.sin(angle) * radius;
    if (this.tileMap) {
      const tx = Math.floor(x / this.tileSize);
      const ty = Math.floor(y / this.tileSize);
      if (!this.tileMap.isWalkable(tx, ty)) {
        return this.pickTilePosition();
      }
    }
    return {
      x: this.clamp(x, 0, this.worldWidth - this.tileSize),
      y: this.clamp(y, 0, this.worldHeight - this.tileSize),
    };
  }

  private pickTilePosition(): { x: number; y: number } {
    if (!this.tileMap) return this.pickRandomWorldPosition();

    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const tx = Math.floor(Math.random() * this.tileMap.width);
      const ty = Math.floor(Math.random() * this.tileMap.height);
      if (this.tileMap.isWalkable(tx, ty)) {
        return { x: tx * this.tileSize, y: ty * this.tileSize };
      }
    }
    return this.pickRandomWorldPosition();
  }

  private rebuildWeights(): void {
    this.weightTotal = this.registry.reduce(
      (sum, entry) => sum + Math.max(0, entry.spawnWeight),
      0
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
