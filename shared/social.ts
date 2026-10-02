import type { BubbleStyle, ChoirPose, ConductorGesture } from './protocol.ts';

export const CHOIR_POSES: readonly ChoirPose[] = ['raise-left', 'raise-right', 'raise-both', 'hand-left-chest', 'hand-right-chest'];
export const CONDUCTOR_GESTURES: readonly ConductorGesture[] = ['beat', 'cue', 'crescendo', 'diminuendo', 'cutoff'];
export const BUBBLE_PALETTES: readonly BubbleStyle['palette'][] = ['cream', 'lavender', 'mint', 'peach'];
export const BUBBLE_SHAPES: readonly BubbleStyle['shape'][] = ['round', 'cloud'];
export const DEFAULT_BUBBLE_STYLE: BubbleStyle = { palette: 'lavender', shape: 'round' };
export const CHAT_MAX_CODEPOINTS = 80;
export const CHAT_DURATION_MS = 8000;

/** Preferences and chat payloads may contain only these presentation tokens. */
export function sanitizeBubbleStyle(value: unknown): BubbleStyle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { palette, shape } = value as Record<string, unknown>;
  if (!BUBBLE_PALETTES.includes(palette as BubbleStyle['palette']) || !BUBBLE_SHAPES.includes(shape as BubbleStyle['shape'])) return null;
  return { palette: palette as BubbleStyle['palette'], shape: shape as BubbleStyle['shape'] };
}
