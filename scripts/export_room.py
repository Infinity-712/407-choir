"""Run with Blender --background --python export_room.py. Never saves source blend."""
import bpy, math, json, hashlib, time, shutil, struct
from pathlib import Path
from mathutils import Vector
import numpy as np

WEB = Path(__file__).resolve().parents[1]
SOURCE = WEB.parent / 'demo' / 'revision_20260930_v3' / '407_choir_photo_revision_v3.blend'
OUT = WEB / 'artifacts' / 'export-v3'
OUT.mkdir(parents=True, exist_ok=True)
started = time.time()
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
assert scene.get('photo_revision_current')=='20260930_v3'
# Rendering and interaction extraction must agree about authored visibility.
allowed_collections=set()
def visible_collections(layer,parent_visible=True):
    visible=parent_visible and not layer.exclude and not layer.collection.hide_render
    if visible:allowed_collections.add(layer.collection)
    for child in layer.children:visible_collections(child,visible)
visible_collections(bpy.context.view_layer.layer_collection)
def eligible(o):
    current=o
    while current:
        if current.hide_render or current.get('exclude_from_export'):return False
        if not any(c in allowed_collections for c in current.users_collection):return False
        current=current.parent
    return True

PIANOS={
    'Black upright piano':('piano-black','黑色钢琴','Black piano bench'),
    'Brown upright piano':('piano-brown','棕色钢琴','Brown piano bench'),
    'Third black upright piano':('piano-third-black','窗边立式钢琴','Third piano bench'),
    'Black digital console piano':('piano-digital-black','电钢琴','Digital piano bench'),
}
# Movable furniture is separated in the browser copy so both front/back
# keyboard instruments remain usable. The authored source is never saved.
digital=bpy.data.objects['Black digital console piano']
digital.location.x=4.10
black_bench=bpy.data.objects['Black piano bench']
black_bench.location=(5.20,.45,0)
def copy_bench(name,instrument,offset):
    root=black_bench.copy();root.name=name;scene.collection.objects.link(root)
    root.location=instrument.matrix_world@Vector((0,offset,0));root.rotation_euler=instrument.rotation_euler
    def copy_children(old,parent):
        for child in old.children:
            new=child.copy();new.name=name+' '+child.name;scene.collection.objects.link(new);new.parent=parent
            copy_children(child,new)
    copy_children(black_bench,root)
    return root
bpy.context.view_layer.update()
copy_bench('Third piano bench',bpy.data.objects['Third black upright piano'],-.96)
copy_bench('Digital piano bench',digital,-.79)
allowed_collections.add(scene.collection)
bpy.context.view_layer.update()
source_objects = list(scene.objects)
objects=[o for o in source_objects if eligible(o)]
excluded_objects=set(source_objects)-set(objects)
removed_chairs=[o for o in source_objects if o.get('asset_type')=='chair' and not eligible(o)]
assert len(removed_chairs)==12
source_clock=next(o for o in source_objects if o.name=='CLOCK_RearColumn')
assert abs(source_clock.matrix_world.translation.x)<1e-5

def xyz(v): return [round(float(v[0]),5), round(float(v[2]),5), round(float(-v[1]),5)]
def point(o, local=(0,0,0)): return xyz(o.matrix_world @ Vector(local))
def yaw(o, forward=(0,-1,0)):
    v = o.matrix_world.to_3x3() @ Vector(forward)
    return round(math.atan2(v.x,-v.y),6)
def rect(o, pad=0):
    pts=[o.matrix_world @ Vector(v) for v in o.bound_box]
    return {'min':[round(min(p.x for p in pts)-pad,4),round(-max(p.y for p in pts)-pad,4)], 'max':[round(max(p.x for p in pts)+pad,4),round(-min(p.y for p in pts)+pad,4)]}
def visible_parts(o):
    return [c for c in [o]+list(o.children_recursive) if c.type in {'MESH','CURVE','FONT'} and eligible(c)]

def hitbox(o):
    # Visible object bounds are separate from approach/seat anchors and navigation footprints.
    parts=visible_parts(o)
    pts=[xyz(c.matrix_world @ Vector(v)) for c in parts for v in c.bound_box]
    assert pts, f'Interactive asset has no visible meshes: {o.name}'
    return {'min':[round(min(p[i] for p in pts),4) for i in range(3)],
            'max':[round(max(p[i] for p in pts),4) for i in range(3)]}

