import { Component } from './Component';

export class HealthComponent extends Component {
  public name = 'Health';
  public max: number;
  public current: number;
  public invulnTimer: number;

  constructor(max: number, invulnFrames: number = 0) {
    super();
    this.max = Math.max(1, Math.round(max));
    this.current = this.max;
    this.invulnTimer = Math.max(0, invulnFrames);
  }

  public heal(amount: number): void {
    if (amount <= 0) return;
    this.current = Math.min(this.max, this.current + amount);
  }

  public takeDamage(amount: number): void {
    const dmg = Math.max(0, amount);
    if (dmg <= 0) return;
    this.current = Math.max(0, this.current - dmg);
    this.invulnTimer = Math.max(0, this.invulnTimer);
  }

  public update(dt: number): void {
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    }
  }

  public isDead(): boolean {
    return this.current <= 0;
  }
}

