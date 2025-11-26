import { Entity } from "../Entity";
import { EntityManager } from "../EntityManager";
import { CollisionComponent } from "../components/CollisionComponent";
import { TransformComponent } from "../components/TransformComponent";
import { CombatSystem } from "../CombatSystem";
import { BaseType, TileMap } from "../../world/TileMap";

export interface ProjectileTypeDefinition {
  key: string;
  speed: number;
  damage: number;
  lifetime: number;
  sizeScale: number;
  collisionRadiusScale?: number;
  color?: number;
}

export interface ProjectileSystemConfig {
  poolSize: number;
  maxProjectiles: number;
  enableObjectPooling: boolean;
  reuseOldestWhenFull: boolean;
  enableFriendlyFire: boolean;
  defaultProjectileScale: number;
  defaultProjectileSpeed: number;
  maxLifetime: number;
}

export interface ProjectileSpawnOptions {
  overrideSpeed?: number;
  overrideDamage?: number;
  overrideLifetime?: number;
  sizeScale?: number;
  pierce?: number;
  color?: number;
  effects?: { type: string; params: Record<string, number> }[];
  chain?: number;
  chainRange?: number;
}

export interface Projectile {
  id: number;
  type: ProjectileTypeDefinition;
  source: Entity | null;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  damage: number;
  lifetime: number;
  size: number;
  radius: number;
  pierce: number;
  hitIds: Set<number>;
  effects: { type: string; params: Record<string, number> }[];
  remainingChains: number;
  chainRange: number;
  colorOverride?: number;
  isPlayerProjectile: boolean;
  isEnemyProjectile: boolean;
  active: boolean;
}

const DEFAULT_TYPES: ProjectileTypeDefinition[] = [
  {
    key: "playerBullet",
    speed: 3,
    damage: 11,
    lifetime: 180,
    sizeScale: 0.3,
    collisionRadiusScale: 0.45,
    color: 0xffffff,
  },
  {
    key: "enemySpit",
    speed: 3,
    damage: 6,
    lifetime: 150,
    sizeScale: 0.34,
    collisionRadiusScale: 0.48,
    color: 0x7dd3fc,
  },
  {
    key: "heavyBlob",
    speed: 2.5,
    damage: 14,
    lifetime: 240,
    sizeScale: 0.42,
    collisionRadiusScale: 0.5,
    color: 0xf472b6,
  },
];

const DEFAULT_CONFIG: ProjectileSystemConfig = {
  poolSize: 256,
  maxProjectiles: 256,
  enableObjectPooling: true,
  reuseOldestWhenFull: true,
  enableFriendlyFire: false,
  defaultProjectileScale: 0.3,
  defaultProjectileSpeed: 6,
  maxLifetime: 360,
};

export class ProjectileManager {
  private entityManager: EntityManager;
  private registry: Map<string, ProjectileTypeDefinition>;
  private config: ProjectileSystemConfig;
  private pool: Projectile[] = [];
  private active: Projectile[] = [];
  private nextId = 1;
  private combat?: CombatSystem;
  private tileMap?: TileMap;

  constructor(
    entityManager: EntityManager,
    options?: {
      registry?: ProjectileTypeDefinition[];
      config?: Partial<ProjectileSystemConfig>;
    }
  ) {
    this.entityManager = entityManager;
    this.registry = new Map(
      (options?.registry ?? DEFAULT_TYPES).map((t) => [t.key, { ...t }])
    );
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.preallocatePool(this.config.poolSize);
  }

  public getActiveProjectiles(): readonly Projectile[] {
    return this.active;
  }

  public setCombatSystem(combat: CombatSystem): void {
    this.combat = combat;
  }

  public setTileMap(tileMap: TileMap): void {
    this.tileMap = tileMap;
  }