def hull(points):
    points=sorted(set((round(p[0],5),round(p[1],5)) for p in points))
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    halves=[]
    for seq in [points,list(reversed(points))]:
        half=[]
        for p in seq:
            while len(half)>1 and cross(half[-2],half[-1],p)<=0:half.pop()
            half.append(p)
        halves.append(half[:-1])
    return [list(p) for p in halves[0]+halves[1]]

def collider(o):
    # Convex footprints follow rotated furniture instead of filling its world AABB.
    pts=[xyz(c.matrix_world@Vector(v)) for c in visible_parts(o) for v in c.bound_box]
    if not pts:return None
    return {'id':o.name,'min':[min(p[0] for p in pts),min(p[2] for p in pts)],
            'max':[max(p[0] for p in pts),max(p[2] for p in pts)],
            'minY':min(p[1] for p in pts),'maxY':max(p[1] for p in pts),
            'footprint':hull([(p[0],p[2]) for p in pts])}

footprint=[[round(x,5),round(-y,5)] for x,y in json.loads(scene['photo_footprint_xy'])]
layout={'version':2,'revision':'20260930_v3','bounds':{'minX':min(p[0] for p in footprint),'maxX':max(p[0] for p in footprint),'minZ':min(p[1] for p in footprint),'maxZ':max(p[1] for p in footprint)},'footprint':footprint,'spawn':[-.6,0,-.6],'assets':[],'colliders':[],'floors':[]}
for o in objects:
    typ=o.get('asset_type')
    if typ=='chair':
        anchor=next(c for c in o.children if c.get('asset_type')=='seat_anchor')
        a=point(o,(0,-.6,0)); a[1]=round(o.location.z+.003,4)
        box=hitbox(o)
        layout['assets'].append({'id':o['chair_id'],'label':o['chair_id'].replace('chair_','座位 '),'type':'chair','position':point(anchor),'rotation':yaw(o),'approach':a,'radius':1.8,'hitBoxes':[box]})
        layout['colliders'].append(collider(o))
    elif typ in {'upright_piano','digital_piano'}:
        ident,label,bench_name=PIANOS[o.name]
        bench=bpy.data.objects[bench_name]
        p=point(bench,(0,0,.53))
        approach=point(o,(1.15,-.32,0)) if ident=='piano-third-black' else point(bench,(0,-.55,0))
        approach[1]=.015
        boxes=[hitbox(o)]
        boxes.append(hitbox(bench))
        layout['assets'].append({'id':ident,'label':label,'type':'piano','position':p,'rotation':yaw(o,(0,1,0)),'approach':approach,'radius':2,'keyPrefix':ident+'_key_','hitBoxes':boxes})
    elif typ=='lectern':
        p=point(o,(0,-.7,.015))
        layout['assets'].append({'id':'conductor','label':'指挥台','type':'conductor','position':p,'rotation':yaw(o,(0,1,0)),'approach':point(o,(0,-1.2,.015)),'radius':1.8,'hitBoxes':[hitbox(o)]})
    if o.name.startswith('TERRACE_') and o.type=='MESH':
        r=rect(o);r.update(id=o.name,height=round(o.location.z+o.dimensions.z/2+.014,4));layout['floors'].append(r)
    if typ in {'upright_piano','digital_piano','piano_bench','bench','lectern','audio_desk','audio_rack','storage_cabinet','cabinet','whiteboard','tripod_pa','storage_pedestal','conductor_stool'} or o.name in {'EAST_PianoCentralPier','East piano column side return','WEST_GlazingReturnPier','WEST_Pier side depth','Rear structural pier','RAIL_DiagonalWindowGuard','RAIL_RearTerrace'} or o.name.startswith('RAIL_ContinuousHandrail'):
        c=collider(o)
        if c:layout['colliders'].append(c)

