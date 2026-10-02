import type { Player, Vec3 } from './protocol.ts';

export const DEFAULT_VOICE_VOLUME = .55;
export const VOICE_REF_DISTANCE = 1.5;
export const VOICE_MAX_DISTANCE = 9;
export const DEFAULT_NOISE_GATE_DB = -48;

export function voicePosition(player: Pick<Player, 'position' | 'mode'>): Vec3 {
  return [player.position[0], player.position[1] + (player.mode === 'sit' || player.mode === 'piano' ? .65 : 1), player.position[2]];
}

/** Gentle inverse loss, followed by a smooth fade to silence at the room range. */
export function voiceDistanceGain(distance: number): number {
  if (!Number.isFinite(distance) || distance >= VOICE_MAX_DISTANCE) return 0;
  if (distance <= VOICE_REF_DISTANCE) return 1;
  const t = (distance - VOICE_REF_DISTANCE) / (VOICE_MAX_DISTANCE - VOICE_REF_DISTANCE);
  const fade = 1 - t * t * (3 - 2 * t);
  return VOICE_REF_DISTANCE / distance * fade;
}

/** A downward expander with hysteresis and a hold, never a hard speech cutoff. */
export class SoftVoiceGate {
  private holdUntil = -Infinity;
  private open = false;
  threshold = DEFAULT_NOISE_GATE_DB;
  setThreshold(db: number) { if (Number.isFinite(db)) this.threshold = Math.max(-60, Math.min(-30, db)); }
  gain(rms: number, now: number): number {
    const threshold = 10 ** (this.threshold / 20), level = Math.max(0, rms);
    if (level >= threshold || (this.open && level >= threshold * .5)) {
      this.open = true; this.holdUntil = now + .2;
    }
    if (now <= this.holdUntil) return 1;
    this.open = false;
    return Math.max(.12, Math.min(1, (level / threshold) ** 1.5));
  }
  reset() { this.open = false; this.holdUntil = -Infinity; }
}
