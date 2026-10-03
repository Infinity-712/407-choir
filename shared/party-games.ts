import type { RoomState } from './protocol.ts';

export type PartyGameId = 'musical-chairs' | 'color-war';

/** A populated lobby reserves the room; a completed result never does. */
export function getOccupiedPartyGame(state: Pick<RoomState, 'minigame' | 'colorWar'> | null | undefined): PartyGameId | null {
  const chairs = state?.minigame;
  if (chairs && chairs.phase !== 'finished' && chairs.participants.length > 0) return 'musical-chairs';
  const colors = state?.colorWar;
  if (colors && colors.phase !== 'finished' && Object.keys(colors.members).length > 0) return 'color-war';
  return null;
}
