import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { startServer } from '../server/index.ts';
import { COLOR_WAR_COMMANDS } from '../shared/color-war.ts';
import type { Ack, RoomLayout, RoomState } from '../shared/protocol.ts';

const layout:RoomLayout={version:1,bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},spawn:[0,0,0],floors:[],colliders:[],assets:[]};
const emit=(socket:Socket,event:string,payload:unknown={})=>socket.timeout(1500).emitWithAck(event,payload) as Promise<Ack>;
async function connect(url:string,sockets:Socket[]){
  const socket=io(url,{transports:['websocket'],reconnection:false});sockets.push(socket);
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;
}
function nextState(socket:Socket,accept:(state:RoomState)=>boolean,timeout=2000):Promise<RoomState>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('state',receive);reject(new Error('Timed out waiting for Color War state'));},timeout);
    const receive=(state:RoomState)=>{if(accept(state)){clearTimeout(timer);socket.off('state',receive);resolve(state);}};
    socket.on('state',receive);
  });
}

test('real Color War sockets register commands, synchronize a round, isolate rooms, and clean up departures',{timeout:15000},async()=>{
  const server=await startServer({port:0,host:'127.0.0.1',layout}),sockets:Socket[]=[];
  try{
    const a=await connect(server.url,sockets),b=await connect(server.url,sockets),outsider=await connect(server.url,sockets);
    const aId=a.id!,bId=b.id!,isolated:RoomState[]=[];outsider.on('state',(state:RoomState)=>isolated.push(state));
    assert.equal((await emit(a,'join',{roomId:'paint',name:'A'})).ok,true);
    assert.equal((await emit(b,'join',{roomId:'paint',name:'B'})).ok,true);
    assert.equal((await emit(outsider,'join',{roomId:'elsewhere',name:'Observer'})).ok,true);
    // Every public command must be registered and acknowledge an invalid nonmember request.
    for(const event of COLOR_WAR_COMMANDS){const response=await emit(outsider,event,{});assert.equal(response.ok,false,event);assert.ok(response.error,event);}
    assert.equal((await emit(a,'color-war:join',{team:'S',playerId:bId})).ok,true);
    assert.equal((await emit(b,'color-war:join',{team:'A'})).ok,true);
    const lobby=(await emit(a,'sync')).state!;assert.equal(lobby.colorWar!.hostId,aId);assert.equal(lobby.colorWar!.members[aId].team,'S');
    assert.equal((await emit(b,'color-war:start')).ok,false);
    assert.equal((await emit(a,'color-war:ready',{ready:true})).ok,true);
    assert.equal((await emit(b,'color-war:ready',{ready:true})).ok,true);
    const countdown=nextState(b,state=>state.colorWar?.phase==='countdown');
    const playing=nextState(b,state=>state.colorWar?.phase==='playing',5000);
    assert.equal((await emit(a,'color-war:start')).ok,true);
    const before=await countdown;assert.equal(before.colorWar!.endsAt-before.colorWar!.startsAt,180000);
    const running=await playing;assert.equal(running.colorWar!.round,1);assert.equal(Object.keys(running.colorWar!.members).length,2);
    assert.equal((await emit(outsider,'color-war:throw',{direction:[1,.3,0],ownerId:aId})).ok,false);
    const flying=nextState(b,state=>!!state.colorWar?.projectiles.some(ball=>ball.ownerId===aId));
    assert.equal((await emit(a,'color-war:throw',{direction:[1,.3,0],ownerId:bId,targetId:bId,score:9999})).ok,true);
    const flight=await flying;assert.ok(flight.colorWar!.projectiles.every(ball=>ball.ownerId===aId&&ball.team==='S'));assert.equal(flight.colorWar!.scores.S,0);
    const finished=nextState(b,state=>state.colorWar?.phase==='finished');
    assert.equal((await emit(a,'color-war:stop')).ok,true);const end=await finished;
    assert.deepEqual(end.colorWar!.projectiles,[]);assert.equal(end.colorWar!.event,null);
    const reset=nextState(b,state=>state.colorWar?.phase==='lobby');assert.equal((await emit(a,'color-war:reset')).ok,true);
    const fresh=await reset;assert.ok(Object.values(fresh.colorWar!.members).every(member=>!member.ready&&member.score===0));
    assert.equal((await emit(b,'color-war:leave')).ok,true);assert.equal((await emit(b,'sync')).state!.colorWar!.members[bId],undefined);
    assert.equal((await emit(b,'color-war:join',{team:'A'})).ok,true);
    for(const peer of [a,b])assert.equal((await emit(peer,'color-war:ready',{ready:true})).ok,true);
    assert.equal((await emit(a,'color-war:start')).ok,true);
    const departed=nextState(b,state=>!state.players[aId]&&state.colorWar?.phase==='finished');a.disconnect();
    const remaining=await departed;assert.equal(remaining.colorWar!.hostId,bId);assert.equal(remaining.colorWar!.members[aId],undefined);assert.deepEqual(remaining.colorWar!.projectiles,[]);
    assert.equal((await emit(b,'color-war:leave')).ok,true);assert.equal((await emit(b,'sync')).state!.colorWar,undefined);
    const other=(await emit(outsider,'sync')).state!;assert.equal(other.roomId,'elsewhere');assert.equal(other.colorWar,undefined);
    assert.ok(isolated.length>0);assert.ok(isolated.every(state=>state.roomId==='elsewhere'&&!state.players[aId]&&!state.players[bId]&&!state.colorWar));
  }finally{sockets.forEach(socket=>socket.disconnect());await server.close();}
});
