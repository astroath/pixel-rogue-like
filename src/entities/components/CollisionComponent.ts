import { Component } from './Component';

export class CollisionComponent extends Component {
  public name = 'Collision';
  public radius: number;

  constructor(radius: number) {
    super();
    this.radius = Math.max(0, radius);
  }
}

