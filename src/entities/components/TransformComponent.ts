import { Component } from './Component';

export class TransformComponent extends Component {
  public name = 'Transform';
  public x: number;
  public y: number;
  public width: number;
  public height: number;
  public vx: number = 0;
  public vy: number = 0;
  public speed: number = 0;
  public directionX: number = 1;
  public directionY: number = 0;

  constructor(x: number, y: number, width: number, height: number) {
    super();
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
}