# Choir rows face +Z. Approach each rear-row chair through the center of the
# actual gap ahead, clear of its own feet and the preceding row's backrests.
chairs=[a for a in layout['assets'] if a['type']=='chair']
for asset in chairs:
    box=asset['hitBoxes'][0]
    ahead=[other for other in chairs if other is not asset
           and other['hitBoxes'][0]['min'][2]>box['max'][2]
           and other['hitBoxes'][0]['max'][0]>box['min'][0]
           and other['hitBoxes'][0]['min'][0]<box['max'][0]]
    if ahead:
        front=min(ahead,key=lambda other:other['hitBoxes'][0]['min'][2])
        asset['approach'][2]=round((box['max'][2]+front['hitBoxes'][0]['min'][2])/2,4)

for asset in layout['assets']:
    x,_,z=asset['approach']
    asset['approach'][1]=max([.015]+[f['height'] for f in layout['floors'] if f['min'][0]<=x<=f['max'][0] and f['min'][1]<=z<=f['max'][1]])

# A deterministic UV texture for exported wood grain; no reference-photo projection.
size=256
xx,yy=np.meshgrid(np.arange(size)/size,np.arange(size)/size)
grain=.982+.009*np.sin(yy*math.tau*17+np.sin(xx*math.tau*2)*1.4)+.004*np.sin(yy*math.tau*47+np.sin(xx*math.tau*3)*2)+.003*np.sin((xx+yy)*math.tau*5)
pixels=np.ones((size,size,4),dtype=np.float32);pixels[:,:,:3]=grain[:,:,None]
tex=bpy.data.images.new('407 generated wood grain',width=size,height=size)
tex.pixels.foreach_set(pixels.ravel());tex.filepath_raw=str(OUT/'wood-grain.png');tex.file_format='PNG';tex.save();tex.pack()

def normal_texture(name, height, slope):
    # Tangent-space detail, sampled using the exported model UVs. No scene/photo baking.
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*slope
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*slope
    vectors=np.stack((-dx,-dy,np.ones_like(height)),axis=2)
    vectors/=np.linalg.norm(vectors,axis=2,keepdims=True)
    rgba=np.ones((*height.shape,4),dtype=np.float32)
    rgba[:,:,:3]=vectors*.5+.5
    im=bpy.data.images.new(name,width=height.shape[1],height=height.shape[0])
    im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(rgba.ravel());im.pack()
    return im

wood_normal=normal_texture('407 subtle wood normal',grain,.48)
nu,nv=np.meshgrid(np.arange(512)/512,np.arange(512)/512)
hole_radius=((nu*40+.5)%1-.5)**2+((nv*40+.5)%1-.5)**2
ceiling_normal=normal_texture('407 acoustic perforation normal',-np.exp(-hole_radius/.018),.65)

def add_normal(m,p,im,repeat=1):
    node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
    if repeat!=1:
        uv=m.node_tree.nodes.new('ShaderNodeTexCoord')
        mapping=m.node_tree.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value=(repeat,repeat,1)
        m.node_tree.links.new(uv.outputs['UV'],mapping.inputs['Vector'])
        m.node_tree.links.new(mapping.outputs['Vector'],node.inputs['Vector'])
    normal=m.node_tree.nodes.new('ShaderNodeNormalMap')
    m.node_tree.links.new(node.outputs['Color'],normal.inputs['Color'])
    m.node_tree.links.new(normal.outputs['Normal'],p.inputs['Normal'])

