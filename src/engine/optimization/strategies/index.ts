import type { Category } from '../../config/categories.js';
import type { OptimizationStrategy } from '../types.js';
import { ChatStrategy } from './chat.js';
import { ImageStrategy } from './image.js';
import { VoiceStrategy } from './voice.js';
import { VideoStrategy } from './video.js';
import { MusicStrategy } from './music.js';
import { CodeStrategy } from './code.js';
import { DocumentStrategy } from './document.js';

const strategies: Record<Category, OptimizationStrategy> = {
  chat: new ChatStrategy(),
  image: new ImageStrategy(),
  voice: new VoiceStrategy(),
  video: new VideoStrategy(),
  music: new MusicStrategy(),
  code: new CodeStrategy(),
  document: new DocumentStrategy(),
};

export function getStrategy(category: Category): OptimizationStrategy {
  const strategy = strategies[category];
  if (!strategy) {
    throw new Error(`No optimization strategy found for category: ${category}`);
  }
  return strategy;
}

export function getAllStrategies(): OptimizationStrategy[] {
  return Object.values(strategies);
}

export { ChatStrategy, ImageStrategy, VoiceStrategy, VideoStrategy, MusicStrategy, CodeStrategy, DocumentStrategy };
