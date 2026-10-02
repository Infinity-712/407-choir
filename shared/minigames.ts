import type {Collider,InteractionAsset,RoomLayout,Vec3} from './protocol.ts';

export const GAME_CENTER:Vec3=[1.3,0,1];
export const GAME_CHAIR_RADIUS=.75;
export const GAME_WALK_RADIUS=1.45;
export const GAME_MIN_PLAYERS=3;
export const GAME_MAX_PLAYERS=6;
export const GAME_MOTION_WINDOW_MS=4000;
export const GAME_MIN_DISTANCE=.8;
export const GAME_MIN_SPAN=.4;
export const GAME_COUNTDOWN_MS=3000;
export const GAME_SCRAMBLE_MS=12000;
export const GAME_ROUND_END_MS=3000;
export type MusicalChairsPhase='lobby'|'countdown'|'music'|'scramble'|'roundEnd'|'finished';
export type MusicalChairsState={
  kind:'musical-chairs';gameId:string|null;phase:MusicalChairsPhase;hostId:string|null;
  participants:string[];roster:Record<string,{name:string;shirtColor:string}>;
  alive:string[];eliminated:string[];round:number;chairs:InteractionAsset[];
  seats:Record<string,string>;movement:Record<string,{distance:number;eligible:boolean}>;
  phaseStartedAt:number;phaseEndsAt:number|null;musicVariant:number;
  winnerId:string|null;singerId:string|null;lastEliminatedId:string|null;
  message:string|null;teleportVersion:number;
};
export type MinigameAction=
  |{action:'join'|'leave'|'start'|'reset'|'cancel'}
  |{action:'claim';assetId:string;gameId:string;round:number}
  |{action:'nominate';playerId:string};
export function isMusicalChairsActive(game:MusicalChairsState|null|undefined):boolean{
  return !!game&&['countdown','music','scramble','roundEnd'].includes(game.phase);
}
export function isGameChair(id:string):boolean{return id.startsWith('game-chair-');}
export function createGameChairs(gameId:string,round:number,players:number):InteractionAsset[]{
  if(!/^[\w-]{1,64}$/.test(gameId)||!Number.isInteger(round)||round<1||!Number.isInteger(players)||players<2||players>GAME_MAX_PLAYERS)throw new Error('Invalid game chair generation');
  return Array.from({length:players-1},(_,index)=>{
    const angle=index*Math.PI*2/(players-1);
    const position:Vec3=[GAME_CENTER[0]+Math.sin(angle)*GAME_CHAIR_RADIUS,.4775,GAME_CENTER[2]+Math.cos(angle)*GAME_CHAIR_RADIUS];
    return {id:`game-chair-${gameId}-${round}-${index}`,label:`抢凳子 ${index+1}`,type:'chair',position,rotation:angle,
      approach:[GAME_CENTER[0]+Math.sin(angle)*1.28,0,GAME_CENTER[2]+Math.cos(angle)*1.28],radius:.6};
  });
}
export function gameChairCollider(chair:InteractionAsset):Collider{
  const cos=Math.cos(chair.rotation),sin=Math.sin(chair.rotation);
  const footprint:[number,number][]=[[-.235,-.22],[.235,-.22],[.235,.22],[-.235,.22]].map(([x,z])=>[chair.position[0]+x*cos+z*sin,chair.position[2]-x*sin+z*cos]);
  return {id:chair.id,min:[Math.min(...footprint.map(p=>p[0])),Math.min(...footprint.map(p=>p[1]))],max:[Math.max(...footprint.map(p=>p[0])),Math.max(...footprint.map(p=>p[1]))],footprint,minY:0,maxY:1};
}
/** This derived layout is shared by authoritative validation and local prediction. */
export function getMinigameLayout(layout:RoomLayout,game:MusicalChairsState|null|undefined):RoomLayout{
  if(!isMusicalChairsActive(game))return layout;
  return {...layout,assets:[...layout.assets.filter(asset=>asset.id!=='conductor'),...game!.chairs],
    colliders:[...layout.colliders.filter(c=>c.id!=='Conductor lectern'&&c.id!=='Conductor adjustable round stool'),...game!.chairs.map(gameChairCollider)]};
}