materials={}
def webmat(original):
    name=original.name if original else 'Default'
    if name in materials:return materials[name]
    m=bpy.data.materials.new('Web '+name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    old=original.node_tree.nodes.get('Principled BSDF') if original and original.use_nodes else None
    # Principled values drive the source render; diffuse_color is only a viewport fallback.
    color=list(old.inputs['Base Color'].default_value) if old else list(original.diffuse_color) if original else [.5,.5,.5,1]
    for prop in ['Base Color','Roughness','Metallic','Coat Weight','Coat Roughness',
                 'IOR','Specular IOR Level','Specular Tint','Transmission Weight','Emission Color','Emission Strength']:
        if old and prop in old.inputs:p.inputs[prop].default_value=old.inputs[prop].default_value
    p.inputs['Base Color'].default_value=color
    if old and old.inputs['Base Color'].is_linked:
        ramps=[n for n in original.node_tree.nodes if n.type=='VALTORGB']
        if ramps:
            cs=[e.color for e in ramps[0].color_ramp.elements]
            color=[sum(c[i] for c in cs)/len(cs) for i in range(4)];p.inputs['Base Color'].default_value=color
    if any(k in name.lower() for k in ['wood','maple','walnut','ash','timber','oak','plank']):
        if 'maple' in name.lower():
            variation=(int(name.rsplit(' ',1)[-1])-8)*.004 if name.rsplit(' ',1)[-1].isdigit() else -.025
            srgb=[.63+variation,.49+variation,.35+variation]
            color=[((c+.055)/1.055)**2.4 for c in srgb]+[1]
            if name.lower().startswith('maple plank'):
                # Broaden compact WebGL light highlights while preserving a sealed finish.
                p.inputs['Roughness'].default_value=.32
                p.inputs['Coat Roughness'].default_value=.25
        # glTF can carry the color texture directly; tint pixels per material.
        im=tex.copy();im.name='Grain '+name
        # Blender image pixel API uses scene-linear values; PNG export handles sRGB encoding.
        # Applying gamma here again would turn dark wood unnaturally yellow and bright.
        tinted=pixels.copy();tinted[:,:,:3]*=np.array(color[:3])[None,None,:]
        im.pixels.foreach_set(tinted.ravel());im.pack()
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
        m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
        add_normal(m,p,wood_normal)
        m['materialRole']='finished-wood'
    if name=='Night window glass':
        # Cycles transmits the dark exterior through this almost-white glass. A white
        # opaque glTF fallback loses that appearance. A dark PBR reflection surface
        # retains the night windows on WebGL without an extra transmission render pass.
        p.inputs['Base Color'].default_value=(.035,.046,.060,1)
        p.inputs['Transmission Weight'].default_value=0
        p.inputs['Metallic'].default_value=.45
        p.inputs['Roughness'].default_value=.17
        p.inputs['Coat Weight'].default_value=.25
        p.inputs['Coat Roughness'].default_value=.09
        m['materialRole']='night-window-reflection'
        m['sourceTransmission']=float(old.inputs['Transmission Weight'].default_value)
    elif name=='Perforated acoustic ceiling':
        # Averaging the hole and tile ramp endpoints gave holes 50% coverage. Use
        # the authored warm tile tint, with the perforations represented by normals.
        p.inputs['Base Color'].default_value=original.diffuse_color
        add_normal(m,p,ceiling_normal,4)
        m['materialRole']='acoustic-ceiling'
    elif name.startswith('Acoustic wall'):
        m['materialRole']='acoustic-wall'
    elif name=='Piano black lacquer':
        m['materialRole']='piano-lacquer'
    m['sourceMaterial']=name
    if any(k in name.lower() for k in ['fluorescent','emission','led glow']):
        p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=.65
    materials[name]=m
    return m

# Reduce ornamental bevel/subdivision costs, evaluated only in this disposable process.
for o in objects:
    for mod in o.modifiers:
        if mod.type=='BEVEL':mod.segments=1
        if mod.type=='SUBSURF':mod.levels=min(mod.levels,1)
    if o.type=='CURVE':o.data.resolution_u=min(o.data.resolution_u,4);o.data.bevel_resolution=min(o.data.bevel_resolution,2)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
groups={}; keys=[];triangles=0
for ix,o in enumerate(objects):
    if o.type not in {'MESH','CURVE','FONT','SURFACE'} or o.hide_render:continue
    ev=o.evaluated_get(deps)
    mesh=ev.to_mesh(preserve_all_data_layers=False,depsgraph=deps)
    if not mesh:continue
    mesh.calc_loop_triangles()
    iskey=o.get('asset_type')=='piano_key'
    root=o
    while root.parent:root=root.parent
    inst=PIANOS[root.name][0] if iskey else None
    normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
    for tri in mesh.loop_triangles:
        original=o.material_slots[tri.material_index].material if len(o.material_slots)>tri.material_index else None
        material=webmat(original)
        ident=(inst,int(o['midi_note'])) if iskey else ('static',material.name)
        group=groups.setdefault(ident,{'v':[],'f':[],'uv':[],'n':[],'mat':material,'origin':o.matrix_world.translation.copy() if iskey else Vector((0,0,0))})
        offset=len(group['v']); world=[o.matrix_world @ mesh.vertices[i].co for i in tri.vertices]
        group['v'].extend([tuple(v-group['origin']) for v in world]);group['f'].append((offset,offset+1,offset+2))
        group['n'].extend([tuple((normal_matrix@mesh.corner_normals[i].vector).normalized()) for i in tri.loops])
        # Planar UVs selected per surface normal, preserving wood detail on all faces.
        normal=(world[1]-world[0]).cross(world[2]-world[0]);axis=max(range(3),key=lambda i:abs(normal[i]))
        axes=[i for i in range(3) if i!=axis]
        group['uv'].extend([(v[axes[0]]*.7,v[axes[1]]*.7) for v in world]);triangles+=1
    ev.to_mesh_clear()
    if ix%500==0:print('Evaluated',ix,'triangles',triangles,flush=True)

export_scene=bpy.data.scenes.new('407 browser export');bpy.context.window.scene=export_scene
for ident,g in groups.items():
    name=f'{ident[0]}_key_{ident[1]}' if ident[0]!='static' else 'Room_'+g['mat'].name
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(g['v'],[],g['f']);mesh.materials.append(g['mat'])
    # Retain source smoothing on the curved chair shells and restored awards.
    for polygon in mesh.polygons:polygon.use_smooth=True
    mesh.normals_split_custom_set(g['n'])
    uv=mesh.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',np.array(g['uv'],dtype=np.float32).ravel())
    ob=bpy.data.objects.new(name,mesh);export_scene.collection.objects.link(ob);ob.location=g['origin']
    if ident[0]!='static':ob['midi']=ident[1];ob['instrumentId']=ident[0];keys.append(name)
groups.clear()
bpy.ops.export_scene.gltf(filepath=str(OUT/'room.glb'),export_format='GLB',export_yup=True,export_extras=True,use_active_scene=True,export_animations=False,export_cameras=False,export_lights=False,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=16)
decoder=WEB/'node_modules'/'three'/'examples'/'jsm'/'libs'/'draco'/'gltf'
(OUT/'draco').mkdir(exist_ok=True)
for filename in ['draco_decoder.js','draco_decoder.wasm','draco_wasm_wrapper.js']:
    shutil.copy2(decoder/filename,OUT/'draco'/filename)
assert len([a for a in layout['assets'] if a['type']=='chair'])==56
assert len(keys)==352 and len(layout['floors'])==4
assert len([c for c in layout['colliders'] if c['id'] in [v[2] for v in PIANOS.values()]])==4
assert sum(len(a['hitBoxes']) for a in layout['assets'])==65
assert {a['id'] for a in layout['assets'] if a['type']=='piano'}=={v[0] for v in PIANOS.values()}
assert len({a['id'] for a in layout['assets']})==len(layout['assets'])
assert source_hash==hashlib.sha256(SOURCE.read_bytes()).hexdigest()
(OUT/'interaction-layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf8')
report={'source':str(SOURCE),'sourceRevision':'20260930_v3','sourceSha256':source_hash,'sourceUnchanged':True,'coordinateSystem':'Y-up metres; Blender [x,y,z] -> [x,z,-y]; yaw turns +Z toward +X','triangles':triangles,'meshCount':len(export_scene.objects),'materialCount':len(materials),'glbBytes':(OUT/'room.glb').stat().st_size,'chairs':56,'pianos':4,'conductor':1,'keyNodes':len(keys),'floors':len(layout['floors']),'elapsedSeconds':round(time.time()-started,2),'keyAnimation':'Each key mesh has userData.midi and userData.instrumentId. Animate local position.y downward by 0.008m, restore on noteOff. Geometry is world-oriented; no pivot rotation required.','textures':'Generated procedural wood color/normal UV textures and acoustic ceiling perforation normal; no photos projected.','materials':'Source Principled metalness, IOR, emissions, clearcoat and split normals retained. Maple planks use roughness .32 / coat roughness .25 for WebGL lights; other roughness values match the source. Night window glass uses a dark reflective PBR fallback; browser environment supplies reflections.','limitations':['Room dimensions estimated from photographs.','Cycles lighting is not baked; browser lighting required.','Collision uses simplified convex footprints and terrace surfaces.']}
report['webLayoutChanges']={'reason':'Use v3 authored central aisle and omit archived geometry. Separate movable keyboard furniture to make all instruments accessible.','clockCenter':point(source_clock),'removedChairIds':sorted(o['chair_id'] for o in removed_chairs),'omittedSourceObjects':len(excluded_objects),'omittedGeometryObjects':sum(o.type in {'MESH','CURVE','FONT','SURFACE'} for o in excluded_objects),'spawn':layout['spawn'],'geometryPolicy':'Honor authored hide_render, ancestor export exclusion, and excluded collections consistently for geometry, colliders and interaction roots.','digitalConsoleWebPosition':point(digital),'addedWebBenches':['Third piano bench','Digital piano bench'],'blackBenchWebPosition':point(black_bench)}
binary=(OUT/'room.glb').read_bytes();jsize=struct.unpack_from('<I',binary,12)[0];gltf=json.loads(binary[20:20+jsize])
exported_materials={m['name']:m for m in gltf['materials']}
window=exported_materials['Web Night window glass']['pbrMetallicRoughness']
assert max(window['baseColorFactor'][:3])<.12 and window['metallicFactor']>.4
for name in ['Web Maple plank 0','Web Maple plank 8','Web Maple plank 16']:
    m=exported_materials[name]
    assert .3<=m['pbrMetallicRoughness']['roughnessFactor']<=.35
    assert m['extensions']['KHR_materials_clearcoat']['clearcoatFactor']>.3
    assert 'normalTexture' in m
assert 'normalTexture' in exported_materials['Web Perforated acoustic ceiling']
keyextras=[n['extras'] for n in gltf['nodes'] if 'midi' in n.get('extras',{})]
assert len(keyextras)==352
for instrument in [v[0] for v in PIANOS.values()]:
    assert sorted(k['midi'] for k in keyextras if k['instrumentId']==instrument)==list(range(21,109))
def contains(poly,x,z):
    inside=False
    for i,a in enumerate(poly):
        b=poly[(i+1)%len(poly)]
        if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside
def distance(poly,x,z):
    out=float('inf')
    for i,a in enumerate(poly):
        b=poly[(i+1)%len(poly)];dx=b[0]-a[0];dz=b[1]-a[1]
        t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz or 1)))
        out=min(out,math.hypot(x-a[0]-t*dx,z-a[1]-t*dz))
    return out
