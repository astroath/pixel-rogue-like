export interface ExperienceConfig {
  baseRequirement: number;
  growthFactor: number;
  difficultyMultiplier: number;
  maxLevel?: number;
  overrides?: Record<number, number>;
}

export interface ExperienceState {
  level: number;
  currentXp: number;
  requiredXp: number;
  progress: number;
  totalEarned: number;
}

export interface AddXpResult {
  leveledUp: boolean;
  levelsGained: number;
  state: ExperienceState;
}

const DEFAULT_CONFIG: ExperienceConfig = {
  baseRequirement: 50,
  growthFactor: 1.32,
  difficultyMultiplier: 8,
};

export class ExperienceSystem {
  private level = 1;
  private currentXp = 0;
  private totalEarned = 0;
  private config: ExperienceConfig;

  constructor(config?: Partial<ExperienceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public addXp(amount: number): AddXpResult {
    if (amount <= 0) return this.snapshot(false, 0);
    this.totalEarned += amount;
    this.currentXp += amount;

    let levelsGained = 0;
    let required = this.requiredForLevel(this.level);
    while (
      this.currentXp >= required &&
      (this.config.maxLevel === undefined || this.level < this.config.maxLevel)
    ) {
      this.currentXp -= required;
      this.level += 1;
      levelsGained += 1;
      required = this.requiredForLevel(this.level);
    }

    // Cap XP at max level requirement so the bar appears full but not overflowing.
    if (this.config.maxLevel && this.level >= this.config.maxLevel) {
      this.currentXp = Math.min(this.currentXp, required);
    }

    return this.snapshot(levelsGained > 0, levelsGained);
  }

  public forceLevelUp(levels: number = 1): AddXpResult {
    if (levels <= 0) return this.snapshot(false, 0);
    let gained = 0;
    for (let i = 0; i < levels; i++) {
      if (this.config.maxLevel && this.level >= this.config.maxLevel) break;
      const required = this.requiredForLevel(this.level);
      this.totalEarned += required;
      this.currentXp += required;
      this.level += 1;
      this.currentXp = 0;
      gained += 1;
    }
    return this.snapshot(gained > 0, gained);
  }

  public getState(): ExperienceState {
    return this.snapshot(false, 0).state;
  }

  private requiredForLevel(level: number): number {
    if (this.config.overrides && this.config.overrides[level]) {
      return this.config.overrides[level];
    }
    const linear = level * level * this.config.difficultyMultiplier;
    const exponential = this.config.baseRequirement * Math.pow(this.config.growthFactor, level - 1);
    return Math.round(this.config.baseRequirement + linear + exponential);
  }

  private snapshot(leveledUp: boolean, levelsGained: number): AddXpResult {
    const required = this.requiredForLevel(this.level);
    const progress = required > 0 ? Math.min(1, this.currentXp / required) : 0;
    return {
      leveledUp,
      levelsGained,
      state: {
        level: this.level,
        currentXp: this.currentXp,
        requiredXp: required,
        progress,
        totalEarned: this.totalEarned,
      },
    };
  }
}
