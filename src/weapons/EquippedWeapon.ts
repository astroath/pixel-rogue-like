import { getWeaponBlueprint } from "./weaponRegistry";
import type {
  ProjectileSpawnRequest,
  WeaponBlueprint,
  WeaponEffect,
  WeaponFinalStats,
  WeaponStats,
  WeaponTier,
} from "./types";

const MAX_TIERS = 5;

export class EquippedWeapon {
  public blueprintId: string;
  public currentTier = 0;
  private cooldown = 0;
  private blueprint?: WeaponBlueprint;
  private cachedStats: WeaponFinalStats;

  constructor(blueprintId: string) {
    this.blueprintId = blueprintId;
    this.blueprint = getWeaponBlueprint(blueprintId);
    this.cachedStats = this.computeStats();
  }

  public tick(dtSeconds: number): void {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dtSeconds);
    }
  }

  public ready(): boolean {
    return this.cooldown <= 0;
  }

  public recalc(): void {
    this.cachedStats = this.computeStats();
  }

  public getStats(): WeaponFinalStats {
    return this.cachedStats;
  }

  public getBlueprint(): WeaponBlueprint | undefined {
    return this.blueprint;
  }

  public markFired(): void {
    this.resetCooldown();
  }

  public tryUpgrade(): boolean {
    if (this.currentTier >= MAX_TIERS) return false;
    this.currentTier += 1;
    this.recalc();
    return true;
  }

  public makeSpawnRequest(origin: { x: number; y: number }, direction: { x: number; y: number }, isPlayer: boolean): ProjectileSpawnRequest {
    const stats = this.getStats();
    return {
      origin,
      direction,
      stats,
      isPlayer,
    };
  }

  private resetCooldown(): void {
    const fireRate = Math.max(0.01, this.cachedStats.fireRate);
    this.cooldown = 1 / fireRate;
  }

  private computeStats(): WeaponFinalStats {
    const bp = this.blueprint;
    if (!bp) {
      return {
        damage: 0,
        fireRate: 1,
        projectileSpeed: 1,
        projectileSize: 1,
        projectileType: "playerBullet",
        projectileColor: 0xffffff,
        effects: [],
      };
    }

    const base: WeaponStats = { ...bp.baseStats };
    const effects: WeaponEffect[] = [];
    const tiersToApply: WeaponTier[] = bp.tiers.slice(0, Math.min(this.currentTier, MAX_TIERS));
    for (const tier of tiersToApply) {
      if (tier.statMods) {
        for (const [key, delta] of Object.entries(tier.statMods) as [keyof WeaponStats, { add?: number; mult?: number }][]) {
          const value = base[key];
          const add = delta.add ?? 0;
          const mult = delta.mult ?? 1;
          if (typeof value === "number") {
            (base as any)[key] = (value + add) * mult;
          }
        }
      }
      if (tier.newEffects) {
        effects.push(...tier.newEffects);
      }
    }

    if (base.slowPct && base.slowPct > 0) {
      effects.push({
        type: "slow",
        params: { pct: base.slowPct, duration: base.slowDuration ?? 1 },
      });
    }
    if (base.freezeDuration && base.freezeDuration > 0) {
      effects.push({
        type: "freeze",
        params: { duration: base.freezeDuration },
      });
    }
    if (base.dotDps && base.dotDps > 0) {
      effects.push({
        type: "poison",
        params: { dps: base.dotDps, duration: base.dotDuration ?? 2 },
      });
    }
    if (base.knockback && base.knockback > 0) {
      effects.push({
        type: "knockback",
        params: { force: base.knockback },
      });
    }

    return {
      ...base,
      projectileColor: bp.projectileColor,
      effects,
    };
  }
}