blocked=[]
for a in [{'id':'spawn','approach':layout['spawn']}]+layout['assets']:
    x,ground,z=a['approach']
    if not contains(footprint,x,z) or distance(footprint,x,z)<.18-1e-8:blocked.append([a['id'],'room-boundary'])
    for c in layout['colliders']:
        if c['maxY']<=ground+.04 or c['minY']>=ground+1.4:continue
        if contains(c['footprint'],x,z) or distance(c['footprint'],x,z)<.18-1e-8:blocked.append([a['id'],c['id']])
assert not blocked,blocked
report['verification']={'parsedGlbKeys':len(keyextras),'midi21to108PerPiano':True,'approachesClearWithAvatarRadius':.18,'chairFootprintColliders':56,'pianoBenchColliders':4,'interactionHitBoxes':65,'roomFootprintVertices':len(footprint),'materialRegressionChecks':True,'sourceHashUnchanged':True,'compression':'KHR_draco_mesh_compression; local decoder in assets/draco'}
(OUT/'export-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
publish=WEB/'public'/'assets';backup=WEB/'artifacts'/'pre-v3-assets';backup.mkdir(parents=True,exist_ok=True)
for filename in ['room.glb','interaction-layout.json','export-report.json']:
    if (publish/filename).exists() and not (backup/filename).exists():shutil.copy2(publish/filename,backup/filename)
    shutil.copy2(OUT/filename,publish/filename)
shutil.copy2(OUT/'wood-grain.png',publish/'wood-grain.png')
shutil.copytree(OUT/'draco',publish/'draco',dirs_exist_ok=True)
print('EXPORT_COMPLETE',json.dumps(report),flush=True)
