import { type UpgradeDefinition } from './types';

export const UPGRADE_POOL: UpgradeDefinition[] = [
  {
    id: 'fleet_feet',
    name: 'Fleet Feet',
    description: '+15% move speed. Great for kiting and dodging.',
    category: 'player',
    rarity: 'common',
    weight: 12,
    core: true,
    effect: { stats: { moveSpeed: { mult: 1.15 } } },
  },
  {
    id: 'iron_heart',
    name: 'Iron Heart',
    description: '+20 max health.',
    category: 'player',
    rarity: 'common',
    weight: 10,
    core: true,
    effect: { stats: { maxHealth: { add: 20 } } },
  },
  {
    id: 'vitality_surge',
    name: 'Vitality Surge',
    description: 'Regenerate +0.8 HP per second.',
    category: 'player',
    rarity: 'rare',
    weight: 8,
    effect: { stats: { healthRegen: { add: 0.8 } } },
  },
  {
    id: 'vacuum_core',
    name: 'Vacuum Core',
    description: 'Pickup radius +40%.',
    category: 'player',
    rarity: 'common',
    weight: 10,
    core: true,
    effect: { stats: { pickupRadius: { mult: 1.4 } } },
  },
  {
    id: 'hardened_skin',
    name: 'Hardened Skin',
    description: 'Take 10% less damage.',
    category: 'player',
    rarity: 'rare',
    weight: 8,
    effect: { stats: { damageResistance: { add: 0.1 } } },
  },
  {
    id: 'adrenaline_loop',
    name: 'Adrenaline Loop',
    description: '+0.4 HP/s regen and +5% move speed.',
    category: 'player',
    rarity: 'rare',
    weight: 6,
    effect: {
      stats: {
        healthRegen: { add: 0.4 },
        moveSpeed: { mult: 1.05 },
      },
    },
  },
  {
    id: 'focused_shot',
    name: 'Focused Shot',
    description: 'Projectile damage +20%.',
    category: 'weapon',
    rarity: 'common',
    weight: 11,
    core: true,
    effect: { stats: { attackDamage: { mult: 1.2 } } },
  },
  {
    id: 'rapid_trigger',
    name: 'Rapid Trigger',
    description: 'Fire rate +22% (shorter cooldown).',
    category: 'weapon',
    rarity: 'common',
    weight: 10,
    core: true,
    effect: { stats: { attackCooldown: { mult: 0.78 } } },
  },
  {
    id: 'heavy_rounds',
    name: 'Heavy Rounds',
    description: '+10% damage and +20% projectile size.',
    category: 'weapon',
    rarity: 'rare',
    weight: 8,
    effect: {
      stats: {
        attackDamage: { mult: 1.1 },
        projectileSize: { mult: 1.2 },
      },
    },
  },
  {
    id: 'accelerated_rounds',
    name: 'Accelerated Rounds',
    description: 'Projectile speed +25%.',
    category: 'weapon',
    rarity: 'common',
    weight: 9,
    effect: { stats: { projectileSpeed: { mult: 1.25 } } },
  },
  {
    id: 'twin_shot',
    name: 'Twin Shot',
    description: 'Shoot +1 projectile with slight spread.',
    category: 'weapon',
    rarity: 'rare',
    weight: 7,
    effect: {
      stats: {
        projectileCount: { add: 1 },
        projectileSpread: { add: 6 },
      },
    },
  },
  {
    id: 'piercing_rounds',
    name: 'Piercing Rounds',
    description: 'Projectiles pierce +1 target.',
    category: 'weapon',
    rarity: 'rare',
    weight: 5,
    effect: { stats: { projectilePierce: { add: 1 } } },
  },
  {
    id: 'buckshot',
    name: 'Buckshot',
    description: 'Fire +2 projectiles with wider spread.',
    category: 'weapon',
    rarity: 'epic',
    weight: 3,
    effect: {
      stats: {
        projectileCount: { add: 2 },
        projectileSpread: { add: 12 },
        attackDamage: { mult: 0.9 },
      },
    },
    mutuallyExclusiveWith: ['twin_shot'],
  },
  {
    id: 'cryofield',
    name: 'Cryofield',
    description: 'All new enemies move 10% slower.',
    category: 'enemy',
    rarity: 'rare',
    weight: 7,
    effect: { enemyModifiers: { speedMultiplier: 0.9 } },
  },
  {
    id: 'dampened_claws',
    name: 'Dampened Claws',
    description: 'Enemy damage -15%.',
    category: 'enemy',
    rarity: 'rare',
    weight: 6,
    effect: { enemyModifiers: { damageMultiplier: 0.85 } },
  },
  {
    id: 'jammed_weapons',
    name: 'Jammed Weapons',
    description: 'Enemy attack cooldowns are 25% longer.',
    category: 'enemy',
    rarity: 'rare',
    weight: 6,
    effect: { enemyModifiers: { attackCooldownMultiplier: 1.25 } },
  },
];

export function pickUpgradeOptions(
  pool: UpgradeDefinition[],
  count: number = 3,
  banned: Set<string> = new Set()
): UpgradeDefinition[] {
  const available = pool.filter((u) => !banned.has(u.id));
  const results: UpgradeDefinition[] = [];
  const core = pool.filter((u) => u.core && !banned.has(u.id));

  const pickFrom = (list: UpgradeDefinition[]) => {
    const totalWeight = list.reduce((sum, u) => sum + Math.max(0, u.weight), 0);
    if (totalWeight <= 0) return null;
    let roll = Math.random() * totalWeight;
    for (const upgrade of list) {
      roll -= Math.max(0, upgrade.weight);
      if (roll <= 0) return upgrade;
    }
    return list[list.length - 1];
  };

  while (results.length < count && available.length > 0) {
    const candidate = pickFrom(available);
    if (!candidate) break;
    results.push(candidate);
    banned.add(candidate.id);
    // Remove candidate and any mutually exclusive siblings from the pool.
    for (let i = available.length - 1; i >= 0; i--) {
      const item = available[i];
      const excluded =
        item.id === candidate.id ||
        (candidate.mutuallyExclusiveWith?.includes(item.id) ?? false) ||
        (item.mutuallyExclusiveWith?.includes(candidate.id) ?? false);
      if (excluded) {
        available.splice(i, 1);
      }
    }
  }

  while (results.length < count && core.length > 0) {
    const fallback = pickFrom(core);
    if (!fallback || results.find((u) => u.id === fallback.id)) break;
    results.push(fallback);
  }

  return results;
}
