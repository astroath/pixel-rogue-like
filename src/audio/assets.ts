import type { SoundAsset } from './SoundManager';

export const AUDIO_ASSETS: SoundAsset[] = [
  {
    id: 'enemy_hit',
    type: 'sfx',
    src: '/assets/sounds/generic_enemy_hit.mp3',
    baseVolume: 0.35,
    variations: {
      pitchMin: 0.95,
      pitchMax: 1.05,
    },
  },
];
