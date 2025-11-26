import { Renderer } from "./Renderer";
import { PixelMap } from "../render/PixelMap";
import { TileMap } from "../world/TileMap";
import { InputManager } from "../input/Input";
import { Graphics, Container } from "pixi.js";
import { EntityManager } from "../entities/EntityManager";
import {
    SpawnController,
    type EnemyTypeConfig,
} from "../entities/SpawnController";
import { TransformComponent } from "../entities/components/TransformComponent";
import { HealthComponent } from "../entities/components/HealthComponent";
import { CollisionComponent } from "../entities/components/CollisionComponent";
import { ProjectileManager } from "../entities/projectiles/ProjectileManager";
import { AttackComponent } from "../entities/components/AttackComponent";
import { EnemyInfoComponent } from "../entities/components/EnemyInfoComponent";
import { PickupComponent } from "../entities/components/PickupComponent";
import type { Entity } from "../entities/Entity";
import { CombatSystem } from "../entities/CombatSystem";
import {
    ProceduralMapGenerator,
    type MapGenerationResult,
} from "../world/ProceduralMapGenerator";
import { WaveManager } from "../entities/waves/WaveManager";
import {
    DEFAULT_WAVES,
    BASE_ENEMY_COSTS,
} from "../entities/waves/defaultWaves";
import {
    ExperienceSystem,
    type ExperienceState,
} from "../progression/ExperienceSystem";
import { ProgressionState } from "../progression/ProgressionState";
import {
    type EnemyModifierState,
    type PlayerStatsSnapshot,
    type UpgradeDefinition,
} from "../progression/types";
import { pickUpgradeOptions, UPGRADE_POOL } from "../progression/UpgradePool";
import {
    SoundManager,
    type SoundSettings,
    type VolumeCategory,
} from "../audio/SoundManager";
import { AUDIO_ASSETS } from "../audio/assets";
import { WeaponController } from "../weapons/WeaponController";
import { WEAPON_REGISTRY } from "../weapons/weaponRegistry";

export class Game {
    private renderer: Renderer;
    private pixelMap?: PixelMap;
    private tileMap?: TileMap;
    private input?: InputManager;
    private entityManager: EntityManager;
    private projectileManager: ProjectileManager;
    private combatSystem: CombatSystem;
    private sound: SoundManager;
    private viewportWidth: number = 320;
    private viewportHeight: number = 180;

    private playerG?: Graphics;
    private reticleG?: Graphics;
    private enemySprites: Map<number, Graphics> = new Map();
    private projectileSprites: Map<number, Graphics> = new Map();
    private pickupSprites: Map<number, Graphics> = new Map();
    private hitboxG?: Graphics;
    private worldLayer?: Container;
    private uiLayer?: Container;
    private spawnController?: SpawnController;
    private waveManager?: WaveManager;
    private displayHealth: number = 0;
    private debugState = {
        showPanel: true,
        infinitePlayerHealth: false,
        oneHitKillEnemies: false,
        showHitboxes: false,
        logDamage: false,
    };
    private hudRoot?: HTMLElement;
    private hudWave?: HTMLElement;
    private hudWaveTimer?: HTMLElement;
    private hudWaveBudget?: HTMLElement;
    private hudHealthFill?: HTMLElement;
    private hudHealthText?: HTMLElement;
    private hudXpFill?: HTMLElement;
    private hudXpText?: HTMLElement;
    private hudLevelText?: HTMLElement;
    private hudLevelOverlay?: HTMLElement;
    private hudLevelChoices?: HTMLElement;
    private hudWeaponOverlay?: HTMLElement;
    private hudWeaponList?: HTMLElement;
    private hudWeaponOre?: HTMLElement;
    private hudGameOverOverlay?: HTMLElement;
    private hudGameOverStats?: HTMLElement;
    private hudDebug?: HTMLElement;
    private hudDebugList?: HTMLElement;
    private hudAudioMaster?: HTMLInputElement;
    private hudAudioSfx?: HTMLInputElement;
    private hudAudioUi?: HTMLInputElement;
    private hudAudioMusic?: HTMLInputElement;
    private levelUpOverlayId?: string;
    private levelUpGlobalHandler?: (ev: Event) => void;
    private cursorMode: "game" | "ui" = "game";
    private hudAudioMute?: HTMLInputElement;
    private hudAudioMasterValue?: HTMLElement;
    private hudAudioSfxValue?: HTMLElement;
    private hudAudioUiValue?: HTMLElement;
    private hudAudioMusicValue?: HTMLElement;
    private lastHudRect?: { w: number; h: number; left: number; top: number };
    private mapGenerator: ProceduralMapGenerator;
    private mapInfo?: MapGenerationResult;
    private experience: ExperienceSystem;
    private progression: ProgressionState;
    private weaponController: WeaponController;
    private playerStats: PlayerStatsSnapshot;
    private enemyModifiers: EnemyModifierState;
    private xpState: ExperienceState;
    private pendingLevelUps = 0;
    private levelUpOptions: UpgradeDefinition[] = [];
    private appliedUpgrades: UpgradeDefinition[] = [];
    private gameplayPaused = false;
    private pauseReason: "level-up" | "weapon-upgrade" | "death" | null = null;
    private sessionStartTime = performance.now();
    private gameEnded = false;

    constructor() {
        this.renderer = new Renderer({
            width: 320, // Low resolution for pixel art look
            height: 180,
            backgroundColor: 0x222222,
        });
        this.entityManager = new EntityManager();
        this.projectileManager = new ProjectileManager(this.entityManager, {
            config: {
                poolSize: 384,
                maxProjectiles: 384,
                enableFriendlyFire: false,
            },
        });
        this.sound = new SoundManager();
        this.combatSystem = new CombatSystem(this.entityManager);
        this.projectileManager.setCombatSystem(this.combatSystem);
        this.combatSystem.setOnEntityKilled(this.handleEntityKilled);
        this.combatSystem.setOnDamageApplied(this.handleDamageApplied);
        this.combatSystem.setDamageModifier((target, amount) =>
            this.modifyIncomingDamage(target, amount)
        );
        this.experience = new ExperienceSystem({
            baseRequirement: 40,
            growthFactor: 1.4,
            difficultyMultiplier: 10,
        });
        this.progression = new ProgressionState();
        this.weaponController = new WeaponController(
            this.progression,
            this.projectileManager
        );
        this.playerStats = this.progression.getSnapshot();
        this.enemyModifiers = this.progression.getEnemyModifiers();
        this.xpState = this.experience.getState();
        this.syncCombatFlags();
        this.mapGenerator = new ProceduralMapGenerator();
        window.addEventListener("keydown", this.handleDebugKey);
    }

    public async start() {
        await this.renderer.init();
        await this.initializeAudio();
        this.createWorldScene();
    }

    private async initializeAudio() {
        await this.sound.init();
        try {
            await this.sound.loadAssets(AUDIO_ASSETS);
        } catch (err) {
            console.warn("Failed to preload audio assets", err);
        }
    }

    private setCursorMode(mode: 'game' | 'ui') {
        this.cursorMode = mode;
        const hide = mode === 'game';
        console.log(`[cursor] mode=${mode} paused=${this.gameplayPaused} reason=${this.pauseReason} overlayVisible=${this.hudLevelOverlay ? this.hudLevelOverlay.classList.contains('visible') : false}`);
        this.renderer.canvas.style.cursor = hide ? 'none' : 'default';
        document.body.classList.toggle('cursor-hidden', hide);
        document.documentElement.classList.toggle('cursor-hidden', hide);
    }

