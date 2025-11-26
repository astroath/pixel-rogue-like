export type SoundCategory = 'sfx' | 'ui' | 'music';
export type VolumeCategory = SoundCategory | 'master';

export interface SoundAsset {
  id: string;
  type: SoundCategory;
  src: string;
  baseVolume?: number;
  variations?: {
    pitchMin?: number;
    pitchMax?: number;
  };
}

export interface PlayOptions {
  volume?: number;
  pitch?: number;
  detune?: number;
  loop?: boolean;
  priority?: number;
}

export interface SoundSettings {
  master: number;
  sfx: number;
  ui: number;
  music: number;
  muted: boolean;
  mutedCategories: Record<SoundCategory, boolean>;
}

interface LoadedSound extends SoundAsset {
  buffer?: AudioBuffer;
  element?: HTMLAudioElement;
}

interface ActiveSfx {
  id: string;
  category: SoundCategory;
  priority: number;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  element?: HTMLAudioElement;
}

interface MusicState {
  id: string;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  element?: HTMLAudioElement;
}

const SETTINGS_KEY = 'sound_settings';

const DEFAULT_SETTINGS: SoundSettings = {
  master: 1,
  sfx: 0.8,
  ui: 0.8,
  music: 0.7,
  muted: false,
  mutedCategories: {
    sfx: false,
    ui: false,
    music: false,
  },
};

export class SoundManager {
  private audioContext?: AudioContext;
  private masterGain?: GainNode;
  private categoryGains?: Record<SoundCategory, GainNode>;
  private registry = new Map<string, LoadedSound>();
  private gainPool: GainNode[] = [];
  private activeSfx: ActiveSfx[] = [];
  private currentMusic?: MusicState;
  private settings: SoundSettings = { ...DEFAULT_SETTINGS };
  private settingsListeners: Array<(settings: SoundSettings) => void> = [];
  private maxSimultaneousSfx = 20;
  private unlockHandlerAttached = false;

  public async init(): Promise<void> {
    this.settings = this.loadSettings();
    this.ensureContext();
    this.applySettingsToGains();
  }

  public async loadAssets(assets: SoundAsset[]): Promise<void> {
    const ctx = this.ensureContext();
    const tasks = assets.map(async (asset) => {
      const entry: LoadedSound = { ...asset, baseVolume: asset.baseVolume ?? 1 };
      this.registry.set(asset.id, entry);
      if (!ctx) {
        entry.element = this.createHtmlAudio(asset.src);
        return;
      }
      try {
        const resp = await fetch(asset.src);
        const data = await resp.arrayBuffer();
        entry.buffer = await ctx.decodeAudioData(data);
      } catch (_err) {
        // Fall back to HTML audio when decoding fails.
        entry.element = this.createHtmlAudio(asset.src);
      }
    });
    await Promise.all(tasks);
  }

  public playSFX(id: string, options?: PlayOptions): void {
    this.playOneShot(id, 'sfx', options);
  }

  public playUI(id: string, options?: PlayOptions): void {
    this.playOneShot(id, 'ui', options);
  }

