import test from 'node:test';
import assert from 'node:assert/strict';
import { canStand, constrainRoomPosition, groundHeight, stepPosition, findPath, withinRoom } from '../shared/movement.ts';
import type { RoomLayout } from '../shared/protocol.ts';
import {readFileSync} from 'node:fs';
const layout:RoomLayout={version:1,bounds:{minX:-3,maxX:3,minZ:-3,maxZ:3},spawn:[0,0,2],assets:[],colliders:[{min:[-.5,-.5],max:[.5,.5]}],floors:[{min:[1,-3],max:[3,3],height:.25}]};
test('movement refuses to tunnel through furniture and slides along its side',()=>{assert.equal(canStand(layout,0,0),false);const p=stepPosition(layout,[-1,0,0],[1,0,0]);assert.ok(p[0]<-.5);});

const polygonRoom = {...layout,colliders:[],floors:[],footprint:[[-3,-3],[3,-3],[3,1],[1,1],[1,3],[-3,3]] as [number,number][]};
test('room footprints preserve concave recesses and avatar clearance',()=>{
  assert.equal(canStand(polygonRoom,2,2),false);
  assert.equal(canStand(polygonRoom,.9,2),false);
  assert.equal(canStand(polygonRoom,.8,2),true);
  assert.equal(canStand(polygonRoom,.9,.9),false,'radius overlaps the concave vertex');
  assert.equal(canStand(polygonRoom,.8,.8),true);
  const diagonal={...polygonRoom,footprint:[[-3,-3],[3,-3],[3,3]] as [number,number][]};
  assert.equal(canStand(diagonal,-1,1),false);
  assert.equal(canStand(diagonal,0,0),false);
  assert.equal(canStand(diagonal,.3,0),true);
  const p=stepPosition(diagonal,[1,0,0],[-1,0,0]);
  assert.ok(p[0]>=.18*Math.SQRT2-.001);
});
test('rotated furniture uses its precise footprint and ignores geometry below the floor',()=>{
  const room={...layout,floors:[],colliders:[{min:[-1,-1] as [number,number],max:[1,1] as [number,number],footprint:[[0,-1],[1,0],[0,1],[-1,0]] as [number,number][]}]};
  assert.equal(canStand(room,.9,.9),true,'AABB corner has no furniture');
  assert.equal(canStand(room,.55,.55),false,'avatar overlaps diagonal furniture edge');
  assert.equal(canStand(room,0,0),false);
  const sunken={...room,colliders:[{...room.colliders[0],minY:-1,maxY:0}]};
  assert.equal(canStand(sunken,0,0),true);
  const raised={...room,floors:[{min:[-3,-3] as [number,number],max:[3,3] as [number,number],height:.9}],colliders:[{...room.colliders[0],minY:0,maxY:.7}]};
  assert.equal(canStand(raised,0,0),true);
});
test('camera remains inside diagonal walls and cannot cross a recessed corner',()=>{
  const diagonal={...polygonRoom,footprint:[[-3,-3],[3,-3],[3,3]] as [number,number][]};
  const camera=constrainRoomPosition(diagonal,[1,0,0],[-2,2,0]);
  assert.equal(withinRoom(diagonal,camera[0],camera[2],.15),true);
  assert.ok(Math.abs(camera[0]-.15*Math.SQRT2)<1e-6);
  assert.equal(camera[1],2);
  const aroundCorner=constrainRoomPosition(polygonRoom,[0,0,2],[2,2,0]);
  assert.ok(aroundCorner[0]<1&&aroundCorner[2]>1,'camera stops at first wall crossing');
  assert.equal(withinRoom(polygonRoom,aroundCorner[0],aroundCorner[2],.15),true);
  assert.deepEqual(constrainRoomPosition(layout,[0,0,0],[10,2,10]),[2.85,2,2.85]);
});
test('floor height follows raised stage and room boundaries reject movement',()=>{assert.equal(groundHeight(layout,2,0),.25);assert.equal(canStand(layout,3,0),false);assert.equal(groundHeight(layout,-2,0),0);});
test('click navigation finds a route around the blocked center',()=>{const path=findPath(layout,[0,0,2],[0,0,-2]);assert.ok(path.length>2);assert.ok(path.every(p=>canStand(layout,p[0],p[2])));assert.ok(Math.hypot(path.at(-1)![0],path.at(-1)![2]+2)<.4);});

test('path segments walk around a thin rotated furniture tip instead of cutting its clearance',()=>{
  const room:RoomLayout={version:1,bounds:{minX:-.44,maxX:.88,minZ:-1.1,maxZ:1.1},spawn:[0,0,0],floors:[],assets:[],colliders:[{min:[-.6,-.73],max:[.13,-.17],footprint:[[.11,-.17],[-.6,-.7],[-.58,-.73],[.13,-.2]]}]};
  const destination:[number,number,number]=[.22,0,0];
  assert.equal(canStand(room,room.spawn[0],room.spawn[2]),true);
  assert.equal(canStand(room,destination[0],destination[2]),true);
  const direct=stepPosition(room,room.spawn,destination);
  assert.ok(Math.abs(direct[0]-destination[0])>.01,'direct segment intersects the furniture clearance');
  const path=findPath(room,room.spawn,destination);
  assert.ok(path.length>0);
  let position=room.spawn;
  for(const point of path){
    position=stepPosition(room,position,point);
    assert.ok(Math.hypot(position[0]-point[0],position[2]-point[2])<1e-6,'each path segment must be walkable');
  }
  assert.ok(Math.hypot(position[0]-destination[0],position[2]-destination[2])<1e-6);
});
test('all exported chairs, pianos and podium have a navigable approach from the entrance',()=>{
  const room=JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
  for(const asset of room.assets){
    assert.equal(canStand(room,asset.approach[0],asset.approach[2]),true,`${asset.id} approach must be a safe release position`);
    const path=findPath(room,room.spawn,asset.approach);
    let position=room.spawn;
    for(const point of path){
      position=stepPosition(room,position,point);
      assert.ok(Math.hypot(position[0]-point[0],position[2]-point[2])<1e-6,`${asset.id} path must walk every segment`);
    }
    const end=path.at(-1);
    assert.ok(end,`${asset.id} must be reachable`);
    assert.ok(Math.hypot(end[0]-asset.approach[0],end[2]-asset.approach[2])<.01,`${asset.id} must reach its own aisle rather than a nearby row`);
  }
});
test('chair side edges block the avatar across every exported row',()=>{
  const room=JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
  for(const chair of room.assets.filter(asset=>asset.type==='chair'))assert.equal(canStand(room,chair.position[0]+.325,chair.position[2]),false,`${chair.id} side edge`);
});
test('navigation preserves a clear narrow aisle between full chair footprints',()=>{
  const aisle:RoomLayout={version:1,bounds:{minX:-2,maxX:2,minZ:-1,maxZ:1},spawn:[-1.5,0,.4],floors:[],colliders:[{min:[-2,-1],max:[2,.17]},{min:[-2,.63],max:[2,1]}],assets:[{id:'seat',label:'Seat',type:'chair',position:[1.5,.5,.1],approach:[1.5,0,.4],radius:1.8,rotation:0}]};
  assert.equal(canStand(aisle,0,.4),true);
  const path=findPath(aisle,aisle.spawn,aisle.assets[0].approach);
  assert.ok(path.length>0,'the valid aisle must not disappear between coarse grid rows');
  assert.ok(path.every(point=>point[2]>.35&&point[2]<.45));
  assert.ok(Math.abs(path.at(-1)![2]-.4)<.001);
});