    private createWorldScene() {
        this.sessionStartTime = performance.now();
        const viewportWidth = this.viewportWidth;
        const viewportHeight = this.viewportHeight;
        const tileSize = 4;
        const worldTilesW = 160;
        const worldTilesH = 90;
        const worldPixelsW = worldTilesW * tileSize;
        const worldPixelsH = worldTilesH * tileSize;
        const spawnTile = {
            x: Math.floor(worldTilesW * 0.5),
            y: Math.floor(worldTilesH * 0.5),
        };

        this.pixelMap = new PixelMap({
            worldWidth: worldPixelsW,
            worldHeight: worldPixelsH,
            viewportWidth,
            viewportHeight,
            virtualPixelScale: tileSize,
        });

        this.tileMap = new TileMap(worldTilesW, worldTilesH, tileSize);
        const mapSeed = Math.floor(Math.random() * 0x7fffffff);
        this.mapInfo = this.mapGenerator.generate(this.tileMap, {
            seed: mapSeed,
            spawn: spawnTile,
            obstacleDensity: 0.2,
            safeZoneRadius: 14,
            carveLoopCount: 2,
            carveLoopRadius: 26,
        });
        this.entityManager.setTileMap(this.tileMap);
        this.projectileManager.setTileMap(this.tileMap);

        for (let ty = 0; ty < worldTilesH; ty++) {
            for (let tx = 0; tx < worldTilesW; tx++) {
                const color = this.tileMap.getPixelColorForTile(tx, ty);
                this.pixelMap.drawTile(tx, ty, color);
            }
        }

        this.worldLayer = new Container();
        this.uiLayer = new Container();
        (this.renderer.stage as any).sortableChildren = true;
        this.worldLayer.sortableChildren = true;
        this.uiLayer.sortableChildren = true;
        this.renderer.stage.addChild(this.worldLayer);
        this.renderer.stage.addChild(this.uiLayer);

        this.worldLayer.addChild(this.pixelMap.view);
        this.pixelMap.setCamera(0, 0);
        this.pixelMap.render();

        // Create Player Entity
        const player = this.entityManager.createEntity("player");
        const playerSpawn = this.mapInfo?.spawn ?? spawnTile;
        const startX = Math.floor(playerSpawn.x * tileSize);
        const startY = Math.floor(playerSpawn.y * tileSize);

        const transform = new TransformComponent(
            startX,
            startY,
            tileSize,
            tileSize
        );
        transform.speed = 2;
        player.addComponent(transform);
        const healthComponent = new HealthComponent(100, 12);
        player.addComponent(healthComponent);
        player.addComponent(new CollisionComponent(tileSize / 2));
        const attackComponent = new AttackComponent(12, 12, 999);
        player.addComponent(attackComponent);
        this.progression.overrideBase({
            moveSpeed: transform.speed,
            maxHealth: healthComponent.max,
            attackDamage: attackComponent.damage,
            attackCooldown: attackComponent.cooldown,
        });
        this.refreshPlayerStats();
        this.weaponController.equip("blaster");

        this.playerG = new Graphics();
        this.playerG.rect(0, 0, tileSize, tileSize).fill(0xffffff);
        this.playerG.zIndex = 10;
        this.worldLayer.addChild(this.playerG);

        this.hitboxG = new Graphics();
        this.hitboxG.zIndex = 20;
        this.worldLayer.addChild(this.hitboxG);

        this.reticleG = new Graphics();
        const cross = 3;
        this.reticleG
            .moveTo(-cross, 0)
            .lineTo(cross, 0)
            .stroke({ width: 2, color: 0xffd700 });
        this.reticleG
            .moveTo(0, -cross)
            .lineTo(0, cross)
            .stroke({ width: 2, color: 0xffd700 });
        this.reticleG.circle(0, 0, 1).fill(0xffd700);
        this.reticleG.zIndex = 1000;
        this.uiLayer.addChild(this.reticleG);

        this.createDomHud();
        this.layoutHud();
        this.updateXpUI();
        this.updateOreUI();

        this.spawnController = new SpawnController(this.entityManager, {
            worldWidth: worldPixelsW,
            worldHeight: worldPixelsH,
            tileSize,
            tileMap: this.tileMap,
            getPlayer: () => this.entityManager.player,
            onEnemyAttack: (enemy, dirX, dirY) =>
                this.handleEnemyAttack(enemy, dirX, dirY),
            onEnemySpawn: (enemy, type) => this.applyEnemyModifiers(enemy, type),
            config: {
                initialSpawnCount: 0,
                spawnIntervalMs: 0,
                spawnRadiusMin: Math.max(viewportWidth, viewportHeight) * 0.6,
                spawnRadiusMax: Math.max(viewportWidth, viewportHeight),
                useTileMapSpawns: false,
                allowSizeVariance: false,
            },
        });
        this.spawnController.initialize();
        this.waveManager = new WaveManager(
            this.spawnController,
            this.entityManager,
            {
                waves: DEFAULT_WAVES,
                baseEnemyCosts: BASE_ENEMY_COSTS,
                clearEnemiesOnWaveStart: true,
                intermissionSeconds: 4,
                loopLastWave: true,
                onWaveStart: (waveIndex) => {
                    if (this.hudWave) {
                        this.hudWave.textContent = `Wave ${waveIndex + 1}`;
                    }
                    this.spawnOreForWave(waveIndex);
                },
                onWaveComplete: (waveIndex) => this.showWeaponUpgradeOverlay(waveIndex),
            }
        );
        this.waveManager.start();

        // Immediately center camera on player and place graphics
        if (this.pixelMap) {
            const camX0 = Math.max(
                0,
                Math.min(startX - viewportWidth * 0.5, worldPixelsW - viewportWidth)
            );
            const camY0 = Math.max(
                0,
                Math.min(startY - viewportHeight * 0.5, worldPixelsH - viewportHeight)
            );
            this.pixelMap.setCamera(camX0, camY0);
            const cam0 = this.pixelMap.getCamera();
            this.playerG.x = Math.floor(startX - cam0.x);
            this.playerG.y = Math.floor(startY - cam0.y);
        }

        this.worldLayer.sortChildren();
        this.uiLayer.sortChildren();

        this.setCursorMode('game');
        window.addEventListener("resize", this.layoutHud);

        this.input = new InputManager(this.renderer.canvas, {
            viewportWidth,
            viewportHeight,
            getWorldPosition: (sx, sy) => {
                const cam = this.pixelMap ? this.pixelMap.getCamera() : { x: 0, y: 0 };
                return { wx: cam.x + sx, wy: cam.y + sy };
            },
        });


        this.renderer.ticker.add((ticker) => {
            const dt = ticker.deltaTime; // 1.0 at 60fps
            const now = performance.now();
            this.input?.poll(now);
            const pointer = this.input?.getPointer();
            const move = this.input?.get("Move");
            const deltaMs = ticker.deltaMS ?? dt * (1000 / 60);
            const dtSeconds = deltaMs / 1000;
            const paused = this.gameplayPaused;

            const playerEntity = this.entityManager.player;
            const pTransform =
                playerEntity?.getComponent<TransformComponent>("Transform");

            if (playerEntity && pTransform && move) {
                if (move.vx !== 0 || move.vy !== 0) {
                    pTransform.vx = paused ? 0 : move.vx * pTransform.speed;
                    pTransform.vy = paused ? 0 : move.vy * pTransform.speed;
                } else {
                    pTransform.vx = 0;
                    pTransform.vy = 0;
                }

                // Clamp position (simple bounds check before update)
                // Actually EntityManager applies velocity. We might need to clamp AFTER update or restrict movement.
                // For now, let's let EntityManager move it, then clamp.
            }

            if (playerEntity && pTransform && pointer) {
                const dx = pointer.wx - pTransform.x;
                const dy = pointer.wy - pTransform.y;
                const len = Math.hypot(dx, dy) || 1;
                pTransform.directionX = dx / len;
                pTransform.directionY = dy / len;
            }

            if (!paused && playerEntity && pTransform && pointer) {
                this.weaponController.update(dtSeconds, playerEntity, {
                    x: pTransform.directionX,
                    y: pTransform.directionY,
                });
            }

            if (!paused) {
                this.spawnController?.update(dt);
                this.waveManager?.update(dtSeconds);

                // Update Entities
                this.entityManager.update(dt);
                this.collectPickups(dtSeconds);
                this.projectileManager.update(dt);
                this.combatSystem.update(dt);
                this.updatePlayerRegen(dtSeconds);
                this.checkPlayerDeath();
                this.refreshDirtyTiles();

                // Post-update bounds check for player
                if (pTransform) {
                    pTransform.x = Math.max(
                        0,
                        Math.min(worldPixelsW - tileSize, pTransform.x)
                    );
                    pTransform.y = Math.max(
                        0,
                        Math.min(worldPixelsH - tileSize, pTransform.y)
                    );
                }
            } else {
                if (pTransform) {
                    pTransform.vx = 0;
                    pTransform.vy = 0;
                }
            }

            // Camera and Rendering
            if (this.pixelMap && pTransform) {
                const camX = Math.max(
                    0,
                    Math.min(
                        pTransform.x - viewportWidth * 0.5,
                        worldPixelsW - viewportWidth
                    )
                );
                const camY = Math.max(
                    0,
                    Math.min(
                        pTransform.y - viewportHeight * 0.5,
                        worldPixelsH - viewportHeight
                    )
                );
                this.pixelMap.setCamera(camX, camY);

                const cam = this.pixelMap.getCamera();
                if (this.playerG) {
                    this.playerG.x = Math.floor(pTransform.x - cam.x);
                    this.playerG.y = Math.floor(pTransform.y - cam.y);
                }
            }

            if (this.reticleG && pointer) {
                this.reticleG.x = Math.floor(pointer.sx);
                this.reticleG.y = Math.floor(pointer.sy);
            }

            this.syncEnemySprites();
            this.syncProjectileSprites();
            this.syncPickupSprites();
            this.updateWaveUI();
            this.updateXpUI();
            this.updateHealthUI(dt);
            this.updateDebugPanel(deltaMs);
            this.drawHitboxes();

            this.tileMap?.tick(paused ? 0 : 16);
            this.pixelMap?.render();
            this.layoutHud();
        });
    }

