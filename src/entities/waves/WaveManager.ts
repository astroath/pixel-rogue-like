import { EntityManager } from "../EntityManager";
import { SpawnController } from "../SpawnController";
import {
  type TimedWaveEvent,
  type WaveDefinition,
  type WaveEnemyCosts,
  type WaveEnemyMix,
  type WaveState,
} from "./WaveTypes";

export interface WaveManagerOptions {
  waves: WaveDefinition[];
  baseEnemyCosts?: WaveEnemyCosts;
  intermissionSeconds?: number;
  clearEnemiesOnWaveStart?: boolean;
  onWaveStart?: (waveIndex: number, wave: WaveDefinition) => void;
  onWaveComplete?: (waveIndex: number, wave: WaveDefinition) => void;
  onEventTriggered?: (waveIndex: number, event: TimedWaveEvent) => void;
  loopLastWave?: boolean;
}

interface ActiveWaveContext {
  wave: WaveDefinition;
  waveIndex: number;
  elapsed: number;
  budget: number;
  triggeredEvents: Set<TimedWaveEvent>;
  costs: WaveEnemyCosts;
}

export class WaveManager {
  private spawnController: SpawnController;
  private entityManager: EntityManager;
  private waves: WaveDefinition[];
  private baseEnemyCosts: WaveEnemyCosts;
  private intermissionSeconds: number;
  private clearEnemiesOnWaveStart: boolean;
  private loopLastWave: boolean;
  private activeWave?: ActiveWaveContext;
  private intermissionTimer = 0;
  private endlessMode = false;

  private onWaveStart?: (waveIndex: number, wave: WaveDefinition) => void;
  private onWaveComplete?: (waveIndex: number, wave: WaveDefinition) => void;
  private onEventTriggered?: (waveIndex: number, event: TimedWaveEvent) => void;

  constructor(
    spawnController: SpawnController,
    entityManager: EntityManager,
    options: WaveManagerOptions
  ) {
    this.spawnController = spawnController;
    this.entityManager = entityManager;
    this.waves = options.waves;
    this.baseEnemyCosts = options.baseEnemyCosts ?? {};
    this.intermissionSeconds = options.intermissionSeconds ?? 4;
    this.clearEnemiesOnWaveStart = Boolean(options.clearEnemiesOnWaveStart);
    this.loopLastWave = options.loopLastWave ?? true;
    this.onWaveStart = options.onWaveStart;
    this.onWaveComplete = options.onWaveComplete;
    this.onEventTriggered = options.onEventTriggered;
  }

  public start(): void {
    this.beginWave(0);
  }

  public update(dtSeconds: number): void {
    if (!this.activeWave) return;

    if (this.intermissionTimer > 0) {
      this.intermissionTimer -= dtSeconds;
      if (this.intermissionTimer <= 0) {
        this.beginNextWave();
      }
      return;
    }

    const ctx = this.activeWave;
    ctx.elapsed += dtSeconds;
    ctx.budget += ctx.wave.budgetPerSecond * dtSeconds;

    this.processEvents(ctx);
    this.processContinuousSpawns(ctx);

    if (ctx.elapsed >= ctx.wave.durationSeconds) {
      this.finishWave(ctx);
    }
  }

  public getState(): WaveState | null {
    if (!this.activeWave) return null;
    const ctx = this.activeWave;
    return {
      waveNumber: ctx.waveIndex + 1,
      totalWaves: this.waves.length,
      elapsedSeconds: ctx.elapsed,
      durationSeconds: ctx.wave.durationSeconds,
      currentBudget: ctx.budget,
      budgetPerSecond: ctx.wave.budgetPerSecond,
      inIntermission: this.intermissionTimer > 0,
      intermissionRemaining: Math.max(0, this.intermissionTimer),
      nextEvent: this.getNextEvent(ctx),
      endless: this.endlessMode,
    };
  }

  public skipToNextWave(): void {
    if (!this.activeWave) return;
    this.finishWave(this.activeWave, true);
  }

  private beginWave(index: number): void {
    const waveIndex = Math.max(0, Math.min(index, this.waves.length - 1));
    const wave = this.waves[waveIndex];
    const costs: WaveEnemyCosts = { ...this.baseEnemyCosts, ...wave.enemyCosts };
    this.activeWave = {
      wave,
      waveIndex,
      elapsed: 0,
      budget: 0,
      triggeredEvents: new Set(),
      costs,
    };
    this.intermissionTimer = 0;
    this.endlessMode = waveIndex >= this.waves.length - 1 && this.loopLastWave;
    if (this.clearEnemiesOnWaveStart) {
      for (const enemy of [...this.entityManager.enemies]) {
        this.entityManager.removeEntity(enemy);
      }
    }
    this.onWaveStart?.(waveIndex, wave);
  }