  public spawn(
    key: string,
    position: { x: number; y: number },
    direction: { x: number; y: number },
    source: Entity | null,
    flags?: { isPlayerProjectile?: boolean; isEnemyProjectile?: boolean },
    options?: ProjectileSpawnOptions
  ): Projectile | null {
    const type = this.registry.get(key);
    if (!type) {
      console.warn(`[ProjectileManager] Unknown projectile type: ${key}`);
      return null;
    }

    const norm = this.normalize(direction.x, direction.y);
    if (norm.lenSq === 0) return null;

    const projectile = this.acquireProjectile();
    if (!projectile) return null;

    const sourceTransform =
      source?.getComponent<TransformComponent>("Transform");
    const shooterSize = sourceTransform
      ? Math.max(sourceTransform.width, sourceTransform.height)
      : 1;

    const sizeScale =
      options?.sizeScale ??
      type.sizeScale ??
      this.config.defaultProjectileScale;
    const colorOverride = options?.color;
    const effects = options?.effects ?? [];
    const chain = Math.max(0, options?.chain ?? 0);
    const chainRange = Math.max(0, options?.chainRange ?? 0);
    const speed =
      options?.overrideSpeed ??
      type.speed ??
      this.config.defaultProjectileSpeed;
    const damage = options?.overrideDamage ?? type.damage;
    const lifetime =
      options?.overrideLifetime ??
      Math.min(type.lifetime, this.config.maxLifetime);

    projectile.id = this.nextId++;
    projectile.type = type;
    projectile.source = source ?? null;
    projectile.x = position.x;
    projectile.y = position.y;
    projectile.dirX = norm.x;
    projectile.dirY = norm.y;
    projectile.speed = speed;
    projectile.damage = damage;
    projectile.lifetime = lifetime;
    projectile.size = shooterSize * sizeScale;
    projectile.radius = projectile.size * (type.collisionRadiusScale ?? 0.45);
    projectile.pierce = Math.max(0, options?.pierce ?? 0);
    projectile.effects = effects.map((e) => ({ ...e, params: { ...e.params } }));
    projectile.remainingChains = chain;
    projectile.chainRange = chainRange || 72;
    projectile.colorOverride = colorOverride;
    projectile.hitIds.clear();
    projectile.isPlayerProjectile = Boolean(flags?.isPlayerProjectile);
    projectile.isEnemyProjectile = Boolean(flags?.isEnemyProjectile);
    projectile.active = true;

    this.active.push(projectile);
    return projectile;
  }

  public update(dt: number): void {
    for (let i = 0; i < this.active.length;) {
      const p = this.active[i];
      if (!p.active) {
        this.releaseAtIndex(i);
        continue;
      }

      p.lifetime -= dt;
      if (p.lifetime <= 0) {
        p.active = false;
        this.releaseAtIndex(i);
        continue;
      }

      p.x += p.dirX * p.speed * dt;
      p.y += p.dirY * p.speed * dt;

      if (this.collidesWithWall(p)) {
        p.active = false;
        this.releaseAtIndex(i);
        continue;
      }

      const hit = p.isPlayerProjectile
        ? this.checkEnemyHit(p)
        : p.isEnemyProjectile
          ? this.checkPlayerHit(p)
          : false;

      if (hit || !p.active) {
        this.releaseAtIndex(i);
        continue;
      }

      i++;
    }
  }

  private checkEnemyHit(p: Projectile): boolean {
    let consumed = false;
    for (const enemy of this.entityManager.enemies) {
      if (!enemy.active) continue;
      if (p.hitIds.has(enemy.id)) continue;
      const transform = enemy.getComponent<TransformComponent>("Transform");
      if (!transform) continue;
      const radius = this.getCollisionRadius(enemy, transform);
      const centerX = transform.x + transform.width * 0.5;
      const centerY = transform.y + transform.height * 0.5;
      const dx = centerX - p.x;
      const dy = centerY - p.y;
      const distSq = dx * dx + dy * dy;
      const maxDist = p.radius + radius;
      if (distSq <= maxDist * maxDist) {
        if (this.combat) {
          this.combat.applyDamage(enemy, p.damage, p.source);
          this.applyEffects(enemy, p);
        }
        p.hitIds.add(enemy.id);
        const chained = this.handleChain(p, enemy);
        if (chained) {
          consumed = true;
          break;
        }
        if (p.pierce > 0) {
          p.pierce -= 1;
          continue;
        }
        p.active = false;
        consumed = true;
        break;
      }
    }
    return consumed;
  }

