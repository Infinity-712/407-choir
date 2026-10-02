import {createHmac,randomBytes} from 'node:crypto';

export type TurnOptions={secret:string;urls:string[];ttlSeconds?:number};
export function makeTurnCredentials(options:TurnOptions,now=Date.now()) {
  const ttl=options.ttlSeconds??21600;
  if(!options.secret||!Array.isArray(options.urls)||!options.urls.length||options.urls.length>8||!options.urls.every(url=>typeof url==='string'&&/^(turn|turns):[^\s]+$/.test(url))||!Number.isInteger(ttl)||ttl<300||ttl>86400)throw new Error('Invalid TURN configuration');
  const expiry=Math.floor(now/1000)+ttl,username=`${expiry}:${randomBytes(12).toString('hex')}`;
  const credential=createHmac('sha1',options.secret).update(username).digest('base64');
  return {expiresAt:expiry*1000,iceServer:{urls:[...options.urls],username,credential}};
}
