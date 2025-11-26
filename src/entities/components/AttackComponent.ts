import { Component } from './Component';

export class AttackComponent extends Component {
  public name = 'Attack';
  public damage: number;
  public cooldown: number;
  public range: number;
  public timer: number = 0;
  public lockTimer: number = 0;

  constructor(damage: number, cooldownFrames: number, range: number) {
    super();
    this.damage = Math.max(0, damage);
    this.cooldown = Math.max(0, cooldownFrames);
    this.range = Math.max(0, range);
  }

  public ready(): boolean {
    return this.timer <= 0;
  }

  public tick(dt: number): void {
    if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
    if (this.lockTimer > 0) this.lockTimer = Math.max(0, this.lockTimer - dt);
  }

  public trigger(): void {
    this.timer = this.cooldown;
  }
}

