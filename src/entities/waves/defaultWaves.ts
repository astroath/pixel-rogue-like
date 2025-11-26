import { type WaveDefinition, type WaveEnemyCosts } from "./WaveTypes";

export const BASE_ENEMY_COSTS: WaveEnemyCosts = {
  SmallChaser: 1,
  MediumChaser: 3,
  RangedShooter: 4,
  Tank: 10,
};

export const DEFAULT_WAVES: WaveDefinition[] = [
  {
    name: "Wave 1",
    durationSeconds: 30,
    budgetPerSecond: 3,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 80,
      MediumChaser: 20,
    },
    timedEvents: [
      {
        triggerTime: 20,
        eventType: "BurstSpawn",
        enemies: [{ type: "SmallChaser", count: 20 }],
      },
    ],
  },
  {
    name: "Wave 2",
    durationSeconds: 40,
    budgetPerSecond: 7,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 70,
      MediumChaser: 20,
      RangedShooter: 10,
    },
    timedEvents: [
      {
        triggerTime: 25,
        eventType: "BurstSpawn",
        enemies: [
          { type: "MediumChaser", count: 10 },
          { type: "RangedShooter", count: 5 },
        ],
      },
    ],
  },
  {
    name: "Wave 3",
    durationSeconds: 50,
    budgetPerSecond: 10,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 65,
      MediumChaser: 25,
      RangedShooter: 10,
    },
    timedEvents: [
      {
        triggerTime: 30,
        eventType: "EliteSpawn",
        eliteType: "Tank",
        eliteCount: 1,
      },
    ],
  },
  {
    name: "Wave 4",
    durationSeconds: 60,
    budgetPerSecond: 12,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 60,
      MediumChaser: 25,
      RangedShooter: 15,
    },
    timedEvents: [
      {
        triggerTime: 40,
        eventType: "WeightedBurst",
        weights: {
          SmallChaser: 80,
          MediumChaser: 20,
        },
        totalCount: 25,
      },
    ],
  },
  {
    name: "Wave 5",
    durationSeconds: 70,
    budgetPerSecond: 16,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 55,
      MediumChaser: 25,
      RangedShooter: 15,
      Tank: 5,
    },
    timedEvents: [
      {
        triggerTime: 50,
        eventType: "EliteSpawn",
        eliteType: "Tank",
        eliteCount: 2,
      },
    ],
  },
  {
    name: "Wave 6",
    durationSeconds: 80,
    budgetPerSecond: 20,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 50,
      MediumChaser: 25,
      RangedShooter: 20,
      Tank: 5,
    },
    timedEvents: [
      {
        triggerTime: 60,
        eventType: "BurstSpawn",
        enemies: [
          { type: "SmallChaser", count: 30 },
          { type: "MediumChaser", count: 15 },
        ],
      },
    ],
  },
  {
    name: "Wave 7",
    durationSeconds: 90,
    budgetPerSecond: 25,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 50,
      MediumChaser: 30,
      RangedShooter: 15,
      Tank: 5,
    },
    timedEvents: [
      {
        triggerTime: 70,
        eventType: "EliteSpawn",
        eliteType: "Tank",
        eliteCount: 3,
      },
    ],
  },
  {
    name: "Wave 8",
    durationSeconds: 100,
    budgetPerSecond: 30,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 45,
      MediumChaser: 30,
      RangedShooter: 20,
      Tank: 5,
    },
    timedEvents: [
      {
        triggerTime: 80,
        eventType: "WeightedBurst",
        weights: {
          SmallChaser: 50,
          MediumChaser: 30,
          RangedShooter: 20,
        },
        totalCount: 35,
      },
    ],
  },
  {
    name: "Wave 9",
    durationSeconds: 110,
    budgetPerSecond: 35,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 40,
      MediumChaser: 30,
      RangedShooter: 20,
      Tank: 10,
    },
    timedEvents: [
      {
        triggerTime: 90,
        eventType: "EliteSpawn",
        eliteType: "Tank",
        eliteCount: 4,
      },
    ],
  },
  {
    name: "Wave 10",
    durationSeconds: 120,
    budgetPerSecond: 40,
    enemyCosts: { ...BASE_ENEMY_COSTS },
    continuousSpawnMix: {
      SmallChaser: 40,
      MediumChaser: 30,
      RangedShooter: 20,
      Tank: 10,
    },
    timedEvents: [
      {
        triggerTime: 100,
        eventType: "MixedGroup",
        enemies: [
          { type: "SmallChaser", count: 50 },
          { type: "MediumChaser", count: 20 },
          { type: "RangedShooter", count: 15 },
          { type: "Tank", count: 5 },
        ],
      },
    ],
  },
];
