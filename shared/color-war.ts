import type { Player, Vec3 } from './protocol.ts';

export type ColorTeam = 'S' | 'A' | 'T' | 'B' | 'P';
export const COLOR_TEAMS: {id:ColorTeam;label:string;color:string}[] = [
  {id:'S',label:'S 女高音',color:'#ed5966'}, {id:'A',label:'A 女低音',color:'#518deb'},
  {id:'T',label:'T 男高音',color:'#43b984'}, {id:'B',label:'B 男低音',color:'#edc84a'},
  {id:'P',label:'P 钢琴',color:'#f4f3ed'},
];
export const COLOR_WAR_COMMANDS = ['color-war:join','color-war:ready','color-war:start','color-war:leave','color-war:stop','color-war:reset','color-war:throw'] as const;
export const COLOR_WAR_RULES = {teamLimit:4,playerLimit:20,countdownMs:3000,durationMs:180000,throwCooldownMs:650,immuneMs:900,enemyPoints:10,friendlyPoints:-8,chairPoints:20,melodyPoints:15,scatterMs:12000,eventFirstMs:8000,eventEveryMs:25000,eventLifetimeMs:20000,melodyGapMs:3000,splashMs:3000,maxProjectiles:120,maxSplashes:80} as const;
// AvatarRig model units; RoomWorld renders that rig at .84 scale. Gameplay uses
// the face and garment, so hair/accessories/animated hands do not enlarge targets.
export const COLOR_WAR_BODY = {scale:.84,headCenter:1.065,headRadius:[.271,.281,.246] as const,torsoRadius:.192,torsoDepth:.192*.72,torsoBottom:.429,torsoTop:.837,seatDrop:.33,chairForward:.19,upperPivot:.437,pianoLean:.35,pianoWorldForward:.14,launchHeight:.8} as const;
export const throwOrigin=(player:Pick<Player,'position'|'mode'|'yaw'>):Vec3=>{
  const sitting=player.mode==='sit'||player.mode==='piano',forward=player.mode==='sit'?COLOR_WAR_BODY.chairForward*COLOR_WAR_BODY.scale:player.mode==='piano'?COLOR_WAR_BODY.pianoWorldForward:0;
  return [player.position[0]+Math.sin(player.yaw)*forward,player.position[1]+COLOR_WAR_BODY.launchHeight-(sitting?COLOR_WAR_BODY.seatDrop*COLOR_WAR_BODY.scale:0),player.position[2]+Math.cos(player.yaw)*forward];
};
export type ColorWarMember = {team:ColorTeam;ready:boolean;score:number;nextThrowAt:number;scatterUntil:number;immuneUntil:number};
export type ColorWarProjectile = {id:string;ownerId:string;team:ColorTeam;position:Vec3;velocity:Vec3;bornAt:number};
export type ColorWarState = {
  phase:'lobby'|'countdown'|'playing'|'finished';hostId:string|null;round:number;startsAt:number;endsAt:number;
  members:Record<string,ColorWarMember>;scores:Record<ColorTeam,number>;
  projectiles:ColorWarProjectile[];
  splashes:Array<{id:string;team:ColorTeam;position:Vec3;targetId?:string;friendly:boolean;expiresAt:number}>;
  event:null|{id:string;kind:'chair'|'melody';assetId?:string;expiresAt:number;melody:number[];progress:Record<string,number>};
  winners:ColorTeam[];finishReason:string|null;
};