  public async playMusic(id: string, fadeTime: number = 0.5): Promise<void> {
    const entry = this.registry.get(id);
    if (!entry || entry.type !== 'music') return;
    const ctx = this.ensureContext();
    const desiredVolume = entry.baseVolume ?? 1;

    // If the same track is already playing, just update volume/mute state.
    if (this.currentMusic?.id === id) {
      this.fadeGain(this.currentMusic.gain, desiredVolume, fadeTime);
      if (this.currentMusic.element) {
        const targetVolume = this.computeFallbackVolume('music', desiredVolume, 1);
        this.fadeHtmlAudio(this.currentMusic.element, targetVolume, fadeTime);
      }
      this.applySettingsToGains();
      this.updateFallbackVolumes();
      return;
    }

    const oldMusic = this.currentMusic;
    this.currentMusic = undefined;

    if (ctx && entry.buffer) {
      const source = ctx.createBufferSource();
      source.buffer = entry.buffer;
      source.loop = true;
      const gain = this.acquireGainNode();
      gain.gain.value = 0;
      source.connect(gain);
      const categoryGain = this.getCategoryGain('music') ?? this.getMasterGain();
      gain.connect(categoryGain);
      source.start();
      this.currentMusic = { id, source, gain };
      this.fadeGain(gain, desiredVolume, fadeTime);
    } else {
      const element = this.createHtmlAudio(entry.src);
      element.loop = true;
      const targetVolume = this.computeFallbackVolume('music', desiredVolume, 1);
      element.volume = targetVolume;
      element.currentTime = 0;
      void element.play().catch(() => {});
      this.currentMusic = { id, element };
      this.fadeHtmlAudio(element, targetVolume, fadeTime);
    }

    if (oldMusic) {
      this.fadeOutAndStopMusic(oldMusic, fadeTime);
    }
    this.applySettingsToGains();
    this.updateFallbackVolumes();
  }

  public stopMusic(fadeTime: number = 0.5): void {
    if (!this.currentMusic) return;
    this.fadeOutAndStopMusic(this.currentMusic, fadeTime);
    this.currentMusic = undefined;
  }

  public setVolume(category: VolumeCategory, value: number): void {
    const v = this.clamp01(value);
    if (category === 'master') {
      this.settings.master = v;
    } else {
      this.settings[category] = v;
    }
    this.persistSettings();
    this.applySettingsToGains();
    this.updateFallbackVolumes();
  }

  public mute(category: VolumeCategory, state: boolean = true): void {
    if (category === 'master') {
      this.settings.muted = state;
    } else {
      this.settings.mutedCategories[category] = state;
    }
    this.persistSettings();
    this.applySettingsToGains();
    this.updateFallbackVolumes();
  }

  public toggleMute(category: VolumeCategory): void {
    if (category === 'master') {
      this.mute('master', !this.settings.muted);
    } else {
      this.mute(category, !this.settings.mutedCategories[category]);
    }
  }

  public getSettings(): SoundSettings {
    return {
      master: this.settings.master,
      sfx: this.settings.sfx,
      ui: this.settings.ui,
      music: this.settings.music,
      muted: this.settings.muted,
      mutedCategories: { ...this.settings.mutedCategories },
    };
  }

  public onSettingsChanged(listener: (settings: SoundSettings) => void): void {
    this.settingsListeners.push(listener);
  }

  public getDebugState() {
    return {
      activeSfx: this.activeSfx.length,
      music: this.currentMusic?.id ?? 'none',
      settings: this.getSettings(),
    };
  }

  private playOneShot(id: string, fallbackCategory: SoundCategory, options?: PlayOptions): void {
    const entry = this.registry.get(id);
    const category = entry?.type ?? fallbackCategory;
    const priority = options?.priority ?? 0;

    if (!this.canPlayCategory(category)) return;
    if (!this.enforceSfxLimit(priority)) return;

    const ctx = this.ensureContext();
    if (ctx && entry?.buffer) {
      const source = ctx.createBufferSource();
      source.buffer = entry.buffer;
      source.loop = options?.loop ?? false;
      const pitch = this.pickPitch(entry, options);
      source.playbackRate.value = pitch;
      if (options?.detune !== undefined && source.detune) {
        source.detune.value = options.detune;
      }
      const gain = this.acquireGainNode();
      const voiceVolume = this.computeVoiceVolume(entry, options);
      gain.gain.value = voiceVolume;
      source.connect(gain);
      gain.connect(this.getCategoryGain(category) ?? this.getMasterGain());
      const record: ActiveSfx = { id, category, source, gain, priority };
      this.activeSfx.push(record);
      source.onended = () => this.releaseActiveSfx(record);
      source.start();
    } else if (entry?.element) {
      const element = entry.element.cloneNode(true) as HTMLAudioElement;
      element.loop = options?.loop ?? false;
      element.volume = this.computeFallbackVolume(category, entry.baseVolume ?? 1, options?.volume ?? 1);
      const record: ActiveSfx = { id, category, element, priority };
      this.activeSfx.push(record);
      element.onended = () => this.releaseActiveSfx(record);
      void element.play().catch(() => this.releaseActiveSfx(record));
    }
  }

