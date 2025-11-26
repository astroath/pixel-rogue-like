export type UpgradeCategory = 'player' | 'weapon' | 'enemy';

export type UpgradeRarity = 'common' | 'rare' | 'epic';

export type PlayerStatKey =
  | 'moveSpeed'
  | 'maxHealth'
  | 'healthRegen'
  | 'pickupRadius'
  | 'damageResistance'
  | 'attackDamage'
  | 'attackCooldown'
  | 'projectileSpeed'
  | 'projectileSize'
  | 'projectileCount'
  | 'projectileSpread'
  | 'projectilePierce';

export interface PlayerStatsSnapshot {
  moveSpeed: number;
  maxHealth: number;
  healthRegen: number;
  pickupRadius: number;
  damageResistance: number;
  attackDamage: number;
  attackCooldown: number;
  projectileSpeed: number;
  projectileSize: number;
  projectileCount: number;
  projectileSpread: number;
  projectilePierce: number;
}

export interface EnemyModifierState {
  speedMultiplier: number;
  damageMultiplier: number;
  attackCooldownMultiplier: number;
  knockbackTakenMultiplier: number;
}

export interface StatDelta {
  add?: number;
  mult?: number;
}

export interface UpgradeEffect {
  stats?: Partial<Record<PlayerStatKey, StatDelta>>;
  enemyModifiers?: Partial<EnemyModifierState>;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  category: UpgradeCategory;
  weight: number;
  rarity?: UpgradeRarity;
  core?: boolean;
  mutuallyExclusiveWith?: string[];
  effect: UpgradeEffect;
}
