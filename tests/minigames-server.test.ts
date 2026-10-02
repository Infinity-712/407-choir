import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { startServer } from '../server/index.ts';
import type { Ack, RoomLayout, RoomState } from '../shared/protocol.ts';
test('socket minigame registration is authoritative and broadcasts only within its room',async()=>{
  const layout:RoomLayout={version:1,bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},spawn:[0,0,0],floors:[],colliders:[],assets:[]};
  const server=await startServer({port:0,host:'127.0.0.1',layout});const sockets:Socket[]=[];
  const connect=async()=>{const socket=io(server.url,{transports:['websocket'],reconnection:false});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;};
  const emit=(socket:Socket,event:string,data:unknown)=>socket.timeout(1200).emitWithAck(event,data) as Promise<Ack>;
  try{const a=await connect(),b=await connect(),listener=await connect();await emit(a,'join',{roomId:'one',name:'A'});await emit(b,'join',{roomId:'two',name:'B'});await emit(listener,'join',{roomId:'one',name:'Listener'});
    const outsiderUpdates:RoomState[]=[];b.on('state',state=>outsiderUpdates.push(state));
    const update=new Promise<RoomState>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No minigame broadcast')),1500);listener.on('state',state=>{if(state.minigame?.participants.includes(a.id!)){clearTimeout(timeout);resolve(state);}});});
    assert.equal((await emit(a,'minigame',{action:'join',playerId:b.id})).ok,true);assert.equal((await emit(b,'minigame',{action:'join'})).ok,true);assert.deepEqual((await update).minigame!.participants,[a.id]);assert.equal(outsiderUpdates.some(state=>state.minigame?.participants.includes(a.id!)),false);
    const sa=(await emit(a,'sync',{})).state!,sb=(await emit(b,'sync',{})).state!;assert.deepEqual(sa.minigame!.participants,[a.id]);assert.deepEqual(sb.minigame!.participants,[b.id]);
    assert.equal((await emit(a,'minigame',{action:'claim',gameId:'other',round:1,assetId:'game-chair-other-1-0'})).ok,false);
    a.disconnect();const remaining=(await emit(b,'sync',{})).state!;assert.deepEqual(remaining.minigame!.participants,[b.id]);
  }finally{sockets.forEach(socket=>socket.disconnect());await server.close();}
});