  private enforceSfxLimit(priority: number): boolean {
    if (this.activeSfx.length < this.maxSimultaneousSfx) return true;
    let dropIndex = 0;
    for (let i = 1; i < this.activeSfx.length; i++) {
      if (this.activeSfx[i].priority < this.activeSfx[dropIndex].priority) {
        dropIndex = i;
      }
    }
    const lowest = this.activeSfx[dropIndex];
    if (lowest.priority > priority) {
      return false;
    }
    this.stopActiveSfx(lowest);
    this.activeSfx.splice(dropIndex, 1);
    return true;
  }

  private pickPitch(entry: LoadedSound, options?: PlayOptions): number {
    const basePitch = options?.pitch ?? 1;
    if (!entry.variations) return basePitch;
    const min = entry.variations.pitchMin ?? 1;
    const max = entry.variations.pitchMax ?? 1;
    if (min === max) return basePitch * min;
    const t = Math.random();
    return basePitch * (min + (max - min) * t);
  }

  private computeVoiceVolume(entry: LoadedSound, options?: PlayOptions): number {
    const base = entry.baseVolume ?? 1;
    const opt = options?.volume ?? 1;
    return Math.max(0, base * opt);
  }

  private computeFallbackVolume(category: SoundCategory, baseVolume: number, optionVolume: number): number {
    const catVolume = this.settings[category];
    const muted = this.settings.muted || this.settings.mutedCategories[category];
    if (muted) return 0;
    return this.clamp01(baseVolume * optionVolume * this.settings.master * catVolume);
  }

  private releaseActiveSfx(record: ActiveSfx): void {
    this.stopActiveSfx(record);
    const idx = this.activeSfx.indexOf(record);
    if (idx >= 0) {
      this.activeSfx.splice(idx, 1);
    }
  }

  private stopActiveSfx(record: ActiveSfx): void {
    if (record.source) {
      try {
        record.source.stop();
      } catch {
        // ignore
      }
      record.source.disconnect();
    }
    if (record.gain) {
      this.releaseGainNode(record.gain);
    }
    if (record.element) {
      record.element.pause();
      record.element.currentTime = 0;
    }
  }

  private fadeOutAndStopMusic(state: MusicState, fadeTime: number): void {
    if (state.gain) {
      this.fadeGain(state.gain, 0, fadeTime);
      setTimeout(() => {
        try {
          state.source?.stop();
        } catch {
          // ignore
        }
        state.source?.disconnect();
        if (state.gain) {
          this.releaseGainNode(state.gain);
        }
      }, fadeTime * 1000 + 50);
    } else if (state.element) {
      this.fadeHtmlAudio(state.element, 0, fadeTime, true);
    } else if (state.source) {
      try {
        state.source.stop();
      } catch {
        // ignore
      }
    }
  }

  private fadeGain(gain: GainNode | undefined, target: number, duration: number): void {
    if (!gain || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + Math.max(0.01, duration));
  }

