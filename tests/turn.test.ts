import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {makeTurnCredentials} from '../server/turn.ts';
import {startServer} from '../server/index.ts';

const options={secret:'server-only-test-secret',urls:['turn:127.0.0.1:3478?transport=udp'],ttlSeconds:21600};
test('TURN credentials expire, authenticate with coturn REST HMAC and isolate clients',()=>{
  const first=makeTurnCredentials(options,1000000),second=makeTurnCredentials(options,1000000);
  assert.equal(first.expiresAt,22600000);
  assert.ok(first.iceServer.username.startsWith('22600:'));
  assert.notEqual(first.iceServer.username,second.iceServer.username);
  assert.equal(first.iceServer.credential,createHmac('sha1',options.secret).update(first.iceServer.username).digest('base64'));
  assert.equal(JSON.stringify(first).includes(options.secret),false);
});
test('TURN rejects missing secret, invalid endpoints and unbounded lifetimes',()=>{
  for(const invalid of [{...options,secret:''},{...options,urls:['https://example.com']},{...options,urls:[]},{...options,ttlSeconds:0},{...options,ttlSeconds:Infinity}])assert.throws(()=>makeTurnCredentials(invalid));
});
test('public ICE API issues fresh uncached temporary credentials without the master secret',async()=>{
  const server=await startServer({port:0,host:'127.0.0.1',turn:options});
  try {
    const response=await fetch(server.url+'/api/config'),a=await response.json(),b=await(await fetch(server.url+'/api/config')).json();
    assert.equal(response.headers.get('cache-control'),'no-store');
    const turn=a.iceServers.find((s:{urls:string[]})=>s.urls.includes(options.urls[0]));
    assert.ok(turn.username);assert.ok(turn.credential);assert.ok(a.turnExpiresAt>Date.now());
    assert.notEqual(turn.username,b.iceServers.find((s:{username?:string})=>s.username)?.username);
    assert.equal(JSON.stringify(a).includes(options.secret),false);
  } finally {await server.close();}
});
