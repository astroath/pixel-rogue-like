import { Application, TextureSource } from 'pixi.js';

export interface RendererOptions {
    width: number;
    height: number;
    backgroundColor: number;
}

export class Renderer {
    private app: Application;
    private logicalWidth: number;
    private logicalHeight: number;
    private bgColor: number;

    constructor(options: RendererOptions) {
        this.logicalWidth = options.width;
        this.logicalHeight = options.height;
        this.bgColor = options.backgroundColor;
        this.app = new Application();
    }

    public async init(): Promise<void> {
        await this.app.init({
            width: this.logicalWidth,
            height: this.logicalHeight,
            backgroundColor: this.bgColor,
            preference: 'webgl', // Prefer WebGL
            // Pixel art settings
            antialias: false,
            roundPixels: true,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
        });

        TextureSource.defaultOptions.scaleMode = 'nearest';

        // Append canvas to body
        document.body.appendChild(this.app.canvas);

        // Setup resizing
        window.addEventListener('resize', this.resize.bind(this));
        this.resize();
    }

    private resize(): void {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // Simple letterboxing / scaling strategy
        const scale = Math.min(
            windowWidth / this.logicalWidth,
            windowHeight / this.logicalHeight
        );

        // Enforce integer scaling for crisp pixels and text.
        const intScale = Math.max(1, Math.floor(scale));
        const newWidth = Math.floor(this.logicalWidth * intScale);
        const newHeight = Math.floor(this.logicalHeight * intScale);

        // Keep internal resolution as the logical size; scale via CSS.
        this.app.canvas.style.width = `${newWidth}px`;
        this.app.canvas.style.height = `${newHeight}px`;
        
        // Center it
        this.app.canvas.style.position = 'absolute';
        this.app.canvas.style.left = `${(windowWidth - newWidth) / 2}px`;
        this.app.canvas.style.top = `${(windowHeight - newHeight) / 2}px`;
    }

    public get stage() {
        return this.app.stage;
    }

    public get ticker() {
        return this.app.ticker;
    }

    public get canvas() {
        return this.app.canvas;
    }
}
