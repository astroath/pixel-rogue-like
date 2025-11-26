export type Action =
  | 'Move'
  | 'Aim'
  | 'PrimaryAttack'
  | 'SecondaryAttack'
  | 'Dash'
  | 'Interact'
  | 'CycleWeapon'
  | 'Pause'
  | 'UINavigate'
  | 'UISubmit'
  | 'UICancel';

export interface ActionState {
  isDown: boolean;
  justPressed: boolean;
  justReleased: boolean;
  holdDuration: number;
  vx: number;
  vy: number;
  value: number;
}

export interface PointerState {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  dx: number;
  dy: number;
}

export interface InputSnapshot {
  frame: number;
  time: number;
  actions: Record<Action, { d: boolean; p: boolean; r: boolean; h: number; vx: number; vy: number; v: number }>;
  pointer: { sx: number; sy: number; wx: number; wy: number; dx: number; dy: number };
}

export interface InputOptions {
  viewportWidth: number;
  viewportHeight: number;
  getWorldPosition?: (sx: number, sy: number) => { wx: number; wy: number };
  deadzone?: number;
}

type KeyCode = string;

interface Bindings {
  keyToActions: Map<KeyCode, Action[]>;
  mouseToActions: Map<number, Action[]>;
}

export class InputManager {
  private canvas: HTMLCanvasElement;
  private options: InputOptions;
  private bindings: Bindings;
  private states: Map<Action, ActionState>;
  private prevDown: Map<Action, boolean>;
  private pressedKeys: Set<KeyCode>;
  private pressedMouseButtons: Set<number>;
  private wheelPulse: number;
  private pointer: PointerState;
  private lastPointerSx: number;
  private lastPointerSy: number;
  private uiFocused: boolean;
  private recordSnapshots: boolean;
  private snapshots: InputSnapshot[];
  private frame: number;
  private gamepadDeadzone: number;

  constructor(canvas: HTMLCanvasElement, options: InputOptions, bindings?: Bindings) {
    this.canvas = canvas;
    this.options = options;
    this.bindings = bindings ?? this.defaultBindings();
    this.states = new Map<Action, ActionState>();
    this.prevDown = new Map<Action, boolean>();
    this.pressedKeys = new Set<KeyCode>();
    this.pressedMouseButtons = new Set<number>();
    this.wheelPulse = 0;
    this.pointer = { sx: 0, sy: 0, wx: 0, wy: 0, dx: 0, dy: 0 };
    this.lastPointerSx = 0;
    this.lastPointerSy = 0;
    this.uiFocused = false;
    this.recordSnapshots = false;
    this.snapshots = [];
    this.frame = 0;
    this.gamepadDeadzone = options.deadzone ?? 0.15;
    this.initStates();
    this.attachEvents();
  }

  enableSnapshots(enabled: boolean) {
    this.recordSnapshots = enabled;
  }

  setUIFocused(focused: boolean) {
    this.uiFocused = focused;
  }

  setBindings(bindings: Bindings) {
    this.bindings = bindings;
  }

  get(action: Action): ActionState {
    return this.states.get(action)!;
  }

  getPointer(): PointerState {
    return this.pointer;
  }

  poll(now: number) {
    this.frame++;
    this.updatePointerWorld();
    this.updateContinuousStates();
    this.updateDiscreteStates();
    this.applyGamepad();
    this.finalizeStates();
    if (this.recordSnapshots) this.record(now);
  }

  getSnapshots(): InputSnapshot[] {
    return this.snapshots;
  }

  clearSnapshots() {
    this.snapshots.length = 0;
  }

  private initStates() {
    const actions: Action[] = [
      'Move',
      'Aim',
      'PrimaryAttack',
      'SecondaryAttack',
      'Dash',
      'Interact',
      'CycleWeapon',
      'Pause',
      'UINavigate',
      'UISubmit',
      'UICancel',
    ];
    for (const a of actions) {
      this.states.set(a, { isDown: false, justPressed: false, justReleased: false, holdDuration: 0, vx: 0, vy: 0, value: 0 });
      this.prevDown.set(a, false);
    }
  }

