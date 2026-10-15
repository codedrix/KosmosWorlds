"""
build_door.py -- the Lobby's door to Mission Control: an amber portal with "Mission Control" above it.

@kosmos-system  Content (KosmosWorlds) -- Mission Control (DB-043)
@kosmos-owner   Content lane

    blender -b --factory-startup -P build_door.py -- --out <door.glb>

Placement, in Lobby Blender coordinates (from the Omni Demo lane's notes,
E:/Kosmos_Integration/omni-demo/tools/build_orb.py): the throne sits on the gallery
dais (top z 0.90) at x 13.9-15.9, y -1.18..1.17, facing -X toward the arrival end;
the Omni Demo orb floats 2.75 m to the throne's LEFT (+Y). This door mirrors it on
the RIGHT (-Y), at y -2.75, clear of the throne arm (y -1.18) and, by symmetry with
the pier plinth at y >= 4.15, of the right-hand pier. The mirror is an assumption
until the review render shows the space is clear.

Both visible pieces are links to the world. The Lobby already declares its links in
manifest.links[] (the publisher lifted the Omni orb's extras there at 1.1.1), and GLTF_017
wants one form only, so these nodes carry just interactable=True and package_lobby.mjs adds
two manifest.links[] entries. The client shows "Mission Control" on hover and travels on a press.
The world behind it is unlisted and private (a passphrase), so the door is only
useful to its owner; anyone else pressing it lands on a locked wall.

Publish order (Class C, the CEO's): Mission Control first, then this Lobby version,
so the door never links to an address that does not exist.
"""

import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[argv.index("--out") + 1]
FONT = "E:/Epic Games/UE_5.7/Engine/Content/Slate/Fonts/Roboto-Regular.ttf"

LINK = "world://mission-control.micknerks"
LABEL = "Mission Control"
X = 14.95
Y = -2.75
DAIS = 0.90

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, base, emit=None, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    return m


frame_mat = material("MissionControl_Frame", (0.03, 0.04, 0.06), rough=0.7)
glow_mat = material("MissionControl_Portal", (0.9, 0.48, 0.06), emit=(1.0, 0.55, 0.08), rough=0.4)
label_mat = material("MissionControl_Label", (0.02, 0.02, 0.02), emit=(0.97, 0.96, 0.93))


def box(name, center, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    return o


# The frame and the glowing leaf are ONE node: a separate decorative piece would steal the press.
parts = [
    box("mc_post_l", (X, Y + 0.52, DAIS + 1.05), (0.12, 0.08, 2.1), frame_mat),
    box("mc_post_r", (X, Y - 0.52, DAIS + 1.05), (0.12, 0.08, 2.1), frame_mat),
    box("mc_lintel", (X, Y, DAIS + 2.14), (0.12, 1.12, 0.08), frame_mat),
    box("mc_leaf", (X + 0.01, Y, DAIS + 1.03), (0.03, 0.96, 2.02), glow_mat),
]
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
portal = bpy.context.object
portal.name = "mission_control_portal"
portal.data.name = "mission_control_portal"
portal["interactable"] = True  # the link itself goes in manifest.links[] (see below)

cd = bpy.data.curves.new("mission_control_label_curve", "FONT")
cd.body = "Mission Control"  # title case, like the Omni Demo label beside the throne
cd.font = bpy.data.fonts.load(FONT)
cd.size = 0.34
cd.align_x = "CENTER"
cd.align_y = "CENTER"
cd.extrude = 0.006
txt = bpy.data.objects.new("mission_control_label_text", cd)
bpy.context.scene.collection.objects.link(txt)
txt.location = (X - 0.02, Y, DAIS + 2.45)
txt.rotation_euler = (math.radians(90), 0, math.radians(-90))  # faces -X (the room), reads left to right
bpy.ops.object.select_all(action="DESELECT")
txt.select_set(True)
bpy.context.view_layer.objects.active = txt
bpy.ops.object.convert(target="MESH")
lab = bpy.context.object
lab.name = "mission_control_label"
lab.data.name = "mission_control_label"
lab.data.materials.clear()
lab.data.materials.append(label_mat)
lab["interactable"] = True

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_extras=True,
                          export_yup=True, export_apply=True, export_materials="EXPORT")
for o in (portal, lab):
    print("DOOR", o.name, "tris", sum(len(p.vertices) - 2 for p in o.data.polygons))