    private syncEnemySprites() {
        if (!this.worldLayer || !this.pixelMap) return;
        const cam = this.pixelMap.getCamera();

        const activeIds = new Set<number>();
        for (const enemy of this.entityManager.enemies) {
            if (!enemy.active) continue;
            const transform = enemy.getComponent<TransformComponent>("Transform");
            const info = enemy.getComponent<any>("EnemyInfo");
            if (!transform) continue;
            activeIds.add(enemy.id);

            let g = this.enemySprites.get(enemy.id);
            if (!g) {
                g = new Graphics();
                g.zIndex = 5;
                this.worldLayer.addChild(g);
                this.enemySprites.set(enemy.id, g);
                this.worldLayer.sortChildren();
            }

            const color = this.colorForEnemy(info?.enemyType);
            g.clear();
            g.rect(0, 0, transform.width, transform.height).fill(color);
            g.rect(0, 0, transform.width, transform.height).stroke({
                width: 1,
                color: 0x000000,
                alignment: 0,
            });
            g.x = Math.floor(transform.x - cam.x);
            g.y = Math.floor(transform.y - cam.y);
        }

        for (const [id, g] of this.enemySprites.entries()) {
            if (!activeIds.has(id)) {
                g.destroy();
                this.enemySprites.delete(id);
            }
        }
    }

    private colorForEnemy(type: string | undefined): number {
        switch (type) {
            case "SmallChaser":
                return 0x4ade80; // green
            case "MediumChaser":
                return 0xf59e0b; // amber
            case "RangedShooter":
                return 0x60a5fa; // blue
            case "Tank":
                return 0xef4444; // red
            case "Slime":
                return 0x4ade80;
            case "Brute":
                return 0xef4444;
            case "Spitter":
                return 0x60a5fa;
            default:
                return 0xfacc15; // yellow fallback
        }
    }

    private handleEnemyAttack(enemy: Entity, dirX: number, dirY: number) {
        const info = enemy.getComponent<EnemyInfoComponent>("EnemyInfo");
        const transform = enemy.getComponent<TransformComponent>("Transform");
        const attack = enemy.getComponent<AttackComponent>("Attack");
        if (!info || !transform) return;
        if (info.enemyType === "RangedShooter" || info.enemyType === "Spitter") {
            const projectileDamage = attack?.damage ?? 6;
            this.projectileManager.spawn(
                "enemySpit",
                {
                    x: transform.x + transform.width * 0.5,
                    y: transform.y + transform.height * 0.5,
                },
                { x: dirX, y: dirY },
                enemy,
                { isEnemyProjectile: true },
                { sizeScale: 0.34, overrideDamage: projectileDamage }
            );
            return;
        }

        const player = this.entityManager.player;
        const playerHealth = player?.getComponent<HealthComponent>("Health");
        const playerTransform =
            player?.getComponent<TransformComponent>("Transform");
        if (!player || !playerHealth || !playerTransform) return;
        const dx = playerTransform.x - transform.x;
        const dy = playerTransform.y - transform.y;
        const distSq = dx * dx + dy * dy;
        const range = attack?.range ?? 12;
        if (distSq <= range * range) {
            this.combatSystem.applyDamage(player, attack?.damage ?? 5, enemy);
        }
    }

    private syncProjectileSprites() {
        if (!this.worldLayer || !this.pixelMap) return;
        const cam = this.pixelMap.getCamera();
        const activeIds = new Set<number>();
        for (const proj of this.projectileManager.getActiveProjectiles()) {
            if (!proj.active) continue;
            activeIds.add(proj.id);
            let g = this.projectileSprites.get(proj.id);
            if (!g) {
                g = new Graphics();
                g.zIndex = 8;
                this.worldLayer.addChild(g);
                this.projectileSprites.set(proj.id, g);
                this.worldLayer.sortChildren();
            }
            g.clear();
            const size = Math.max(2, Math.round(proj.size));
            const color =
                proj.colorOverride ??
                proj.type.color ??
                (proj.isPlayerProjectile ? 0xffffff : 0xff0000);
            g.circle(0, 0, size * 0.5).fill(color);
            if (!proj.isPlayerProjectile) {
                g.circle(0, 0, size * 0.5).stroke({
                    width: 1,
                    color: 0x000000,
                    alignment: 0,
                });
            }
            g.x = Math.floor(proj.x - cam.x);
            g.y = Math.floor(proj.y - cam.y);
        }

        for (const [id, g] of this.projectileSprites.entries()) {
            if (!activeIds.has(id)) {
                g.destroy();
                this.projectileSprites.delete(id);
            }
        }
    }

    private modifyIncomingDamage(target: Entity, amount: number): number {
        if (target.type !== "player") return amount;
        const resist = this.playerStats?.damageResistance ?? 0;
        return Math.max(0, amount * (1 - resist));
    }

    private refreshPlayerStats() {
        this.playerStats = this.progression.getSnapshot();
        this.enemyModifiers = this.progression.getEnemyModifiers();
        this.applyPlayerStatsToComponents();
        this.combatSystem.setDamageModifier((target, amount) =>
            this.modifyIncomingDamage(target, amount)
        );
    }

    private applyPlayerStatsToComponents() {
        const player = this.entityManager.player;
        const transform = player?.getComponent<TransformComponent>("Transform");
        const health = player?.getComponent<HealthComponent>("Health");
        const attack = player?.getComponent<AttackComponent>("Attack");
        if (transform) {
            transform.speed = this.playerStats.moveSpeed;
        }
        if (health) {
            const prevMax = health.max;
            health.max = Math.max(1, Math.round(this.playerStats.maxHealth));
            if (health.current > health.max) {
                health.current = health.max;
            } else if (health.max > prevMax) {
                health.current = Math.min(
                    health.max,
                    health.current + (health.max - prevMax)
                );
            }
        }
        if (attack) {
            attack.damage = this.playerStats.attackDamage;
            attack.cooldown = Math.max(2, this.playerStats.attackCooldown);
        }
    }

    private applyEnemyModifiers(enemy: Entity, _type: EnemyTypeConfig) {
        const mods = this.enemyModifiers;
        const transform = enemy.getComponent<TransformComponent>("Transform");
        const attack = enemy.getComponent<AttackComponent>("Attack");
        const ai = enemy.getComponent<any>("AI");
        if (transform) {
            transform.speed *= mods.speedMultiplier;
        }
        if (ai) {
            ai.moveSpeed =
                (ai.moveSpeed ?? transform?.speed ?? 0) * mods.speedMultiplier;
            ai.attackCooldown =
                (ai.attackCooldown ?? attack?.cooldown ?? 45) *
                mods.attackCooldownMultiplier;
        }
        if (attack) {
            attack.damage *= mods.damageMultiplier;
            attack.cooldown *= mods.attackCooldownMultiplier;
        }
    }

    private handleEntityKilled = (target: Entity, _source: Entity | null) => {
        if (target.type === "player") {
            const health = target.getComponent<HealthComponent>("Health");
            if (health) {
                // Force UI to zero out instantly on death.
                this.updateHealthUIManual(0, Math.max(1, Math.round(health.max)));
            }
            this.handlePlayerDeath();
            return;
        }

        if (target.type !== "enemy") return;
        const info = target.getComponent<EnemyInfoComponent>("EnemyInfo");
        const transform = target.getComponent<TransformComponent>("Transform");
        if (!info || !transform) return;
        const value = Math.max(1, info.xpReward ?? 1);
        this.spawnXpPickup(
            {
                x: transform.x + transform.width * 0.5,
                y: transform.y + transform.height * 0.5,
            },
            value
        );
    };

    private handleDamageApplied = (target: Entity, _amount: number) => {
        if (target.type === "enemy") {
            this.sound.playSFX("enemy_hit");
        }
    };

    private spawnXpPickup(position: { x: number; y: number }, amount: number) {
        const orb = this.entityManager.createEntity("pickup");
        const size = Math.max(3, Math.min(10, Math.round(3 + amount * 0.25)));
        const transform = new TransformComponent(
            position.x - size * 0.5,
            position.y - size * 0.5,
            size,
            size
        );
        if (this.tileMap) {
            const maxX = this.tileMap.width * this.tileMap.virtualPixelScale - size;
            const maxY = this.tileMap.height * this.tileMap.virtualPixelScale - size;
            transform.x = Math.max(0, Math.min(transform.x, maxX));
            transform.y = Math.max(0, Math.min(transform.y, maxY));
        }
        orb.addComponent(transform);
        orb.addComponent(new PickupComponent("xp", amount));
        orb.flags.collidable = false;
        orb.flags.movable = false;
        orb.flags.damageable = false;
    }