  private attachEvents() {
    window.addEventListener('keydown', e => {
      this.pressedKeys.add(e.code);
    });
    window.addEventListener('keyup', e => {
      this.pressedKeys.delete(e.code);
    });
    window.addEventListener('mousedown', e => {
      this.pressedMouseButtons.add(e.button);
      this.updatePointerFromEvent(e);
    });
    window.addEventListener('mouseup', e => {
      this.pressedMouseButtons.delete(e.button);
    });
    window.addEventListener('mousemove', e => this.updatePointerFromEvent(e));
    this.canvas.addEventListener('wheel', e => {
      if (e.deltaY < 0) this.wheelPulse = 1; else if (e.deltaY > 0) this.wheelPulse = -1;
    });
    window.addEventListener('blur', () => {
      this.pressedKeys.clear();
      this.pressedMouseButtons.clear();
      for (const s of this.states.values()) {
        s.isDown = false;
      }
    });
  }

  private updatePointerFromEvent(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const scaleX = this.options.viewportWidth / rect.width;
    const scaleY = this.options.viewportHeight / rect.height;
    const isx = sx * scaleX;
    const isy = sy * scaleY;
    this.pointer.dx = isx - this.lastPointerSx;
    this.pointer.dy = isy - this.lastPointerSy;
    this.lastPointerSx = isx;
    this.lastPointerSy = isy;
    this.pointer.sx = isx;
    this.pointer.sy = isy;
  }

  private defaultBindings(): Bindings {
    const keyToActions = new Map<KeyCode, Action[]>();
    keyToActions.set('KeyW', ['Move']);
    keyToActions.set('ArrowUp', ['Move']);
    keyToActions.set('KeyS', ['Move']);
    keyToActions.set('ArrowDown', ['Move']);
    keyToActions.set('KeyA', ['Move']);
    keyToActions.set('ArrowLeft', ['Move']);
    keyToActions.set('KeyD', ['Move']);
    keyToActions.set('ArrowRight', ['Move']);
    keyToActions.set('Space', ['Dash']);
    keyToActions.set('ShiftLeft', ['Dash']);
    keyToActions.set('KeyE', ['Interact']);
    keyToActions.set('KeyQ', ['CycleWeapon']);
    keyToActions.set('KeyR', ['CycleWeapon']);
    keyToActions.set('Escape', ['Pause']);
    keyToActions.set('Enter', ['UISubmit']);
    keyToActions.set('Backspace', ['UICancel']);
    const mouseToActions = new Map<number, Action[]>();
    mouseToActions.set(0, ['PrimaryAttack']);
    mouseToActions.set(2, ['SecondaryAttack']);
    return { keyToActions, mouseToActions };
  }

  private updatePointerWorld() {
    if (this.options.getWorldPosition) {
      const p = this.options.getWorldPosition(this.pointer.sx, this.pointer.sy);
      this.pointer.wx = p.wx;
      this.pointer.wy = p.wy;
    } else {
      this.pointer.wx = this.pointer.sx;
      this.pointer.wy = this.pointer.sy;
    }
  }

