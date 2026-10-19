"""
measure_throne.py -- measures the Lobby throne from the LIVE scene by casting rays.

@kosmos-system  Content (KosmosWorlds) -- Mission Control (DB-044)
@kosmos-owner   Content lane

    blender -b --factory-startup -P measure_throne.py -- <scene.glb>

The Lobby's source .blend is not on disk; the live 1.1.1 scene is optimized (meshes
merged, names gone). So the throne is measured the way a laser would see it: rays cast
straight down on a grid over the dais, and rays cast horizontally at the seat to find
the back. Coordinates are Lobby Blender coordinates (Z up; the throne faces -X).
"""

import sys

import bpy
from mathutils import Vector

glb = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
dg = bpy.context.evaluated_depsgraph_get()
scene = bpy.context.scene


def down(x, y, z0=6.0):
    hit, loc, normal, _i, obj, _m = scene.ray_cast(dg, Vector((x, y, z0)), Vector((0, 0, -1)))
    return (round(loc.z, 3), obj.name if obj else None) if hit else (None, None)


print("TOP-DOWN heights (rows = x, cols = y):")
ys = [round(-1.6 + 0.2 * k, 2) for k in range(17)]
print("x\\y   " + " ".join(f"{y:6.2f}" for y in ys))
for k in range(0, 21):
    x = round(12.8 + 0.2 * k, 2)
    row = [down(x, y)[0] for y in ys]
    print(f"{x:5.2f} " + " ".join(f"{(h if h is not None else -9):6.2f}" for h in row))

print("SIDE: first hit along +X at seat-top + 0.3 m, y = 0")
for z in (1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0):
    hit, loc, normal, _i, obj, _m = scene.ray_cast(dg, Vector((12.0, 0.0, z)), Vector((1, 0, 0)))
    print(f"  z {z:.2f}: x {round(loc.x, 3) if hit else None}  normal {tuple(round(c, 2) for c in normal) if hit else None}")
print("FLOOR in front of the dais:", down(10.0, 0.0), down(12.0, 0.0), down(13.0, 0.0))
