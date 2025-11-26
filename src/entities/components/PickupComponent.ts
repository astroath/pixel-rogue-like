import { Component } from './Component';

export type PickupKind = 'xp' | 'ore-common' | 'ore-rare';

export class PickupComponent extends Component {
  public name = 'Pickup';
  public kind: PickupKind;
  public value: number;

  constructor(kind: PickupKind, value: number) {
    super();
    this.kind = kind;
    this.value = value;
  }
}
