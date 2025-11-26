import {
  type EnemyModifierState,
  type PlayerStatKey,
  type PlayerStatsSnapshot,
  type StatDelta,
  type UpgradeDefinition,
  type UpgradeEffect,
} from './types';

type StatAccumulator = Record<PlayerStatKey, number>;

export interface CurrencyState {
  ore: number;
}

const DEFAULT_PLAYER_BASE: PlayerStatsSnapshot = {
  moveSpeed: 2,
  maxHealth: 100,
  healthRegen: 0,
  pickupRadius: 28,
  damageResistance: 0,
  attackDamage: 12,
  attackCooldown: 12,
  projectileSpeed: 3,
  projectileSize: 1,
  projectileCount: 1,
  projectileSpread: 0,
  projectilePierce: 0,
};

const DEFAULT_ENEMY_MODIFIERS: EnemyModifierState = {
  speedMultiplier: 1,
  damageMultiplier: 1,
  attackCooldownMultiplier: 1,
  knockbackTakenMultiplier: 1,
};

export class ProgressionState {
  private base: PlayerStatsSnapshot;
  private additive: StatAccumulator;
  private multiplicative: StatAccumulator;
  private enemy: EnemyModifierState;
  private currency: CurrencyState;

  constructor(baseOverrides?: Partial<PlayerStatsSnapshot>) {
    this.base = { ...DEFAULT_PLAYER_BASE, ...baseOverrides };
    this.additive = this.zeroAccumulator();
    this.multiplicative = this.oneAccumulator();
    this.enemy = { ...DEFAULT_ENEMY_MODIFIERS };
    this.currency = { ore: 0 };
  }

  public getSnapshot(): PlayerStatsSnapshot {
    const snap: PlayerStatsSnapshot = { ...this.base };
    for (const key of Object.keys(this.base) as PlayerStatKey[]) {
      const baseVal = this.base[key];
      const mult = this.multiplicative[key];
      const add = this.additive[key];
      snap[key] = baseVal * mult + add;
    }
    snap.damageResistance = this.clamp01(
      this.base.damageResistance * this.multiplicative.damageResistance +
        this.additive.damageResistance
    );
    snap.projectileCount = Math.max(1, Math.round(snap.projectileCount));
    snap.projectilePierce = Math.max(0, Math.floor(snap.projectilePierce));
    return snap;
  }

  public getEnemyModifiers(): EnemyModifierState {
    return { ...this.enemy };
  }

  public getOre(): number {
    return this.currency.ore;
  }

  public addOre(amount: number): number {
    const clamped = Math.max(0, Math.floor(amount));
    this.currency.ore = Math.max(0, this.currency.ore + clamped);
    return this.currency.ore;
  }

  public spendOre(amount: number): boolean {
    const cost = Math.max(0, Math.floor(amount));
    if (this.currency.ore < cost) return false;
    this.currency.ore -= cost;
    return true;
  }

  public resetOre(amount: number = 0): void {
    this.currency.ore = Math.max(0, Math.floor(amount));
  }

  public applyUpgrade(upgrade: UpgradeDefinition): {
    player: PlayerStatsSnapshot;
    enemies: EnemyModifierState;
  } {
    this.applyEffect(upgrade.effect);
    return { player: this.getSnapshot(), enemies: this.getEnemyModifiers() };
  }

  public applyEffect(effect: UpgradeEffect): void {
    if (effect.stats) {
      for (const [key, delta] of Object.entries(effect.stats) as [
        PlayerStatKey,
        StatDelta
      ][]) {
        if (delta.add !== undefined) {
          this.additive[key] += delta.add;
        }
        if (delta.mult !== undefined) {
          this.multiplicative[key] *= delta.mult;
        }
      }
    }

    if (effect.enemyModifiers) {
      if (effect.enemyModifiers.speedMultiplier !== undefined) {
        this.enemy.speedMultiplier *= effect.enemyModifiers.speedMultiplier;
      }
      if (effect.enemyModifiers.damageMultiplier !== undefined) {
        this.enemy.damageMultiplier *= effect.enemyModifiers.damageMultiplier;
      }
      if (effect.enemyModifiers.attackCooldownMultiplier !== undefined) {
        this.enemy.attackCooldownMultiplier *=
          effect.enemyModifiers.attackCooldownMultiplier;
      }
      if (effect.enemyModifiers.knockbackTakenMultiplier !== undefined) {
        this.enemy.knockbackTakenMultiplier *=
          effect.enemyModifiers.knockbackTakenMultiplier;
      }
    }
  }

  public overrideBase(base: Partial<PlayerStatsSnapshot>): void {
    this.base = { ...this.base, ...base };
  }

  private zeroAccumulator(): StatAccumulator {
    return {
      moveSpeed: 0,
      maxHealth: 0,
      healthRegen: 0,
      pickupRadius: 0,
      damageResistance: 0,
      attackDamage: 0,
      attackCooldown: 0,
      projectileSpeed: 0,
      projectileSize: 0,
      projectileCount: 0,
      projectileSpread: 0,
      projectilePierce: 0,
    };
  }

  private oneAccumulator(): StatAccumulator {
    return {
      moveSpeed: 1,
      maxHealth: 1,
      healthRegen: 1,
      pickupRadius: 1,
      damageResistance: 1,
      attackDamage: 1,
      attackCooldown: 1,
      projectileSpeed: 1,
      projectileSize: 1,
      projectileCount: 1,
      projectileSpread: 1,
      projectilePierce: 1,
    };
  }

  private clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.min(0.9, Math.max(0, value));
  }
}
