import {io} from 'socket.io-client';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const url=process.env.PUBLIC_URL??'https://124.221.108.122';
const sockets=[];
try {
  for(let n=0;n<2;n++){
    const socket=io(url,{transports:['websocket'],reconnection:false,timeout:10000});
    sockets.push(socket);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    assert.equal(socket.io.engine.transport.name,'websocket');
    const joined=await socket.timeout(5000).emitWithAck('join',{roomId:'wss-'+process.pid,name:'WSS'+n});
    assert.equal(joined.ok,true);
    if(n===1)assert.equal(Object.keys(joined.state.players).length,2);
  }
  const received=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Public signaling timed out')),5000);
    sockets[1].once('signal',message=>{clearTimeout(timer);assert.equal(message.from,sockets[0].id);resolve(true);});
  });
  const ack=await sockets[0].timeout(5000).emitWithAck('signal',{to:sockets[1].id,description:{type:'offer',sdp:'public-wss-test'}});
  assert.equal(ack.ok,true);await received;
  await writeFile('artifacts/public-signaling.json',JSON.stringify({url,trustedTLS:true,transport:'websocket',twoPlayersJoined:true,signalingDelivered:true},null,2));
  console.log('Trusted public WSS: two players joined and signaling delivered');
} finally {for(const socket of sockets)socket.disconnect();}
