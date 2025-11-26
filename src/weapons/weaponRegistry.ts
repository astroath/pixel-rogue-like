import type { WeaponBlueprint } from "./types";

export const WEAPON_REGISTRY: WeaponBlueprint[] = [
  {
    id: "blaster",
    name: "Blaster",
    projectileColor: 0xff4d4d,
    projectileType: "blaster",
    baseStats: {
      damage: 8,
      fireRate: 3.5,
      projectileSpeed: 5,
      projectileSize: 1,
      projectileType: "playerBullet",
      projectileColor: 0xff4d4d,
    },
    tiers: [
      {
        costOre: 12,
        statMods: {
          fireRate: { add: 0.6 },
          damage: { add: 2 },
        },
      },
      {
        costOre: 22,
        statMods: {
          fireRate: { add: 0.8 },
          projectileSpeed: { add: 1 },
        },
      },
      {
        costOre: 36,
        statMods: {
          damage: { add: 4 },
          projectileSize: { add: 0.2 },
        },
      },
      {
        costOre: 55,
        statMods: {
          fireRate: { add: 1.1 },
          damage: { add: 4 },
          projectileSize: { add: 0.2 },
        },
      },
      {
        costOre: 80,
        statMods: {
          damage: { mult: 1.25 },
        },
        newEffects: [
          { type: "burn", params: { dps: 6, duration: 3 } },
        ],
      },
    ],
  },
  {
    id: "cryo",
    name: "Cryo Shot",
    projectileColor: 0x4cc3ff,
    projectileType: "cryo",
    baseStats: {
      damage: 10,
      fireRate: 2.4,
      projectileSpeed: 4.5,
      projectileSize: 1.05,
      projectileType: "playerBullet",
      projectileColor: 0x4cc3ff,
      slowPct: 0.25,
      slowDuration: 1.6,
    },
    tiers: [
      {
        costOre: 12,
        statMods: {
          slowPct: { add: 0.08 },
          fireRate: { add: 0.4 },
        },
      },
      {
        costOre: 22,
        statMods: {
          damage: { add: 3 },
          slowDuration: { add: 0.4 },
        },
      },
      {
        costOre: 36,
        statMods: {
          projectileSize: { add: 0.25 },
          projectileSpeed: { add: 0.5 },
        },
      },
      {
        costOre: 55,
        statMods: {
          fireRate: { add: 0.6 },
          damage: { add: 4 },
        },
      },
      {
        costOre: 80,
        newEffects: [
          { type: "freeze", params: { duration: 0.65 } },
        ],
      },
    ],
  },
  {
    id: "chain",
    name: "Chain Arc",
    projectileColor: 0xffe066,
    projectileType: "chain",
    baseStats: {
      damage: 9,
      fireRate: 2.6,
      projectileSpeed: 4.8,
      projectileSize: 0.9,
      projectileType: "playerBullet",
      projectileColor: 0xffe066,
      maxChains: 2,
      chainRange: 70,
    },
    tiers: [
      {
        costOre: 14,
        statMods: {
          maxChains: { add: 1 },
          fireRate: { add: 0.4 },
        },
      },
      {
        costOre: 26,
        statMods: {
          damage: { add: 3 },
          projectileSpeed: { add: 0.6 },
        },
      },
      {
        costOre: 42,
        statMods: {
          maxChains: { add: 1 },
          chainRange: { add: 12 },
        },
      },
      {
        costOre: 60,
        statMods: {
          fireRate: { add: 0.7 },
          damage: { add: 4 },
        },
      },
      {
        costOre: 90,
        statMods: {
          maxChains: { add: 2 },
          chainRange: { add: 16 },
        },
      },
    ],
  },
  {
    id: "venom",
    name: "Venom Dart",
    projectileColor: 0x6ee78c,
    projectileType: "venom",
    baseStats: {
      damage: 7,
      fireRate: 3,
      projectileSpeed: 5.2,
      projectileSize: 0.95,
      projectileType: "playerBullet",
      projectileColor: 0x6ee78c,
      dotDps: 4,
      dotDuration: 2.6,
    },
    tiers: [
      {
        costOre: 12,
        statMods: {
          dotDps: { add: 2 },
          fireRate: { add: 0.4 },
        },
      },
      {
        costOre: 22,
        statMods: {
          damage: { add: 3 },
          projectileSpeed: { add: 0.4 },
        },
      },
      {
        costOre: 38,
        statMods: {
          fireRate: { add: 0.5 },
          projectileSize: { add: 0.15 },
        },
      },
      {
        costOre: 60,
        statMods: {
          dotDuration: { add: 1.2 },
          damage: { add: 4 },
        },
      },
      {
        costOre: 90,
        statMods: {
          dotDps: { mult: 1.5 },
          dotDuration: { add: 1.2 },
        },
      },
    ],
  },
];

export function getWeaponBlueprint(id: string): WeaponBlueprint | undefined {
  return WEAPON_REGISTRY.find((w) => w.id === id);
}
