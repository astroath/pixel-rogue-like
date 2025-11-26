export type WaveEnemyCosts = Record<string, number>;
export type WaveEnemyMix = Record<string, number>;

export type WaveEventType = "BurstSpawn" | "EliteSpawn" | "MixedGroup" | "WeightedBurst";

export interface WaveEnemyGroup {
  type: string;
  count: number;
}

export interface TimedWaveEvent {
  triggerTime: number;
  eventType: WaveEventType;
  enemies?: WaveEnemyGroup[];
  weights?: WaveEnemyMix;
  eliteType?: string;
  eliteCount?: number;
  totalCount?: number;
}

export interface WaveDefinition {
  name?: string;
  durationSeconds: number;
  budgetPerSecond: number;
  enemyCosts: WaveEnemyCosts;
  continuousSpawnMix: WaveEnemyMix;
  timedEvents?: TimedWaveEvent[];
}

export interface WaveState {
  waveNumber: number;
  totalWaves: number;
  elapsedSeconds: number;
  durationSeconds: number;
  currentBudget: number;
  budgetPerSecond: number;
  inIntermission: boolean;
  intermissionRemaining: number;
  nextEvent?: TimedWaveEvent & { waveIndex: number };
  endless: boolean;
}
