export type WeaponEffectType =
  | "slow"
  | "burn"
  | "poison"
  | "chain"
  | "knockback"
  | "freeze"
  | "stun";

export interface WeaponEffect {
  type: WeaponEffectType;
  params: Record<string, number>;
}

export interface WeaponStats {
  damage: number;
  fireRate: number; // shots per second
  projectileSpeed: number;
  projectileSize: number;
  projectileType?: string;
  projectileColor?: number;
  maxChains?: number;
  chainRange?: number;
  dotDps?: number;
  dotDuration?: number;
  slowPct?: number;
  slowDuration?: number;
  freezeDuration?: number;
  knockback?: number;
  pierce?: number;
}

export interface WeaponTier {
  costOre: number;
  statMods?: Partial<Record<keyof WeaponStats, { add?: number; mult?: number }>>;
  newEffects?: WeaponEffect[];
}

export interface WeaponBlueprint {
  id: string;
  name: string;
  projectileColor: number;
  projectileType: string;
  baseStats: WeaponStats;
  tiers: WeaponTier[];
}

export interface WeaponSlotView {
  slot: number;
  blueprint: WeaponBlueprint | null;
  currentTier: number;
  nextTier: WeaponTier | null;
}

export interface WeaponFinalStats extends WeaponStats {
  effects: WeaponEffect[];
}

export interface ProjectileSpawnRequest {
  origin: { x: number; y: number };
  direction: { x: number; y: number };
  stats: WeaponFinalStats;
  isPlayer: boolean;
}