  private checkPlayerHit(p: Projectile): boolean {
    const player = this.entityManager.player;
    if (!player?.active) return false;
    const transform = player.getComponent<TransformComponent>("Transform");
    if (!transform) return false;
    const radius = this.getCollisionRadius(player, transform);
    const centerX = transform.x + transform.width * 0.5;
    const centerY = transform.y + transform.height * 0.5;
    const dx = centerX - p.x;
    const dy = centerY - p.y;
    const distSq = dx * dx + dy * dy;
    const maxDist = p.radius + radius;
    if (distSq <= maxDist * maxDist) {
      if (p.hitIds.has(player.id)) return false;
      if (this.config.enableFriendlyFire || p.isEnemyProjectile) {
        if (this.combat) {
          this.combat.applyDamage(player, p.damage, p.source);
          this.applyEffects(player, p);
        }
      }
      p.hitIds.add(player.id);
      p.active = false;
      return true;
    }
    return false;
  }

  private getCollisionRadius(
    entity: Entity,
    transform: TransformComponent
  ): number {
    const collision = entity.getComponent<CollisionComponent>("Collision");
    if (collision) return collision.radius;
    return Math.max(transform.width, transform.height) * 0.5;
  }

  private acquireProjectile(): Projectile | null {
    if (this.pool.length > 0) {
      const projectile = this.pool.pop()!;
      projectile.hitIds.clear();
      projectile.effects = [];
      projectile.remainingChains = 0;
      projectile.chainRange = 0;
      projectile.colorOverride = undefined;
      return projectile;
    }

    if (!this.config.enableObjectPooling) {
      return {
        id: 0,
        type: DEFAULT_TYPES[0],
        source: null,
        x: 0,
        y: 0,
        dirX: 0,
        dirY: 0,
        speed: 0,
        damage: 0,
        lifetime: 0,
        size: 0,
        radius: 0,
        pierce: 0,
        effects: [],
        remainingChains: 0,
        chainRange: 0,
        colorOverride: undefined,
        hitIds: new Set<number>(),
        isPlayerProjectile: false,
        isEnemyProjectile: false,
        active: false,
      };
    }

    if (this.active.length >= this.config.maxProjectiles) {
      if (!this.config.reuseOldestWhenFull) return null;
      const oldest = this.active.shift();
      if (oldest) {
        oldest.active = false;
        this.pool.push(oldest);
        return this.pool.pop()!;
      }
      return null;
    }

    const projectile: Projectile = {
      id: 0,
      type: DEFAULT_TYPES[0],
      source: null,
      x: 0,
      y: 0,
      dirX: 0,
      dirY: 0,
      speed: 0,
      damage: 0,
      lifetime: 0,
      size: 0,
      radius: 0,
      pierce: 0,
      effects: [],
      remainingChains: 0,
      chainRange: 0,
      colorOverride: undefined,
      hitIds: new Set<number>(),
      isPlayerProjectile: false,
      isEnemyProjectile: false,
      active: false,
    };
    return projectile;
  }

  private releaseAtIndex(index: number): void {
    const [removed] = this.active.splice(index, 1);
    removed.active = false;
    removed.hitIds.clear();
    removed.effects = [];
    removed.remainingChains = 0;
    removed.chainRange = 0;
    removed.colorOverride = undefined;
    if (this.config.enableObjectPooling) {
      this.pool.push(removed);
    }
  }

  private preallocatePool(count: number): void {
    for (let i = 0; i < count; i++) {
      this.pool.push({
        id: 0,
        type: DEFAULT_TYPES[0],
        source: null,
        x: 0,
        y: 0,
        dirX: 0,
        dirY: 0,
        speed: 0,
        damage: 0,
        lifetime: 0,
        size: 0,
        radius: 0,
        pierce: 0,
        effects: [],
        remainingChains: 0,
        chainRange: 0,
        colorOverride: undefined,
        hitIds: new Set<number>(),
        isPlayerProjectile: false,
        isEnemyProjectile: false,
        active: false,
      });
    }
  }

  private normalize(
    x: number,
    y: number
  ): { x: number; y: number; lenSq: number } {
    const lenSq = x * x + y * y;
    if (lenSq === 0) return { x: 0, y: 0, lenSq: 0 };
    const inv = 1 / Math.sqrt(lenSq);
    return { x: x * inv, y: y * inv, lenSq };
  }

