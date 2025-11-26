import { Component } from './Component';
import type { Entity } from '../Entity';

export interface AIBehaviorConfig {
  behavior: 'slime' | 'brute' | 'spitter';
  aggressionRadius?: number;
  attackRange?: number;
  idealRangeMin?: number;
  idealRangeMax?: number;
  retreatRange?: number;
  attackCooldown?: number;
  attackLockDuration?: number;
  attackWindup?: number;
  recoveryDuration?: number;
  moveSpeed?: number;
  targetResolver?: () => Entity | null;
  attackHandler?: (enemy: Entity, dirX: number, dirY: number) => void;
}

export class AIComponent extends Component {
  public name = 'AI';
  public behavior: 'slime' | 'brute' | 'spitter';
  public aggressionRadius: number;
  public attackRange: number;
  public idealRangeMin: number;
  public idealRangeMax: number;
  public retreatRange: number;
  public attackCooldown: number;
  public attackLockDuration: number;
  public attackWindup: number;
  public recoveryDuration: number;
  public moveSpeed: number;
  public targetResolver?: () => Entity | null;
  public attackHandler?: (enemy: Entity, dirX: number, dirY: number) => void;
  public cooldownTimer: number = 0;
  public lockedTimer: number = 0;

  constructor(config: AIBehaviorConfig) {
    super();
    this.behavior = config.behavior;
    this.aggressionRadius = config.aggressionRadius ?? 200;
    this.attackRange = config.attackRange ?? 12;
    this.idealRangeMin = config.idealRangeMin ?? this.attackRange;
    this.idealRangeMax = config.idealRangeMax ?? this.attackRange * 2;
    this.retreatRange = config.retreatRange ?? this.attackRange;
    this.attackCooldown = config.attackCooldown ?? 45;
    this.attackLockDuration = config.attackLockDuration ?? 0;
    this.attackWindup = config.attackWindup ?? 0;
    this.recoveryDuration = config.recoveryDuration ?? 0;
    this.moveSpeed = config.moveSpeed ?? 1;
    this.targetResolver = config.targetResolver;
    this.attackHandler = config.attackHandler;
  }
}

