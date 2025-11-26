import { Sprite, Texture, BufferImageSource } from 'pixi.js';

export interface PixelMapOptions {
  worldWidth: number;
  worldHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  virtualPixelScale?: number;
}

export type PixelColor = number;

export interface PixelOffset {
  dx: number;
  dy: number;
  color: PixelColor;
}

export interface PixelPattern {
  pixels: PixelOffset[];
}

export class PixelMap {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly virtualPixelScale: number;

  private buffer: Uint8Array;
  private texture: Texture;
  private sprite: Sprite;
  private cameraX = 0;
  private cameraY = 0;

  constructor(options: PixelMapOptions) {
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.virtualPixelScale = options.virtualPixelScale ?? 4;

    this.buffer = new Uint8Array(this.worldWidth * this.worldHeight * 4);

    this.texture = this.createTextureFromBuffer(this.buffer, this.worldWidth, this.worldHeight);

    this.sprite = new Sprite(this.texture);
    this.sprite.x = 0;
    this.sprite.y = 0;
    this.sprite.width = this.viewportWidth;
    this.sprite.height = this.viewportHeight;
    this.updateCameraFrame();
  }

  get view(): Sprite {
    return this.sprite;
  }

  clear(color: PixelColor = 0x000000): void {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const a = 0xff;
    for (let i = 0; i < this.buffer.length; i += 4) {
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
      this.buffer[i + 3] = a;
    }
  }

  drawTile(tileX: number, tileY: number, color: PixelColor): void {
    const { x, y } = this.tileToPixel(tileX, tileY);
    this.fillRect(x, y, 4, 4, color);
  }

  drawEntity(px: number, py: number, pattern: PixelPattern): void {
    for (const p of pattern.pixels) {
      this.writePixel(px + p.dx, py + p.dy, p.color);
    }
  }

  drawParticle(px: number, py: number, color: PixelColor): void {
    this.writePixel(px, py, color);
  }

  render(): void {
    this.upload();
  }

  setCamera(x: number, y: number): void {
    this.cameraX = Math.max(0, Math.min(x, this.worldWidth - this.viewportWidth));
    this.cameraY = Math.max(0, Math.min(y, this.worldHeight - this.viewportHeight));
    this.updateCameraFrame();
  }

  getCamera(): { x: number; y: number } {
    return { x: this.cameraX, y: this.cameraY };
  }

  setFilters(filters: any[] | null): void {
    (this.sprite as any).filters = filters ?? null;
  }

  tileToPixel(tileX: number, tileY: number): { x: number; y: number } {
    return { x: tileX * 4, y: tileY * 4 };
  }

  private writePixel(px: number, py: number, color: PixelColor): void {
    if (px < 0 || py < 0 || px >= this.worldWidth || py >= this.worldHeight) return;
    const idx = (py * this.worldWidth + px) * 4;
    this.buffer[idx] = (color >> 16) & 0xff;
    this.buffer[idx + 1] = (color >> 8) & 0xff;
    this.buffer[idx + 2] = color & 0xff;
    this.buffer[idx + 3] = 0xff;
  }

  private fillRect(x: number, y: number, w: number, h: number, color: PixelColor): void {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const a = 0xff;
    const width = this.worldWidth;
    for (let yy = 0; yy < h; yy++) {
      const py = y + yy;
      if (py < 0 || py >= this.worldHeight) continue;
      let idx = (py * width + x) * 4;
      for (let xx = 0; xx < w; xx++) {
        const px = x + xx;
        if (px < 0 || px >= this.worldWidth) {
          idx += 4;
          continue;
        }
        this.buffer[idx] = r;
        this.buffer[idx + 1] = g;
        this.buffer[idx + 2] = b;
        this.buffer[idx + 3] = a;
        idx += 4;
      }
    }
  }

  private updateCameraFrame(): void {
    this.sprite.texture = this.texture;
    this.sprite.x = -this.cameraX;
    this.sprite.y = -this.cameraY;
    this.sprite.width = this.worldWidth;
    this.sprite.height = this.worldHeight;
  }

  private upload(): void {
    const tex = this.sprite.texture;
    const source = tex.source;
    if (source instanceof BufferImageSource) {
      source.update();
    }
  }

  private createTextureFromBuffer(data: Uint8Array, width: number, height: number): Texture {
    const source = new BufferImageSource({
      resource: data,
      width,
      height,
    });
    return new Texture({ source });
  }
}