  private collidesWithWall(p: Projectile): boolean {
    if (!this.tileMap) return false;
    const tileSize = this.tileMap.virtualPixelScale;
    const samples = [
      { x: p.x, y: p.y },
      { x: p.x + p.radius, y: p.y },
      { x: p.x - p.radius, y: p.y },
      { x: p.x, y: p.y + p.radius },
      { x: p.x, y: p.y - p.radius },
    ];

    for (const s of samples) {
      const tx = Math.floor(s.x / tileSize);
      const ty = Math.floor(s.y / tileSize);
      if (tx < 0 || ty < 0 || tx >= this.tileMap.width || ty >= this.tileMap.height) return true;
      if (!this.tileMap.isBlocked(tx, ty)) continue;

      const tile = this.tileMap.getTile(tx, ty);
      const isWall = tile?.base === BaseType.Wall;
      const indestructible = tile?.base === BaseType.Wall && (tile?.durability ?? 0) >= 200;

      if (isWall && p.isPlayerProjectile && !indestructible) {
        const destroyed = this.tileMap.damageWallTile(tx, ty, 1);
        if (!destroyed) {
          return true;
        }
        continue;
      }

      return true;
    }
    return false;
  }

  private applyEffects(target: Entity, projectile: Projectile): void {
    if (!this.combat) return;
    if (!projectile.effects || projectile.effects.length === 0) return;
    const mapped = projectile.effects.map((eff) => {
      const duration =
        eff.type === "freeze" || eff.type === "stun"
          ? eff.params.duration ?? 0.5
          : eff.type === "slow"
            ? eff.params.duration ?? eff.params.slowDuration ?? 1
            : eff.params.duration ?? 1;
      return {
        type: eff.type as any,
        remaining: duration,
        params: { ...eff.params },
        source: projectile.source,
      };
    });
    this.combat.applyStatusEffects(target, mapped as any);
    if (projectile.effects.some((e) => e.type === "knockback")) {
      this.applyKnockback(target, projectile);
    }
  }

  private applyKnockback(target: Entity, projectile: Projectile): void {
    const knock = projectile.effects.find((e) => e.type === "knockback");
    if (!knock) return;
    const transform = target.getComponent<TransformComponent>("Transform");
    if (!transform) return;
    const strength = knock.params.force ?? knock.params.strength ?? 0;
    if (strength <= 0) return;
    transform.vx += projectile.dirX * strength;
    transform.vy += projectile.dirY * strength;
  }

  private handleChain(projectile: Projectile, hitTarget: Entity): boolean {
    if (projectile.remainingChains <= 0) return false;
    projectile.remainingChains -= 1;
    const next = this.findNextChainTarget(
      hitTarget,
      projectile.hitIds,
      projectile.chainRange
    );
    if (!next) {
      return false;
    }
    const transform = hitTarget.getComponent<TransformComponent>("Transform");
    const nextTransform = next.getComponent<TransformComponent>("Transform");
    if (!transform || !nextTransform) return false;
    const dirX = nextTransform.x - transform.x;
    const dirY = nextTransform.y - transform.y;
    const len = Math.hypot(dirX, dirY) || 1;
    const chained = this.spawn(
      projectile.type.key,
      { x: transform.x + transform.width * 0.5, y: transform.y + transform.height * 0.5 },
      { x: dirX / len, y: dirY / len },
      projectile.source,
      { isPlayerProjectile: projectile.isPlayerProjectile, isEnemyProjectile: projectile.isEnemyProjectile },
      {
        overrideDamage: projectile.damage,
        overrideSpeed: projectile.speed,
        sizeScale: projectile.size / Math.max(1, Math.max(transform.width, transform.height)),
        effects: projectile.effects,
        chain: projectile.remainingChains,
        chainRange: projectile.chainRange,
        pierce: projectile.pierce,
        color: projectile.colorOverride,
      }
    );
    if (chained) {
      for (const id of projectile.hitIds) {
        chained.hitIds.add(id);
      }
      chained.hitIds.add(hitTarget.id);
    }
    return false;
  }

  private findNextChainTarget(
    current: Entity,
    alreadyHit: Set<number>,
    range: number
  ): Entity | null {
    const rangeSq = range * range;
    const cTransform = current.getComponent<TransformComponent>("Transform");
    if (!cTransform) return null;
    let best: { entity: Entity; distSq: number } | null = null;
    for (const enemy of this.entityManager.enemies) {
      if (!enemy.active || alreadyHit.has(enemy.id)) continue;
      const t = enemy.getComponent<TransformComponent>("Transform");
      if (!t) continue;
      const dx = t.x - cTransform.x;
      const dy = t.y - cTransform.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;
      if (!best || distSq < best.distSq) {
        best = { entity: enemy, distSq };
      }
    }
    return best?.entity ?? null;
  }
}
