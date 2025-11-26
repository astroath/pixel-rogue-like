import { Entity } from './Entity';
import { TransformComponent } from './components/TransformComponent';
import { AttackComponent } from './components/AttackComponent';
import { AIComponent } from './components/AIComponent';
import { TileMap } from '../world/TileMap';

export class EntityManager {
  private entities: Entity[] = [];
  public enemies: Entity[] = [];
  public pickups: Entity[] = [];
  public player: Entity | null = null;
  private nextId = 1;
  private tileMap?: TileMap;

  public setTileMap(tileMap: TileMap): void {
    this.tileMap = tileMap;
  }

  public createEntity(type: string): Entity {
    const entity = new Entity(this.nextId++, type);
    this.entities.push(entity);
    if (type === 'player') this.player = entity;
    if (type === 'enemy') this.enemies.push(entity);
    if (type === 'pickup') this.pickups.push(entity);
    return entity;
  }

  public removeEntity(entity: Entity): void {
    entity.active = false;
    if (entity === this.player) this.player = null;
    this.entities = this.entities.filter((e) => e !== entity);
    this.enemies = this.enemies.filter((e) => e !== entity);
    this.pickups = this.pickups.filter((e) => e !== entity);
  }

  public getAllEntities(): Entity[] {
    return this.entities;
  }

  public update(dt: number): void {
    for (const entity of this.entities) {
      if (!entity.active) continue;
      const transform = entity.getComponent<TransformComponent>('Transform');
      if (transform) {
        transform.x += transform.vx * dt;
        transform.y += transform.vy * dt;
        if (this.tileMap) {
          const maxX = this.tileMap.width * this.tileMap.virtualPixelScale - transform.width;
          const maxY = this.tileMap.height * this.tileMap.virtualPixelScale - transform.height;
          transform.x = Math.max(0, Math.min(maxX, transform.x));
          transform.y = Math.max(0, Math.min(maxY, transform.y));
        }
      }
      const attack = entity.getComponent<AttackComponent>('Attack');
      if (attack) attack.tick(dt);
      const ai = entity.getComponent<AIComponent>('AI');
      if (ai && transform) {
        ai.cooldownTimer = Math.max(0, ai.cooldownTimer - dt);
        ai.lockedTimer = Math.max(0, ai.lockedTimer - dt);
        const target = ai.targetResolver?.() ?? this.player;
        const tTransform = target?.getComponent<TransformComponent>('Transform');
        if (target && tTransform) {
          const dx = tTransform.x - transform.x;
          const dy = tTransform.y - transform.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist <= ai.aggressionRadius) {
            let dirX = dx / dist;
            let dirY = dy / dist;
            if (ai.behavior === 'spitter') {
              if (dist < ai.idealRangeMin) {
                dirX = -dirX;
                dirY = -dirY;
              } else if (dist > ai.idealRangeMax) {
              } else {
                dirX = 0;
                dirY = 0;
              }
            }
            const moveSpeed = transform.speed * (ai.moveSpeed > 0 ? ai.moveSpeed : 1);
            transform.vx = dirX * moveSpeed;
            transform.vy = dirY * moveSpeed;
            const canAttack = dist <= (ai.attackRange || attack?.range || 0);
            if (canAttack && (!attack || attack.lockTimer <= 0) && ai.cooldownTimer <= 0 && ai.lockedTimer <= 0) {
              if (attack) attack.trigger();
              ai.cooldownTimer = ai.attackCooldown;
              ai.lockedTimer = ai.attackLockDuration;
              ai.attackHandler?.(entity, dx / dist, dy / dist);
            }
          } else {
            transform.vx = 0;
            transform.vy = 0;
          }
        }
      }
    }
  }
}

