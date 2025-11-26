import type { Entity } from "../entities/Entity";
import type { ProjectileManager } from "../entities/projectiles/ProjectileManager";
import { ProgressionState } from "../progression/ProgressionState";
import { EquippedWeapon } from "./EquippedWeapon";
import { getWeaponBlueprint, WEAPON_REGISTRY } from "./weaponRegistry";
import type { ProjectileSpawnRequest, WeaponSlotView } from "./types";

const MAX_SLOTS = 4;

export class WeaponController {
  private weapons: EquippedWeapon[] = [];
  private progression: ProgressionState;
  private projectileManager: ProjectileManager;

  constructor(progression: ProgressionState, projectileManager: ProjectileManager) {
    this.progression = progression;
    this.projectileManager = projectileManager;
  }

  public equip(blueprintId: string): boolean {
    if (this.weapons.length >= MAX_SLOTS) return false;
    const blueprint = getWeaponBlueprint(blueprintId);
    if (!blueprint) return false;
    this.weapons.push(new EquippedWeapon(blueprintId));
    return true;
  }

  public swapSlots(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= this.weapons.length || b >= this.weapons.length) return;
    const tmp = this.weapons[a];
    this.weapons[a] = this.weapons[b];
    this.weapons[b] = tmp;
  }

  public remove(slot: number): void {
    if (slot < 0 || slot >= this.weapons.length) return;
    this.weapons.splice(slot, 1);
  }

  public tryUpgrade(slot: number): boolean {
    const weapon = this.weapons[slot];
    if (!weapon) return false;
    const blueprint = weapon.getBlueprint();
    if (!blueprint) return false;
    const nextTierIndex = weapon.currentTier;
    const nextTier = blueprint.tiers[nextTierIndex];
    if (!nextTier) return false;
    if (!this.progression.spendOre(nextTier.costOre)) return false;
    weapon.tryUpgrade();
    return true;
  }

  public update(dtSeconds: number, player: Entity, aimDir: { x: number; y: number }): void {
    if (!player) return;
    const lenSq = aimDir.x * aimDir.x + aimDir.y * aimDir.y;
    if (lenSq <= 0) return;
    const invLen = 1 / Math.sqrt(lenSq);
    const normDir = { x: aimDir.x * invLen, y: aimDir.y * invLen };
    for (const weapon of this.weapons) {
      weapon.tick(dtSeconds);
      if (!weapon.ready()) continue;
      const transform = player.getComponent<any>("Transform");
      if (!transform) continue;
      const spawn = weapon.makeSpawnRequest(
        {
          x: transform.x + transform.width * 0.5,
          y: transform.y + transform.height * 0.5,
        },
        normDir,
        true
      );
      const fired = this.spawnProjectile(spawn, player);
      if (fired) {
        weapon.markFired();
      }
    }
  }

  public getSlotView(): WeaponSlotView[] {
    const views: WeaponSlotView[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const weapon = this.weapons[i];
      const blueprint = weapon ? weapon.getBlueprint() ?? null : null;
      const nextTier =
        weapon && blueprint ? blueprint.tiers[weapon.currentTier] ?? null : null;
      views.push({
        slot: i,
        blueprint,
        currentTier: weapon?.currentTier ?? 0,
        nextTier,
      });
    }
    return views;
  }

  public getEquipped(): EquippedWeapon[] {
    return this.weapons;
  }

  public getAvailableBlueprints(): string[] {
    return WEAPON_REGISTRY.map((w) => w.id);
  }

  private spawnProjectile(request: ProjectileSpawnRequest, player: Entity): boolean {
    const stats = request.stats;
    const projectile = this.projectileManager.spawn(
      stats.projectileType ?? "playerBullet",
      request.origin,
      request.direction,
      player,
      { isPlayerProjectile: request.isPlayer },
      {
        overrideDamage: stats.damage,
        overrideSpeed: stats.projectileSpeed,
        sizeScale: 0.3 * stats.projectileSize,
        color: stats.projectileColor,
        effects: stats.effects,
        chain: stats.maxChains,
        chainRange: stats.chainRange,
        pierce: stats.pierce,
      }
    );
    return Boolean(projectile);
  }
}