    private spawnOrePickup(
        position: { x: number; y: number },
        amount: number,
        kind: "ore-common" | "ore-rare"
    ) {
        const node = this.entityManager.createEntity("pickup");
        const size = Math.max(4, Math.min(12, Math.round(4 + amount * 0.2)));
        const transform = new TransformComponent(
            position.x - size * 0.5,
            position.y - size * 0.5,
            size,
            size
        );
        if (this.tileMap) {
            const maxX = this.tileMap.width * this.tileMap.virtualPixelScale - size;
            const maxY = this.tileMap.height * this.tileMap.virtualPixelScale - size;
            transform.x = Math.max(0, Math.min(transform.x, maxX));
            transform.y = Math.max(0, Math.min(transform.y, maxY));
        }
        node.addComponent(transform);
        node.addComponent(new PickupComponent(kind, amount));
        node.flags.collidable = false;
        node.flags.movable = false;
        node.flags.damageable = false;
    }

    private collectPickups(dtSeconds: number) {
        const player = this.entityManager.player;
        const pTransform = player?.getComponent<TransformComponent>("Transform");
        if (!player || !pTransform) return;
        const playerCx = pTransform.x + pTransform.width * 0.5;
        const playerCy = pTransform.y + pTransform.height * 0.5;
        const radius = this.playerStats.pickupRadius;
        const radiusSq = radius * radius;
        const collectRadius = 6;
        const basePullSpeed = 60; // units per second
        const extraPullSpeed = 160; // scales as pickup gets closer

        for (const pickup of [...this.entityManager.pickups]) {
            const transform = pickup.getComponent<TransformComponent>("Transform");
            const info = pickup.getComponent<PickupComponent>("Pickup");
            if (!transform || !info) continue;
            const cx = transform.x + transform.width * 0.5;
            const cy = transform.y + transform.height * 0.5;
            const dx = cx - playerCx;
            const dy = cy - playerCy;
            const distSq = dx * dx + dy * dy;
            if (distSq <= collectRadius * collectRadius) {
                this.onPickupCollected(pickup, info);
                continue;
            }
            if (distSq <= radiusSq) {
                const dist = Math.sqrt(distSq) || 1;
                const dirX = -dx / dist;
                const dirY = -dy / dist;
                const pullFactor = 1 - Math.min(1, dist / radius);
                const speed = basePullSpeed + extraPullSpeed * pullFactor;
                transform.x += dirX * speed * dtSeconds;
                transform.y += dirY * speed * dtSeconds;
            }
        }
    }

    private onPickupCollected(pickup: Entity, info: PickupComponent) {
        if (info.kind === "xp") {
            this.grantXp(info.value);
        } else if (info.kind === "ore-common" || info.kind === "ore-rare") {
            this.progression.addOre(info.value);
            this.updateOreUI();
        }
        this.entityManager.removeEntity(pickup);
    }

    private grantXp(amount: number) {
        const result = this.experience.addXp(amount);
        this.xpState = result.state;
        if (result.levelsGained > 0) {
            this.pendingLevelUps += result.levelsGained;
            this.queueLevelUp();
        }
    }

    private queueLevelUp() {
        console.log(`[levelup:queue] pending=${this.pendingLevelUps} overlayPresent=${!!this.hudLevelOverlay}`);
        if (this.pendingLevelUps <= 0) return;
        if (this.pauseReason !== "level-up") {
            this.gameplayPaused = true;
            this.pauseReason = "level-up";
        }
        if (this.levelUpOptions.length === 0) {
            this.levelUpOptions = pickUpgradeOptions(UPGRADE_POOL, 3, new Set());
        }
        this.ensureLevelUpOverlay();
        this.renderLevelUpOptions();
        this.showLevelUpOverlay();
    }

    private renderLevelUpOptions() {
        if (!this.hudLevelChoices) return;
        console.log('[levelup:render]', this.levelUpOptions.map(o => o.name).join(','));
        this.hudLevelChoices.innerHTML = "";
        this.levelUpOptions.forEach((upgrade, index) => {
            const card = document.createElement("button");
            card.className = `levelup-card rarity-${upgrade.rarity ?? "common"}`;
            (card as HTMLButtonElement).type = 'button';
            card.setAttribute('data-idx', String(index));
            const title = document.createElement("div");
            title.className = "levelup-card__title";
            title.textContent = `${index + 1}. ${upgrade.name}`;
            const meta = document.createElement("div");
            meta.className = "levelup-card__meta";
            meta.textContent = `${upgrade.category.toUpperCase()} • ${upgrade.rarity ?? "common"
                }`;
            const desc = document.createElement("div");
            desc.className = "levelup-card__desc";
            desc.textContent = upgrade.description;
            card.appendChild(meta);
            card.appendChild(title);
            card.appendChild(desc);
            card.onclick = () => {
                console.log('[levelup:card-click]', upgrade.name);
                this.selectUpgrade(upgrade);
            };
            this.hudLevelChoices?.appendChild(card);
        });
    }

    private showLevelUpOverlay() {
        if (!this.hudLevelOverlay) return;
        this.hudLevelOverlay.classList.remove('hidden');
        if (this.hudWeaponOverlay) {
            this.hudWeaponOverlay.classList.remove('visible');
            this.hudWeaponOverlay.classList.add('hidden');
            (this.hudWeaponOverlay as HTMLElement).style.display = 'none';
        }
        this.setCursorMode('ui');
        this.input?.setUIFocused(true);
        this.renderer.canvas.style.pointerEvents = 'none';
        this.hudLevelOverlay.style.display = '';
        this.hudLevelOverlay.classList.add("visible");
        this.logLevelUpOverlays('show');

        const handler = (ev: Event) => {
            const e = ev as MouseEvent;
            const el = e.target as HTMLElement;
            console.log('[levelup:global-event]', e.type, el && (el.className || el.tagName));
            const within = el && !!el.closest('.levelup-overlay');
            if (!within) return;
            const card = el.closest('.levelup-card') as HTMLElement | null;
            if (!card) return;
            const idxAttr = card.getAttribute('data-idx');
            if (!idxAttr) return;
            const idx = parseInt(idxAttr, 10);
            const choice = this.levelUpOptions[idx];
            if (!choice) return;
            console.log('[levelup:global]', choice.name);
            ev.stopPropagation();
            ev.preventDefault();
            this.selectUpgrade(choice);
        };
        this.levelUpGlobalHandler = handler;
        document.addEventListener('pointerdown', handler, true);
        document.addEventListener('click', handler, true);
    }

    private hideLevelUpOverlay() {
        if (!this.hudLevelOverlay) return;
        this.hudLevelOverlay.classList.remove("visible");
        this.hudLevelOverlay.style.display = 'none';
        this.hudLevelOverlay.classList.add('hidden');
        if (this.hudLevelOverlay.parentElement) {
            this.hudLevelOverlay.parentElement.removeChild(this.hudLevelOverlay);
        }
        this.hudLevelOverlay = undefined;
        this.hudLevelChoices = undefined;
        const allLevelOverlays = document.querySelectorAll('.levelup-overlay');
        allLevelOverlays.forEach(el => {
            const he = el as HTMLElement;
            he.classList.remove('visible');
            he.classList.add('hidden');
            he.style.display = 'none';
            if (he.parentElement) he.parentElement.removeChild(he);
        });
        this.levelUpOptions = [];
        this.setCursorMode('game');
        this.input?.setUIFocused(false);
        this.renderer.canvas.style.pointerEvents = 'auto';
        if (this.pauseReason === 'level-up') {
            this.gameplayPaused = false;
            this.pauseReason = null;
        }
        if (this.levelUpGlobalHandler) {
            document.removeEventListener('pointerdown', this.levelUpGlobalHandler, true);
            document.removeEventListener('click', this.levelUpGlobalHandler, true);
            this.levelUpGlobalHandler = undefined;
        }
        this.logLevelUpOverlays('hide');
    }

    private ensureLevelUpOverlay() {
        if (!this.hudRoot) return;
        if (this.hudLevelOverlay && document.body.contains(this.hudLevelOverlay)) return;
        const levelOverlay = document.createElement('div');
        levelOverlay.className = 'levelup-overlay';
        const id = `lu-${Math.floor(Math.random() * 1e9)}`;
        (levelOverlay as any).dataset.overlayId = id;
        const levelModal = document.createElement('div');
        levelModal.className = 'levelup-modal';
        const modalTitle = document.createElement('h3');
        modalTitle.textContent = 'Level Up!';
        const modalSub = document.createElement('p');
        modalSub.textContent = 'Pick one upgrade to continue.';
        const levelChoices = document.createElement('div');
        levelChoices.className = 'levelup-options';
        levelChoices.addEventListener('click', (ev) => {
            const el = ev.target as HTMLElement;
            const card = el.closest('.levelup-card') as HTMLElement | null;
            if (!card) return;
            const idxAttr = card.getAttribute('data-idx');
            if (idxAttr) {
                const idx = parseInt(idxAttr, 10);
                const choice = this.levelUpOptions[idx];
                if (choice) {
                    console.log('[levelup:delegated-click]', choice.name);
                    this.selectUpgrade(choice);
                }
            }
        });
        levelModal.appendChild(modalTitle);
        levelModal.appendChild(modalSub);
        levelModal.appendChild(levelChoices);
        levelOverlay.appendChild(levelModal);
        this.hudRoot.appendChild(levelOverlay);
        this.hudLevelOverlay = levelOverlay;
        this.hudLevelChoices = levelChoices;
        this.levelUpOverlayId = id;
        this.logLevelUpOverlays('ensure');
    }