  private beginNextWave(): void {
    if (!this.activeWave) return;
    const nextIndex = this.activeWave.waveIndex + 1;
    if (nextIndex >= this.waves.length) {
      if (!this.loopLastWave) return;
      this.beginWave(this.waves.length - 1);
      this.endlessMode = true;
      return;
    }
    this.beginWave(nextIndex);
  }

  private finishWave(ctx: ActiveWaveContext, skipping?: boolean): void {
    this.onWaveComplete?.(ctx.waveIndex, ctx.wave);
    const isFinalWave = ctx.waveIndex >= this.waves.length - 1 && !this.loopLastWave;
    if (isFinalWave) {
      this.activeWave = undefined;
      this.intermissionTimer = 0;
      this.endlessMode = false;
      return;
    }
    if (skipping && this.intermissionSeconds <= 0) {
      this.beginNextWave();
      return;
    }
    this.intermissionTimer = this.intermissionSeconds;
  }

  private processContinuousSpawns(ctx: ActiveWaveContext): void {
    const cheapest = this.getCheapestEnemyCost(ctx.costs);
    if (cheapest <= 0) return;

    // Guard to prevent infinite loops when we cannot spawn due to caps.
    let attempts = 0;
    while (ctx.budget >= cheapest && attempts < 64) {
      const enemyType = this.pickFromMix(ctx.wave.continuousSpawnMix);
      if (!enemyType) break;
      const cost = ctx.costs[enemyType];
      if (cost === undefined) {
        attempts++;
        continue;
      }

      const spawned = this.spawnController.spawnEnemyType(enemyType, 1);
      if (spawned > 0) {
        ctx.budget -= cost;
      } else {
        // Stop trying if we cannot place any more enemies (likely at max cap).
        break;
      }
      attempts++;
    }
  }

  private processEvents(ctx: ActiveWaveContext): void {
    const events = ctx.wave.timedEvents ?? [];
    for (const evt of events) {
      if (ctx.triggeredEvents.has(evt)) continue;
      if (ctx.elapsed < evt.triggerTime) continue;
      this.executeEvent(ctx, evt);
      ctx.triggeredEvents.add(evt);
      this.onEventTriggered?.(ctx.waveIndex, evt);
    }
  }

  private executeEvent(_ctx: ActiveWaveContext, evt: TimedWaveEvent): void {
    switch (evt.eventType) {
      case "BurstSpawn":
      case "MixedGroup":
        this.spawnGroups(evt.enemies ?? []);
        break;
      case "EliteSpawn":
        if (evt.eliteType) {
          this.spawnGroups([
            { type: evt.eliteType, count: evt.eliteCount ?? 1 },
          ]);
        }
        break;
      case "WeightedBurst": {
        const total = evt.totalCount ?? 20;
        const weights = evt.weights ?? {};
        for (let i = 0; i < total; i++) {
          const type = this.pickFromMix(weights);
          if (!type) break;
          this.spawnController.spawnEnemyType(type, 1);
        }
        break;
      }
    }
  }

  private spawnGroups(groups: { type: string; count: number }[]): void {
    for (const group of groups) {
      if (!group.type || group.count <= 0) continue;
      this.spawnController.spawnEnemyType(group.type, group.count);
    }
  }

  private getCheapestEnemyCost(costs: WaveEnemyCosts): number {
    let cheapest = Number.POSITIVE_INFINITY;
    for (const value of Object.values(costs)) {
      if (value <= 0) continue;
      cheapest = Math.min(cheapest, value);
    }
    return cheapest;
  }

  private pickFromMix(mix: WaveEnemyMix): string | null {
    const entries = Object.entries(mix).filter(([, weight]) => weight > 0);
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [type, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return type;
    }
    return entries[entries.length - 1][0];
  }

  private getNextEvent(ctx: ActiveWaveContext): (TimedWaveEvent & { waveIndex: number }) | undefined {
    const events = ctx.wave.timedEvents ?? [];
    const upcoming = events
      .filter((e) => !ctx.triggeredEvents.has(e) && e.triggerTime >= ctx.elapsed)
      .sort((a, b) => a.triggerTime - b.triggerTime);
    if (upcoming.length === 0) return undefined;
    return { ...upcoming[0], waveIndex: ctx.waveIndex };
  }
}