  private updateContinuousStates() {
    const move = this.states.get('Move')!;
    let mx = 0;
    let my = 0;
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) mx += 1;
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) mx -= 1;
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) my += 1;
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) my -= 1;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      move.vx = mx / len;
      move.vy = my / len;
      move.isDown = true;
    } else {
      move.vx = 0;
      move.vy = 0;
      move.isDown = false;
    }
    const aim = this.states.get('Aim')!;
    const cx = this.options.viewportWidth * 0.5;
    const cy = this.options.viewportHeight * 0.5;
    const ax = this.pointer.sx - cx;
    const ay = this.pointer.sy - cy;
    if (ax !== 0 || ay !== 0) {
      const len = Math.hypot(ax, ay);
      aim.vx = ax / len;
      aim.vy = ay / len;
      aim.isDown = true;
    } else {
      aim.vx = 0;
      aim.vy = 0;
      aim.isDown = false;
    }
  }

  private updateDiscreteStates() {
    for (const [code, actions] of this.bindings.keyToActions) {
      const down = this.pressedKeys.has(code);
      for (const a of actions) {
        const s = this.states.get(a)!;
        if (a === 'CycleWeapon') continue;
        if (this.uiFocused) {
          if (a === 'UISubmit' || a === 'UICancel' || a === 'UINavigate') s.isDown = s.isDown || down;
        } else {
          if (a !== 'UISubmit' && a !== 'UICancel' && a !== 'UINavigate') s.isDown = s.isDown || down;
        }
      }
    }
    for (const [btn, actions] of this.bindings.mouseToActions) {
      const down = this.pressedMouseButtons.has(btn);
      for (const a of actions) {
        const s = this.states.get(a)!;
        if (this.uiFocused && (a === 'PrimaryAttack' || a === 'SecondaryAttack')) continue;
        s.isDown = s.isDown || down;
      }
    }
    if (this.wheelPulse !== 0) {
      const s = this.states.get('CycleWeapon')!;
      s.isDown = true;
      s.value = this.wheelPulse;
      this.wheelPulse = 0;
    } else {
      const s = this.states.get('CycleWeapon')!;
      s.isDown = false;
      s.value = 0;
    }
  }

  private applyGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return;
    const p = pads[0];
    if (!p) return;
    const ax0 = p.axes[0] ?? 0;
    const ay0 = p.axes[1] ?? 0;
    const ax1 = p.axes[2] ?? 0;
    const ay1 = p.axes[3] ?? 0;
    const dz = this.gamepadDeadzone;
    const move = this.states.get('Move')!;
    let mx = Math.abs(ax0) > dz ? ax0 : 0;
    let my = Math.abs(ay0) > dz ? ay0 : 0;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      move.vx = mx / len;
      move.vy = my / len;
      move.isDown = true;
    }
    const aim = this.states.get('Aim')!;
    let ax = Math.abs(ax1) > dz ? ax1 : 0;
    let ay = Math.abs(ay1) > dz ? ay1 : 0;
    if (ax !== 0 || ay !== 0) {
      const len = Math.hypot(ax, ay);
      aim.vx = ax / len;
      aim.vy = ay / len;
      aim.isDown = true;
    }
    const primary = this.states.get('PrimaryAttack')!;
    const secondary = this.states.get('SecondaryAttack')!;
    const dash = this.states.get('Dash')!;
    const interact = this.states.get('Interact')!;
    if (p.buttons[0] && p.buttons[0].pressed) primary.isDown = true;
    if (p.buttons[1] && p.buttons[1].pressed) secondary.isDown = true;
    if (p.buttons[2] && p.buttons[2].pressed) interact.isDown = true;
    if (p.buttons[3] && p.buttons[3].pressed) dash.isDown = true;
    const rt = p.buttons[7]?.value ?? 0;
    if (rt > dz) {
      primary.isDown = true;
      primary.value = rt;
    }
  }

  private finalizeStates() {
    for (const [a, s] of this.states) {
      const prev = this.prevDown.get(a)!;
      const down = s.isDown;
      s.justPressed = down && !prev;
      s.justReleased = !down && prev;
      if (down) s.holdDuration += 16; else s.holdDuration = 0;
      this.prevDown.set(a, down);
      s.isDown = false;
    }
  }

  private record(now: number) {
    const actions: Record<Action, { d: boolean; p: boolean; r: boolean; h: number; vx: number; vy: number; v: number }> = {
      Move: this.snapshotOf('Move'),
      Aim: this.snapshotOf('Aim'),
      PrimaryAttack: this.snapshotOf('PrimaryAttack'),
      SecondaryAttack: this.snapshotOf('SecondaryAttack'),
      Dash: this.snapshotOf('Dash'),
      Interact: this.snapshotOf('Interact'),
      CycleWeapon: this.snapshotOf('CycleWeapon'),
      Pause: this.snapshotOf('Pause'),
      UINavigate: this.snapshotOf('UINavigate'),
      UISubmit: this.snapshotOf('UISubmit'),
      UICancel: this.snapshotOf('UICancel'),
    };
    const pointer = { sx: this.pointer.sx, sy: this.pointer.sy, wx: this.pointer.wx, wy: this.pointer.wy, dx: this.pointer.dx, dy: this.pointer.dy };
    this.snapshots.push({ frame: this.frame, time: now, actions, pointer });
  }

  private snapshotOf(a: Action) {
    const s = this.states.get(a)!;
    return { d: this.prevDown.get(a)!, p: s.justPressed, r: s.justReleased, h: s.holdDuration, vx: s.vx, vy: s.vy, v: s.value };
  }
}