  private fadeHtmlAudio(element: HTMLAudioElement, target: number, duration: number, stopAfter: boolean = false): void {
    const startVolume = element.volume;
    const change = target - startVolume;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / Math.max(1, duration * 1000));
      element.volume = this.clamp01(startVolume + change * t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else if (stopAfter) {
        element.pause();
        element.currentTime = 0;
      }
    };
    requestAnimationFrame(step);
  }

  private canPlayCategory(category: SoundCategory): boolean {
    if (this.settings.muted) return false;
    if (this.settings.mutedCategories[category]) return false;
    return this.settings[category] > 0 && this.settings.master > 0;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.audioContext) return this.audioContext;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return undefined;
    this.audioContext = new Ctx();
    this.masterGain = this.audioContext.createGain();
    this.categoryGains = {
      sfx: this.audioContext.createGain(),
      ui: this.audioContext.createGain(),
      music: this.audioContext.createGain(),
    };
    this.categoryGains.sfx.connect(this.masterGain);
    this.categoryGains.ui.connect(this.masterGain);
    this.categoryGains.music.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);
    this.applySettingsToGains();
    this.attachUnlockHandler();
    return this.audioContext;
  }

  private getMasterGain(): GainNode {
    if (!this.masterGain && this.audioContext) {
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
    }
    return this.masterGain as GainNode;
  }

  private getCategoryGain(category: SoundCategory): GainNode | undefined {
    if (!this.categoryGains && this.audioContext) {
      this.categoryGains = {
        sfx: this.audioContext.createGain(),
        ui: this.audioContext.createGain(),
        music: this.audioContext.createGain(),
      };
      this.categoryGains.sfx.connect(this.getMasterGain());
      this.categoryGains.ui.connect(this.getMasterGain());
      this.categoryGains.music.connect(this.getMasterGain());
    }
    return this.categoryGains?.[category];
  }

  private acquireGainNode(): GainNode {
    if (this.gainPool.length > 0) {
      const node = this.gainPool.pop()!;
      node.gain.cancelScheduledValues(0);
      node.gain.value = 1;
      return node;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      throw new Error('AudioContext unavailable');
    }
    return ctx.createGain();
  }

  private releaseGainNode(node: GainNode): void {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
    this.gainPool.push(node);
  }

  private loadSettings(): SoundSettings {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS, mutedCategories: { ...DEFAULT_SETTINGS.mutedCategories } };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SoundSettings>;
      return {
        master: this.clamp01(parsed.master ?? DEFAULT_SETTINGS.master),
        sfx: this.clamp01(parsed.sfx ?? DEFAULT_SETTINGS.sfx),
        ui: this.clamp01(parsed.ui ?? DEFAULT_SETTINGS.ui),
        music: this.clamp01(parsed.music ?? DEFAULT_SETTINGS.music),
        muted: parsed.muted ?? DEFAULT_SETTINGS.muted,
        mutedCategories: {
          sfx: parsed.mutedCategories?.sfx ?? false,
          ui: parsed.mutedCategories?.ui ?? false,
          music: parsed.mutedCategories?.music ?? false,
        },
      };
    } catch (_err) {
      return { ...DEFAULT_SETTINGS, mutedCategories: { ...DEFAULT_SETTINGS.mutedCategories } };
    }
  }

  private persistSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    this.settingsListeners.forEach((fn) => fn(this.getSettings()));
  }

  private applySettingsToGains(): void {
    const masterMute = this.settings.muted ? 0 : this.settings.master;
    if (this.masterGain) {
      this.masterGain.gain.value = masterMute;
    }
    if (this.categoryGains) {
      (['sfx', 'ui', 'music'] as SoundCategory[]).forEach((cat) => {
        const muted = this.settings.muted || this.settings.mutedCategories[cat];
        this.categoryGains![cat].gain.value = muted ? 0 : this.settings[cat];
      });
    }
  }

  private updateFallbackVolumes(): void {
    for (const record of this.activeSfx) {
      if (!record.element) continue;
      const base = this.registry.get(record.id)?.baseVolume ?? 1;
      record.element.volume = this.computeFallbackVolume(record.category, base, 1);
    }
    if (this.currentMusic?.element) {
      const entry = this.registry.get(this.currentMusic.id);
      const base = entry?.baseVolume ?? 1;
      this.currentMusic.element.volume = this.computeFallbackVolume('music', base, 1);
    }
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private attachUnlockHandler(): void {
    if (this.unlockHandlerAttached || !this.audioContext) return;
    const unlock = () => {
      void this.audioContext?.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.unlockHandlerAttached = true;
  }

  private createHtmlAudio(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  }
}