    private logLevelUpOverlays(stage: string) {
        const nodes = Array.from(document.querySelectorAll('.levelup-overlay')) as HTMLElement[];
        const ids = nodes.map(n => (n as any).dataset?.overlayId || 'no-id');
        console.log(`[levelup:${stage}] nodes=${nodes.length} ids=${ids.join(',')} current=${this.levelUpOverlayId ?? 'none'} paused=${this.gameplayPaused} reason=${this.pauseReason}`);
    }

    private showWeaponUpgradeOverlay(_waveIndex: number) {
        if (this.pauseReason === "death") return;
        if (!this.hudWeaponOverlay) return;
        this.gameplayPaused = true;
        this.pauseReason = "weapon-upgrade";
        this.renderWeaponUpgradeOverlay();
        if (this.hudLevelOverlay) {
            this.hudLevelOverlay.classList.remove('visible');
            this.hudLevelOverlay.classList.add('hidden');
            (this.hudLevelOverlay as HTMLElement).style.display = 'none';
        }
        this.hudWeaponOverlay.classList.remove('hidden');
        (this.hudWeaponOverlay as HTMLElement).style.display = '';
        this.hudWeaponOverlay.classList.add("visible");
        this.setCursorMode('ui');
        this.input?.setUIFocused(true);
        this.renderer.canvas.style.pointerEvents = 'none';
    }

    private hideWeaponUpgradeOverlay() {
        if (!this.hudWeaponOverlay) return;
        this.hudWeaponOverlay.classList.remove("visible");
        (this.hudWeaponOverlay as HTMLElement).style.display = 'none';
        this.hudWeaponOverlay.classList.add('hidden');
        if (this.pauseReason === "weapon-upgrade") {
            this.gameplayPaused = false;
            this.pauseReason = null;
        }
        this.setCursorMode('game');
        this.input?.setUIFocused(false);
        this.renderer.canvas.style.pointerEvents = 'auto';
    }

    private renderWeaponUpgradeOverlay() {
        if (!this.hudWeaponList) return;
        const ore = this.progression.getOre();
        const equippedIds = new Set(
            this.weaponController.getEquipped().map((w) => w.blueprintId)
        );
        const available = WEAPON_REGISTRY.filter((w) => !equippedIds.has(w.id));

        this.hudWeaponList.innerHTML = "";
        if (this.hudWeaponOre) {
            this.hudWeaponOre.textContent = `Ore: ${ore}`;
        }

        for (const view of this.weaponController.getSlotView()) {
            const card = document.createElement("div");
            card.className = "weaponup-card";
            const header = document.createElement("div");
            header.className = "weaponup-card__title";
            header.textContent = view.blueprint
                ? view.blueprint.name
                : `Empty Slot ${view.slot + 1}`;
            card.appendChild(header);

            if (view.blueprint) {
                const tier = document.createElement("div");
                tier.className = "weaponup-card__tier";
                tier.textContent = `Tier ${view.currentTier}/5`;
                card.appendChild(tier);

                if (view.nextTier) {
                    const cost = document.createElement("div");
                    cost.className = "weaponup-card__cost";
                    cost.textContent = `Cost: ${view.nextTier.costOre} ore`;
                    card.appendChild(cost);
                    const btn = document.createElement("button");
                    btn.textContent = "Upgrade";
                    btn.disabled = ore < view.nextTier.costOre;
                    btn.onclick = () => {
                        const success = this.weaponController.tryUpgrade(view.slot);
                        if (success) {
                            this.updateOreUI();
                            this.renderWeaponUpgradeOverlay();
                        }
                    };
                    card.appendChild(btn);
                } else {
                    const maxed = document.createElement("div");
                    maxed.className = "weaponup-card__max";
                    maxed.textContent = "Max Tier";
                    card.appendChild(maxed);
                }

                const remove = document.createElement("button");
                remove.textContent = "Remove";
                remove.onclick = () => {
                    this.weaponController.remove(view.slot);
                    this.renderWeaponUpgradeOverlay();
                };
                card.appendChild(remove);
            } else {
                const prompt = document.createElement("div");
                prompt.textContent = "Add a weapon";
                card.appendChild(prompt);
                for (const option of available) {
                    const btn = document.createElement("button");
                    btn.textContent = option.name;
                    btn.onclick = () => {
                        this.weaponController.equip(option.id);
                        this.renderWeaponUpgradeOverlay();
                    };
                    card.appendChild(btn);
                }
            }
            this.hudWeaponList.appendChild(card);
        }
    }

    private selectUpgrade(upgrade: UpgradeDefinition) {
        console.log('[levelup:select]', upgrade.name, 'pending=', this.pendingLevelUps);
        this.progression.applyUpgrade(upgrade);
        this.appliedUpgrades.push(upgrade);
        this.refreshPlayerStats();
        this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
        this.hideLevelUpOverlay();
        if (this.pendingLevelUps > 0) {
            this.gameplayPaused = true;
            this.pauseReason = 'level-up';
            this.ensureLevelUpOverlay();
            this.levelUpOptions = pickUpgradeOptions(UPGRADE_POOL, 3, new Set());
            this.renderLevelUpOptions();
            this.showLevelUpOverlay();
            return;
        }
        this.gameplayPaused = false;
        this.pauseReason = null;
    }

    private selectUpgradeByIndex(index: number) {
        const choice = this.levelUpOptions[index];
        if (choice) {
            this.selectUpgrade(choice);
        }
    }

    private forceLevelUp(levels: number = 1) {
        const result = this.experience.forceLevelUp(levels);
        this.xpState = result.state;
        if (result.levelsGained > 0) {
            this.pendingLevelUps += result.levelsGained;
            this.queueLevelUp();
        }
    }

    private updatePlayerRegen(dtSeconds: number) {
        const player = this.entityManager.player;
        const health = player?.getComponent<HealthComponent>("Health");
        if (!player || !health) return;
        if (this.playerStats.healthRegen <= 0) return;
        health.heal(this.playerStats.healthRegen * dtSeconds);
    }

    private syncPickupSprites() {
        if (!this.worldLayer || !this.pixelMap) return;
        const cam = this.pixelMap.getCamera();
        const activeIds = new Set<number>();
        for (const pickup of this.entityManager.pickups) {
            if (!pickup.active) continue;
            const transform = pickup.getComponent<TransformComponent>("Transform");
            const info = pickup.getComponent<PickupComponent>("Pickup");
            if (!transform || !info) continue;
            activeIds.add(pickup.id);

            let g = this.pickupSprites.get(pickup.id);
            if (!g) {
                g = new Graphics();
                g.zIndex = 4;
                this.worldLayer.addChild(g);
                this.pickupSprites.set(pickup.id, g);
                this.worldLayer.sortChildren();
            }

            const color =
                info.kind === "ore-common"
                    ? 0xf59e0b
                    : info.kind === "ore-rare"
                        ? 0x7c3aed
                        : 0xffd166;
            g.clear();
            g.circle(0, 0, Math.max(2, Math.round(transform.width * 0.5))).fill(
                color
            );
            g.circle(0, 0, Math.max(2, Math.round(transform.width * 0.5))).stroke({
                width: 1,
                color: 0x000000,
                alignment: 0,
            });
            g.x = Math.floor(transform.x - cam.x + transform.width * 0.5);
            g.y = Math.floor(transform.y - cam.y + transform.height * 0.5);
        }

        for (const [id, g] of this.pickupSprites.entries()) {
            if (!activeIds.has(id)) {
                g.destroy();
                this.pickupSprites.delete(id);
            }
        }
    }

    private updateXpUI() {
        if (!this.hudXpFill || !this.hudXpText || !this.hudLevelText) return;
        const ratio = Math.max(0, Math.min(1, this.xpState.progress ?? 0));
        this.hudXpFill.style.width = `${ratio * 100}%`;
        const current = Math.floor(this.xpState.currentXp);
        const required = Math.floor(this.xpState.requiredXp);
        this.hudXpText.textContent = `XP: ${current} / ${required}`;
        this.hudLevelText.textContent = `Level ${this.xpState.level}`;
    }

    private updateOreUI() {
        // Weapon upgrade overlay renders ore directly when opened.
    }

