import { Entity } from "./Entity";
import { EntityManager } from "./EntityManager";
import { HealthComponent } from "./components/HealthComponent";

export interface CombatFlags {
  infinitePlayerHealth: boolean;
  oneHitKillEnemies: boolean;
  logDamage: boolean;
}

export interface StatusEffectInstance {
  type: "slow" | "burn" | "poison" | "freeze" | "stun";
  remaining: number;
  params: Record<string, number>;
  source: Entity | null;
}

interface StatusState {
  baseMoveSpeed?: number;
  effects: StatusEffectInstance[];
}

export class CombatSystem {
  private entityManager: EntityManager;
  private flags: CombatFlags = {
    infinitePlayerHealth: false,
    oneHitKillEnemies: false,
    logDamage: false,
  };
  private damageLog: string[] = [];
  private maxLogs = 8;
  private killCount = 0;
  private onEntityKilled?: (target: Entity, source: Entity | null) => void;
  private damageModifier?: (target: Entity, amount: number, source: Entity | null) => number;
  private onDamageApplied?: (target: Entity, amount: number, source: Entity | null) => void;
  private statuses: Map<number, StatusState> = new Map();

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  public setFlags(flags: Partial<CombatFlags>): void {
    this.flags = { ...this.flags, ...flags };
  }

  public getFlags(): CombatFlags {
    return { ...this.flags };
  }

  public getKillCount(): number {
    return this.killCount;
  }

  public getDamageLog(): string[] {
    return [...this.damageLog];
  }

  public clearLog(): void {
    this.damageLog.length = 0;
  }

  public setOnEntityKilled(
    handler: ((target: Entity, source: Entity | null) => void) | undefined
  ): void {
    this.onEntityKilled = handler;
  }

  public setOnDamageApplied(
    handler: ((target: Entity, amount: number, source: Entity | null) => void) | undefined
  ): void {
    this.onDamageApplied = handler;
  }

  public setDamageModifier(
    handler: ((target: Entity, amount: number, source: Entity | null) => number) | undefined
  ): void {
    this.damageModifier = handler;
  }

  public applyStatusEffects(target: Entity, effects: StatusEffectInstance[]): void {
    if (!target.active || effects.length === 0) return;
    const key = target.id;
    const state = this.statuses.get(key) ?? { effects: [] };
    this.statuses.set(key, state);
    for (const eff of effects) {
      state.effects.push({ ...eff });
    }
  }

  public applyDamage(target: Entity, amount: number, source: Entity | null): boolean {
    const health = target.getComponent<HealthComponent>("Health");
    if (!health) return false;

    if (target.type === "player" && this.flags.infinitePlayerHealth) {
      return false;
    }

    if (health.invulnTimer > 0) {
      return false;
    }

    let dmg = Math.max(0, amount);
    if (this.damageModifier) {
      dmg = Math.max(0, this.damageModifier(target, dmg, source));
    }
    if (this.flags.oneHitKillEnemies && target.type === "enemy") {
      dmg = health.current;
    }

    if (dmg <= 0) return false;

    health.takeDamage(dmg);
    this.onDamageApplied?.(target, dmg, source);
    if (this.flags.logDamage) {
      const attacker = source ? `${source.type}#${source.id}` : "env";
      this.pushLog(`Hit ${target.type}#${target.id} for ${dmg} by ${attacker}`);
    }

    if (health.isDead()) {
      this.handleDeath(target, source);
    }
    return true;
  }

  public update(dt: number): void {
    for (const entity of this.entityManager.getAllEntities()) {
      if (!entity.active) continue;
      const health = entity.getComponent<HealthComponent>("Health");
      if (health) {
        health.update(dt);
      }
    }
    this.updateStatuses(dt);
  }

  private handleDeath(target: Entity, _source: Entity | null): void {
    if (target.type === "enemy") {
      this.killCount += 1;
    }
    this.statuses.delete(target.id);
    this.onEntityKilled?.(target, _source);
    this.entityManager.removeEntity(target);
  }

  private pushLog(entry: string): void {
    this.damageLog.push(entry);
    if (this.damageLog.length > this.maxLogs) {
      this.damageLog.shift();
    }
  }

  private updateStatuses(dt: number): void {
    for (const [entityId, state] of this.statuses.entries()) {
      const entity = this.entityManager.getAllEntities().find((e) => e.id === entityId && e.active);
      if (!entity) {
        this.statuses.delete(entityId);
        continue;
      }
      const transform = entity.getComponent<any>("Transform");
      const health = entity.getComponent<HealthComponent>("Health");
      if (!transform || !health) continue;

      if (state.baseMoveSpeed === undefined) {
        state.baseMoveSpeed = transform.speed ?? 0;
      }

      let moveMultiplier = 1;
      let stunned = false;
      for (const eff of state.effects) {
        eff.remaining -= dt;
        if (eff.remaining <= 0) continue;

        switch (eff.type) {
          case "freeze":
          case "stun":
            stunned = true;
            moveMultiplier = 0;
            break;
          case "slow": {
            const pct = Math.max(0, Math.min(1, eff.params.pct ?? eff.params.slowPct ?? 0));
            moveMultiplier = Math.min(moveMultiplier, 1 - pct);
            break;
          }
          case "burn":
          case "poison": {
            const dps = eff.params.dps ?? eff.params.damage ?? 0;
            if (dps > 0) {
              const dmg = dps * dt;
              const prevInvuln = health.invulnTimer;
              health.invulnTimer = 0;
              this.applyDamage(entity, dmg, eff.source);
              health.invulnTimer = prevInvuln;
            }
            break;
          }
        }
      }

      transform.speed = (state.baseMoveSpeed ?? transform.speed) * (stunned ? 0 : moveMultiplier);
      state.effects = state.effects.filter((e) => e.remaining > 0);
      if (state.effects.length === 0) {
        transform.speed = state.baseMoveSpeed ?? transform.speed;
        this.statuses.delete(entityId);
      }
    }
  }
}
