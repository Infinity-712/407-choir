import { DEFAULT_AVATAR, type AvatarConfig } from './protocol.ts';

export const AVATAR_STORAGE_KEY = '407-choir-avatar-v1';

const pick = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)];
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const choice = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;

/** Stored and network data are both untrusted; only bounded, known fields survive. */
export function sanitizeAvatar(value: unknown): AvatarConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    skin: color(input.skin, DEFAULT_AVATAR.skin),
    hairColor: color(input.hairColor, DEFAULT_AVATAR.hairColor),
    shirtColor: color(input.shirtColor, DEFAULT_AVATAR.shirtColor),
    pantsColor: color(input.pantsColor, DEFAULT_AVATAR.pantsColor),
    hairStyle: choice(input.hairStyle, ['bob', 'crop', 'buns', 'swoop'], DEFAULT_AVATAR.hairStyle),
    outfit: choice(input.outfit, ['hoodie', 'tee', 'overalls'], DEFAULT_AVATAR.outfit),
    accessory: choice(input.accessory, ['none', 'glasses', 'headphones', 'bow'], DEFAULT_AVATAR.accessory),
    faceWidth: number(input.faceWidth, DEFAULT_AVATAR.faceWidth, 0.8, 1.2),
    eyeSize: number(input.eyeSize, DEFAULT_AVATAR.eyeSize, 0.7, 1.35),
    eyeSpacing: number(input.eyeSpacing, DEFAULT_AVATAR.eyeSpacing, 0.75, 1.25),
    mouth: choice(input.mouth, ['smile', 'cat', 'small'], DEFAULT_AVATAR.mouth),
    cheek: number(input.cheek, DEFAULT_AVATAR.cheek, 0, 1),
  };
}

export function randomAvatar(): AvatarConfig {
  return {
    skin: pick(['#f4c7a1', '#e5ad86', '#bd815d', '#8a553d', '#f8dbbd', '#653e30']),
    hairColor: pick(['#513d37', '#252330', '#be8450', '#ead3a4', '#b98991', '#8794ae']),
    shirtColor: pick(['#bfa9ed', '#8abfb0', '#f0b17c', '#9dbbdd', '#db9caf', '#d9c97b']),
    pantsColor: pick(['#546574', '#5e536e', '#9a8876', '#5d7368']),
    hairStyle: pick(['bob', 'crop', 'buns', 'swoop']),
    outfit: pick(['hoodie', 'tee', 'overalls']),
    accessory: pick(['none', 'glasses', 'headphones', 'bow']),
    faceWidth: 0.85 + Math.random() * 0.3,
    eyeSize: 0.85 + Math.random() * 0.4,
    eyeSpacing: 0.8 + Math.random() * 0.4,
    mouth: pick(['smile', 'cat', 'small']),
    cheek: 0.25 + Math.random() * 0.65,
  };
}

export function loadAvatar(): AvatarConfig {
  try { return sanitizeAvatar(JSON.parse(globalThis.localStorage.getItem(AVATAR_STORAGE_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_AVATAR }; }
}

export function saveAvatar(config: AvatarConfig): void {
  try { globalThis.localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(sanitizeAvatar(config))); }
  catch { /* Private mode and storage quotas must not block entering the room. */ }
}