    private updateWaveUI() {
        if (!this.hudWave || !this.hudWaveTimer || !this.hudWaveBudget) return;
        const state = this.waveManager?.getState();
        if (!state) return;

        const waveLabel = state.endless
            ? `Wave ${state.waveNumber} (Endless)`
            : `Wave ${state.waveNumber}/${state.totalWaves}`;
        this.hudWave.textContent = waveLabel;

        if (state.inIntermission) {
            this.hudWaveTimer.textContent = `Break: ${this.formatSeconds(
                state.intermissionRemaining
            )}`;
        } else {
            const remaining = Math.max(
                0,
                state.durationSeconds - state.elapsedSeconds
            );
            this.hudWaveTimer.textContent = `Time: ${this.formatSeconds(remaining)}`;
        }

        this.hudWaveBudget.textContent = `Budget: ${state.currentBudget.toFixed(
            1
        )} / +${state.budgetPerSecond.toFixed(1)}/s`;
    }

    private updateHealthUI(dt: number) {
        if (!this.hudHealthFill || !this.hudHealthText) return;
        const player = this.entityManager.player;
        const health = player?.getComponent<HealthComponent>("Health");
        if (!health) return;

        if (this.displayHealth === 0) this.displayHealth = health.current;
        this.displayHealth +=
            (health.current - this.displayHealth) * Math.min(1, dt * 0.2);

        const ratio = Math.max(0, Math.min(1, this.displayHealth / health.max));
        this.hudHealthFill.style.width = `${ratio * 100}%`;
        this.hudHealthText.textContent = `HP: ${Math.round(this.displayHealth)}/${health.max
            }`;
    }

    private updateHealthUIManual(current: number, max: number) {
        if (!this.hudHealthFill || !this.hudHealthText) return;
        this.displayHealth = current;
        const ratio = Math.max(0, Math.min(1, current / max));
        this.hudHealthFill.style.width = `${ratio * 100}%`;
        this.hudHealthText.textContent = `HP: ${Math.round(current)}/${Math.round(
            max
        )}`;
    }

    private updateDebugPanel(deltaMs: number) {
        if (!this.hudDebug || !this.hudDebugList) return;
        this.hudDebug.style.display = this.debugState.showPanel ? "block" : "none";
        if (!this.debugState.showPanel) return;

        const fps = deltaMs > 0 ? Math.round(1000 / deltaMs) : 0;
        const player = this.entityManager.player;
        const health = player?.getComponent<HealthComponent>("Health");
        const hpText = health
            ? `${Math.round(health.current)}/${health.max}`
            : "n/a";
        const waveState = this.waveManager?.getState();
        const lines: string[] = [];
        lines.push("DEBUG (F1 hide)");
        lines.push(`Player HP: ${hpText}`);
        lines.push(`Enemies: ${this.entityManager.enemies.length}`);
        lines.push(
            `Projectiles: ${this.projectileManager.getActiveProjectiles().length}`
        );
        lines.push(`Kills: ${this.combatSystem.getKillCount()}`);
        lines.push(
            `Level: ${this.xpState.level} (${Math.round(
                (this.xpState.progress ?? 0) * 100
            )}%)`
        );
        const pending =
            this.pendingLevelUps > 0 ? ` | Pending: ${this.pendingLevelUps}` : "";
        lines.push(
            `XP: ${Math.floor(this.xpState.currentXp)}/${Math.floor(
                this.xpState.requiredXp
            )}${pending}`
        );
        lines.push(`Ore: ${this.progression.getOre()}`);
        if (this.appliedUpgrades.length > 0) {
            const latest = this.appliedUpgrades
                .slice(-3)
                .map((u) => u.name)
                .join(", ");
            lines.push(`Upgrades: ${latest}`);
        }
        if (waveState) {
            const remaining = waveState.inIntermission
                ? `Break ${this.formatSeconds(waveState.intermissionRemaining)}`
                : `${this.formatSeconds(
                    Math.max(0, waveState.durationSeconds - waveState.elapsedSeconds)
                )} left`;
            const next = waveState.nextEvent
                ? `${waveState.nextEvent.eventType} @ ${Math.round(
                    waveState.nextEvent.triggerTime
                )}s`
                : "None";
            lines.push(
                `Wave: ${waveState.waveNumber}/${waveState.totalWaves}${waveState.endless ? " (Endless)" : ""
                }`
            );
            lines.push(`Timer: ${remaining}`);
            lines.push(
                `Budget: ${waveState.currentBudget.toFixed(
                    1
                )} (+${waveState.budgetPerSecond.toFixed(1)}/s)`
            );
            lines.push(`Next Event: ${next}`);
        }
        const audioDebug = this.sound.getDebugState();
        lines.push(
            `Audio: SFX ${audioDebug.activeSfx} | Music: ${audioDebug.music}`
        );
        const vols = audioDebug.settings;
        lines.push(
            `Vol M:${Math.round(vols.master * 100)}% S:${Math.round(
                vols.sfx * 100
            )}% UI:${Math.round(vols.ui * 100)}% BGM:${Math.round(
                vols.music * 100
            )}%${vols.muted ? " [MUTED]" : ""}`
        );
        lines.push(`FPS: ${fps}`);
        if (this.mapInfo) {
            const reachable = Math.round(this.mapInfo.reachableRatio * 100);
            const walkable = Math.round(this.mapInfo.walkableRatio * 100);
            lines.push(`Map Seed: ${this.mapInfo.seed}`);
            lines.push(`Walkable/Reachable: ${walkable}% / ${reachable}%`);
        }
        lines.push(
            `[1] Infinite HP: ${this.debugState.infinitePlayerHealth ? "ON" : "OFF"}`
        );
        lines.push(
            `[2] One-hit Enemies: ${this.debugState.oneHitKillEnemies ? "ON" : "OFF"}`
        );
        lines.push(`[3] Spawn Test Enemies`);
        lines.push(`[4] Clear Enemies`);
        lines.push(`[5] Hitboxes: ${this.debugState.showHitboxes ? "ON" : "OFF"}`);
        lines.push(`[6] Damage Log: ${this.debugState.logDamage ? "ON" : "OFF"}`);
        lines.push(`[7] Skip Wave`);
        lines.push(`[0] Restart Game`);
        lines.push(`[L] Force Level Up | +50 XP: [ | +500 XP: ]`);
        if (this.debugState.logDamage) {
            lines.push("Recent hits:");
            const logs = this.combatSystem.getDamageLog();
            for (let i = Math.max(0, logs.length - 4); i < logs.length; i++) {
                lines.push(`- ${logs[i]}`);
            }
        }
        this.hudDebugList.textContent = lines.join("\n");
    }

    private drawHitboxes() {
        if (!this.hitboxG || !this.pixelMap) return;
        this.hitboxG.clear();
        if (!this.debugState.showHitboxes) return;
        const cam = this.pixelMap.getCamera();
        this.hitboxG.stroke({ width: 1, color: 0xff00ff, alignment: 0 });

        const player = this.entityManager.player;
        const pTransform = player?.getComponent<TransformComponent>("Transform");
        const pCollision = player?.getComponent<CollisionComponent>("Collision");
        if (player && pTransform) {
            const pr = pCollision?.radius ?? pTransform.width * 0.5;
            this.hitboxG.circle(
                Math.floor(pTransform.x - cam.x + pTransform.width * 0.5),
                Math.floor(pTransform.y - cam.y + pTransform.height * 0.5),
                pr
            );
        }

        for (const enemy of this.entityManager.enemies) {
            const t = enemy.getComponent<TransformComponent>("Transform");
            const c = enemy.getComponent<CollisionComponent>("Collision");
            if (!t) continue;
            const r = c?.radius ?? t.width * 0.5;
            this.hitboxG.circle(
                Math.floor(t.x - cam.x + t.width * 0.5),
                Math.floor(t.y - cam.y + t.height * 0.5),
                r
            );
        }

        for (const proj of this.projectileManager.getActiveProjectiles()) {
            if (!proj.active) continue;
            this.hitboxG.circle(
                Math.floor(proj.x - cam.x),
                Math.floor(proj.y - cam.y),
                proj.radius
            );
        }
    }

    private handleDebugKey = (e: KeyboardEvent) => {
        if (this.pauseReason === "death") {
            if (e.code === "Enter" || e.code === "Space" || e.code === "KeyR") {
                this.restartGame();
                e.preventDefault();
            }
            return;
        }
        if (this.pauseReason === "weapon-upgrade") {
            return;
        }
        if (this.pauseReason === "level-up") {
            switch (e.code) {
                case "Digit1":
                case "Digit2":
                case "Digit3": {
                    const idx = parseInt(e.code.replace("Digit", ""), 10) - 1;
                    this.selectUpgradeByIndex(idx);
                    e.preventDefault();
                    return;
                }
                default:
                    return;
            }
        }
        switch (e.code) {
            case "F1":
                this.debugState.showPanel = !this.debugState.showPanel;
                break;
            case "Digit1":
                this.debugState.infinitePlayerHealth =
                    !this.debugState.infinitePlayerHealth;
                this.syncCombatFlags();
                break;
            case "Digit2":
                this.debugState.oneHitKillEnemies = !this.debugState.oneHitKillEnemies;
                this.syncCombatFlags();
                break;
            case "Digit3":
                this.spawnTestEnemies();
                break;
            case "Digit4":
                this.clearAllEnemies();
                break;
            case "Digit5":
                this.debugState.showHitboxes = !this.debugState.showHitboxes;
                if (!this.debugState.showHitboxes) this.hitboxG?.clear();
                break;
            case "Digit6":
                this.debugState.logDamage = !this.debugState.logDamage;
                this.syncCombatFlags();
                if (!this.debugState.logDamage) this.combatSystem.clearLog();
                break;
            case "Digit7":
                this.waveManager?.skipToNextWave();
                break;
            case "Digit0":
                this.restartGame();
                break;
            case "KeyL":
                this.forceLevelUp(1);
                break;
            case "BracketRight":
                this.grantXp(500);
                break;
            case "BracketLeft":
                this.grantXp(50);
                break;
        }
    };

    private syncCombatFlags() {
        this.combatSystem.setFlags({
            infinitePlayerHealth: this.debugState.infinitePlayerHealth,
            oneHitKillEnemies: this.debugState.oneHitKillEnemies,
            logDamage: this.debugState.logDamage,
        });
    }

    private spawnTestEnemies() {
        this.spawnController?.spawnBatch(5);
    }

    private spawnOreForWave(waveIndex: number) {
        if (!this.mapInfo || !this.tileMap) return;
        const tiles = this.mapInfo.spawnableTiles;
        if (!tiles || tiles.length === 0) return;
        const tileSize = this.tileMap.virtualPixelScale;
        const commonCount = Math.min(12, 6 + Math.floor(waveIndex * 0.8));
        const rareCount = Math.max(1, Math.floor(commonCount * 0.25));
        const rand = (max: number) => Math.floor(Math.random() * max);

        for (let i = 0; i < commonCount; i++) {
            const tile = tiles[rand(tiles.length)];
            this.spawnOrePickup(
                {
                    x: tile.x * tileSize + tileSize * 0.5,
                    y: tile.y * tileSize + tileSize * 0.5,
                },
                3 + rand(4),
                "ore-common"
            );
        }
        for (let i = 0; i < rareCount; i++) {
            const tile = tiles[rand(tiles.length)];
            this.spawnOrePickup(
                {
                    x: tile.x * tileSize + tileSize * 0.5,
                    y: tile.y * tileSize + tileSize * 0.5,
                },
                8 + rand(6),
                "ore-rare"
            );
        }
    }

    private clearAllEnemies() {
        for (const enemy of [...this.entityManager.enemies]) {
            this.entityManager.removeEntity(enemy);
        }
    }

    private restartGame() {
        window.location.reload();
    }

    private createDomHud() {
        if (this.hudRoot) {
            this.hudRoot.remove();
        }
        const root = document.createElement("div");
        root.className = "hud-overlay";

        const health = document.createElement("div");
        health.className = "hud-health";
        const bar = document.createElement("div");
        bar.className = "hud-health-bar";
        const fill = document.createElement("div");
        fill.className = "hud-health-fill";
        bar.appendChild(fill);
        const hpText = document.createElement("div");
        hpText.className = "hud-health-text";
        hpText.textContent = "HP: --/--";
        health.appendChild(bar);
        health.appendChild(hpText);

        const xp = document.createElement("div");
        xp.className = "hud-xp";
        const xpHeader = document.createElement("div");
        xpHeader.className = "hud-xp-header";
        xpHeader.textContent = "Level 1";
        const xpBar = document.createElement("div");
        xpBar.className = "hud-xp-bar";
        const xpFill = document.createElement("div");
        xpFill.className = "hud-xp-fill";
        xpBar.appendChild(xpFill);
        const xpText = document.createElement("div");
        xpText.className = "hud-xp-text";
        xpText.textContent = "XP: 0 / 0";
        xp.appendChild(xpHeader);
        xp.appendChild(xpBar);
        xp.appendChild(xpText);

        const wave = document.createElement("div");
        wave.className = "hud-wave";
        const waveTitle = document.createElement("div");
        waveTitle.className = "hud-wave-title";
        waveTitle.textContent = "Wave --";
        const waveTimer = document.createElement("div");
        waveTimer.className = "hud-wave-timer";
        waveTimer.textContent = "Time: --";
        const waveBudget = document.createElement("div");
        waveBudget.className = "hud-wave-budget";
        waveBudget.textContent = "Budget: --";
        wave.appendChild(waveTitle);
        wave.appendChild(waveTimer);
        wave.appendChild(waveBudget);

        const debug = document.createElement("div");
        debug.className = "hud-debug";
        const debugTitle = document.createElement("h4");
        debugTitle.textContent = "Debug";
        const debugActions = document.createElement("div");
        debugActions.className = "hud-debug-actions";
        const xp50 = document.createElement("button");
        xp50.textContent = "+50 XP";
        xp50.onclick = () => this.grantXp(50);
        const xp500 = document.createElement("button");
        xp500.textContent = "+500 XP";
        xp500.onclick = () => this.grantXp(500);
        const forceLevel = document.createElement("button");
        forceLevel.textContent = "Force Level Up";
        forceLevel.onclick = () => this.forceLevelUp(1);
        debugActions.appendChild(xp50);
        debugActions.appendChild(xp500);
        debugActions.appendChild(forceLevel);

        const makeSliderRow = (label: string) => {
            const row = document.createElement("label");
            row.className = "hud-audio__row";
            const name = document.createElement("span");
            name.textContent = label;
            const input = document.createElement("input");
            input.type = "range";
            input.min = "0";
            input.max = "100";
            input.step = "1";
            input.className = "hud-audio__slider";
            const value = document.createElement("span");
            value.className = "hud-audio__value";
            value.textContent = "100%";
            row.appendChild(name);
            row.appendChild(input);
            row.appendChild(value);
            return { row, input, value };
        };

        const audioPanel = document.createElement("div");
        audioPanel.className = "hud-audio";
        const audioHeader = document.createElement("div");
        audioHeader.className = "hud-audio__header";
        audioHeader.textContent = "Audio";
        const masterRow = makeSliderRow("Master");
        const sfxRow = makeSliderRow("SFX");
        const uiRow = makeSliderRow("UI");
        const musicRow = makeSliderRow("Music");
        const muteRow = document.createElement("label");
        muteRow.className = "hud-audio__toggle";
        const muteCheckbox = document.createElement("input");
        muteCheckbox.type = "checkbox";
        const muteLabel = document.createElement("span");
        muteLabel.textContent = "Mute All";
        muteRow.appendChild(muteCheckbox);
        muteRow.appendChild(muteLabel);
        audioPanel.appendChild(audioHeader);
        audioPanel.appendChild(masterRow.row);
        audioPanel.appendChild(sfxRow.row);
        audioPanel.appendChild(uiRow.row);
        audioPanel.appendChild(musicRow.row);
        audioPanel.appendChild(muteRow);

        this.hudAudioMaster = masterRow.input;
        this.hudAudioSfx = sfxRow.input;
        this.hudAudioUi = uiRow.input;
        this.hudAudioMusic = musicRow.input;
        this.hudAudioMute = muteCheckbox;
        this.hudAudioMasterValue = masterRow.value;
        this.hudAudioSfxValue = sfxRow.value;
        this.hudAudioUiValue = uiRow.value;
        this.hudAudioMusicValue = musicRow.value;

        const debugList = document.createElement("pre");
        debugList.textContent = "";
        debug.appendChild(debugTitle);
        debug.appendChild(debugActions);
        debug.appendChild(audioPanel);
        debug.appendChild(debugList);

        const levelOverlay = document.createElement("div");
        levelOverlay.className = "levelup-overlay hidden";
        (levelOverlay as any).dataset.overlayId = `lu-root`;
        const levelModal = document.createElement("div");
        levelModal.className = "levelup-modal";
        const modalTitle = document.createElement("h3");
        modalTitle.textContent = "Level Up!";
        const modalSub = document.createElement("p");
        modalSub.textContent = "Pick one upgrade to continue.";
        const levelChoices = document.createElement("div");
        levelChoices.className = "levelup-options";
        levelChoices.addEventListener('pointerdown', (ev) => {
            const el = ev.target as HTMLElement;
            const card = el.closest('.levelup-card') as HTMLElement | null;
            if (!card) return;
            const idxAttr = card.getAttribute('data-idx');
            if (idxAttr) {
                const idx = parseInt(idxAttr, 10);
                const choice = this.levelUpOptions[idx];
                if (choice) {
                    console.log('[levelup:delegated-pointerdown]', choice.name);
                    ev.stopPropagation();
                    ev.preventDefault();
                    this.selectUpgrade(choice);
                }
            }
        }, { capture: true });
        levelChoices.addEventListener('click', (ev) => {
            const el = ev.target as HTMLElement;
            const card = el.closest('.levelup-card') as HTMLElement | null;
            if (!card) return;
            const idxAttr = card.getAttribute('data-idx');
            if (idxAttr) {
                const idx = parseInt(idxAttr, 10);
                const choice = this.levelUpOptions[idx];
                if (choice) {
                    console.log('[levelup:delegated-click]', choice.name);
                    ev.stopPropagation();
                    ev.preventDefault();
                    this.selectUpgrade(choice);
                }
            }
        }, { capture: true });
        levelModal.appendChild(modalTitle);
        levelModal.appendChild(modalSub);
        levelModal.appendChild(levelChoices);
        levelOverlay.appendChild(levelModal);

        const weaponOverlay = document.createElement("div");
        weaponOverlay.className = "weaponup-overlay";
        const weaponModal = document.createElement("div");
        weaponModal.className = "weaponup-modal";
        const weaponHeader = document.createElement("h3");
        weaponHeader.textContent = "Weapon Upgrades";
        const weaponList = document.createElement("div");
        weaponList.className = "weaponup-list";
        const weaponOre = document.createElement("div");
        weaponOre.className = "weaponup-ore";
        const weaponClose = document.createElement("button");
        weaponClose.className = "weaponup-close";
        weaponClose.textContent = "Resume";
        weaponClose.onclick = () => this.hideWeaponUpgradeOverlay();
        weaponModal.appendChild(weaponHeader);
        weaponModal.appendChild(weaponOre);
        weaponModal.appendChild(weaponList);
        weaponModal.appendChild(weaponClose);
        weaponOverlay.appendChild(weaponModal);

        const gameOverOverlay = document.createElement("div");
        gameOverOverlay.className = "gameover-overlay";
        const gameOverModal = document.createElement("div");
        gameOverModal.className = "gameover-modal";
        const gameOverTitle = document.createElement("h3");
        gameOverTitle.textContent = "You Died";
        const gameOverSub = document.createElement("p");
        gameOverSub.className = "gameover-subtitle";
        gameOverSub.textContent = "Run it back and try a new build.";
        const gameOverStats = document.createElement("div");
        gameOverStats.className = "gameover-stats";
        const restartBtn = document.createElement("button");
        restartBtn.className = "gameover-restart";
        restartBtn.textContent = "Restart Run";
        restartBtn.onclick = () => this.restartGame();
        gameOverModal.appendChild(gameOverTitle);
        gameOverModal.appendChild(gameOverSub);
        gameOverModal.appendChild(gameOverStats);
        gameOverModal.appendChild(restartBtn);
        gameOverOverlay.appendChild(gameOverModal);

        root.appendChild(health);
        root.appendChild(xp);
        root.appendChild(wave);
        root.appendChild(debug);
        root.appendChild(levelOverlay);
        root.appendChild(weaponOverlay);
        root.appendChild(gameOverOverlay);
        document.body.appendChild(root);

        this.hudRoot = root;
        this.hudWave = waveTitle;
        this.hudWaveTimer = waveTimer;
        this.hudWaveBudget = waveBudget;
        this.hudHealthFill = fill;
        this.hudHealthText = hpText;
        this.hudXpFill = xpFill;
        this.hudXpText = xpText;
        this.hudLevelText = xpHeader;
        this.hudLevelOverlay = levelOverlay;
        this.levelUpOverlayId = 'lu-root';
        this.hudLevelChoices = levelChoices;
        this.hudWeaponOverlay = weaponOverlay;
        this.hudWeaponList = weaponList;
        this.hudWeaponOre = weaponOre;
        this.hudGameOverOverlay = gameOverOverlay;
        this.hudGameOverStats = gameOverStats;
        this.hudDebug = debug;
        this.hudDebugList = debugList;
        this.bindAudioSettingsControls();
    }

    private layoutHud = () => {
        if (!this.hudRoot) return;
        const rect = this.renderer.canvas.getBoundingClientRect();
        const same =
            this.lastHudRect &&
            this.lastHudRect.w === rect.width &&
            this.lastHudRect.h === rect.height &&
            this.lastHudRect.left === rect.left &&
            this.lastHudRect.top === rect.top;
        if (same) return;

        this.hudRoot.style.left = `${rect.left}px`;
        this.hudRoot.style.top = `${rect.top}px`;
        this.hudRoot.style.width = `${rect.width}px`;
        this.hudRoot.style.height = `${rect.height}px`;
        this.lastHudRect = {
            w: rect.width,
            h: rect.height,
            left: rect.left,
            top: rect.top,
        };
    };

    private bindAudioSettingsControls() {
        const attachSlider = (
            input: HTMLInputElement | undefined,
            category: VolumeCategory
        ) => {
            input?.addEventListener("input", (event) => {
                const target = event.target as HTMLInputElement;
                const value = Number(target.value) / 100;
                this.sound.setVolume(category, value);
                this.syncAudioSettingsUI();
            });
        };

        attachSlider(this.hudAudioMaster, "master");
        attachSlider(this.hudAudioSfx, "sfx");
        attachSlider(this.hudAudioUi, "ui");
        attachSlider(this.hudAudioMusic, "music");

        this.hudAudioMute?.addEventListener("change", (event) => {
            const target = event.target as HTMLInputElement;
            this.sound.mute("master", target.checked);
            this.syncAudioSettingsUI();
        });

        this.sound.onSettingsChanged((settings) =>
            this.syncAudioSettingsUI(settings)
        );
        this.syncAudioSettingsUI();
    }

    private syncAudioSettingsUI(settings?: SoundSettings) {
        const state = settings ?? this.sound.getSettings();
        const assign = (
            input: HTMLInputElement | undefined,
            valueEl: HTMLElement | undefined,
            value: number
        ) => {
            const pct = Math.round(value * 100);
            if (input) input.value = pct.toString();
            if (valueEl) valueEl.textContent = `${pct}%`;
        };
        assign(this.hudAudioMaster, this.hudAudioMasterValue, state.master);
        assign(this.hudAudioSfx, this.hudAudioSfxValue, state.sfx);
        assign(this.hudAudioUi, this.hudAudioUiValue, state.ui);
        assign(this.hudAudioMusic, this.hudAudioMusicValue, state.music);
        if (this.hudAudioMute) {
            this.hudAudioMute.checked = state.muted;
        }
    }

    private formatSeconds(seconds: number): string {
        const clamped = Math.max(0, seconds);
        const mins = Math.floor(clamped / 60);
        const secs = Math.floor(clamped % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    private getElapsedSeconds(): number {
        return Math.max(0, (performance.now() - this.sessionStartTime) / 1000);
    }

    private renderGameOverStats() {
        if (!this.hudGameOverStats) return;
        const waveState = this.waveManager?.getState();
        const timeSurvived = this.formatSeconds(
            Math.floor(this.getElapsedSeconds())
        );
        const stats = [
            { label: "Time Survived", value: timeSurvived },
            {
                label: "Wave Reached",
                value: waveState ? `Wave ${waveState.waveNumber}` : "Wave --",
            },
            { label: "Level Achieved", value: `Level ${this.xpState.level}` },
            {
                label: "XP Earned",
                value: Math.floor(this.xpState.totalEarned).toString(),
            },
            {
                label: "Enemies Defeated",
                value: this.combatSystem.getKillCount().toString(),
            },
            {
                label: "Upgrades Taken",
                value: this.appliedUpgrades.length.toString(),
            },
        ];
        this.hudGameOverStats.innerHTML = "";
        for (const stat of stats) {
            const row = document.createElement("div");
            row.className = "gameover-stats__row";
            const label = document.createElement("span");
            label.className = "gameover-stats__label";
            label.textContent = stat.label;
            const value = document.createElement("span");
            value.className = "gameover-stats__value";
            value.textContent = stat.value;
            row.appendChild(label);
            row.appendChild(value);
            this.hudGameOverStats.appendChild(row);
        }
    }

    private showGameOverOverlay() {
        if (!this.hudGameOverOverlay) return;
        this.hudGameOverOverlay.classList.add("visible");
    }

    private handlePlayerDeath() {
        if (this.gameEnded) return;
        this.gameEnded = true;
        this.gameplayPaused = true;
        this.pauseReason = "death";
        this.hideLevelUpOverlay();
        this.setCursorMode('ui');
        this.renderGameOverStats();
        this.showGameOverOverlay();
    }

    private checkPlayerDeath() {
        const player = this.entityManager.player;
        const health = player?.getComponent<HealthComponent>("Health");
        if (!player || !health) return;
        if (health.isDead()) {
            this.handlePlayerDeath();
        }
    }

    private refreshDirtyTiles() {
        if (!this.tileMap || !this.pixelMap) return;
        const dirty = this.tileMap.consumeDirtyTiles();
        if (dirty.length === 0) return;
        for (const { x, y } of dirty) {
            const color = this.tileMap.getPixelColorForTile(x, y);
            this.pixelMap.drawTile(x, y, color);
        }
    }
}
