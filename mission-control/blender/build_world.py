"""
build_world.py -- builds world://mission-control.micknerks and renders its lit review.

@kosmos-system  Content (KosmosWorlds) -- Mission Control (DB-044)
@kosmos-owner   Content lane

Run headless (no window, no editor):

    "E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_world.py
    ... -- --no-render        export world.glb only

Writes:
    world.glb            the scene, every scripted node carrying an extra
    review/*.jpg         lit renders: the lock screen, the wall, the chat, a close read, the room

THE NODE CONTRACT. Every name the script finds is in ../nodes.json, which the
bridge generates from its face layout (agent-bridge/scripts/write-nodes-json.mjs).
This script builds exactly those nodes and asserts it built them all.

DEVICE RULES this file follows (memory notes, 2026-08 to 2026-10):
  1. No node name ends in a digit (the client strips a trailing `_<digit>`).
  2. `k_node_find` sees only nodes WITH A MESH: every text anchor is a 1 cm stud.
  3. The publisher's merge stage bakes childless, extras-less meshes away, so
     every scripted node carries an extra (`interactable` on buttons,
     `script_node` on the rest).
  4. A button is ONE mesh with its words merged in: `k_node_set_visible` turns
     collision off only on the node itself, so a separate label child would keep
     blocking the laser after its button hid.
  5. World text is white, 8 cm Roboto, centred on its anchor and bottom-aligned,
     depth-tested. Every anchor is a 3 cm x 3 cm x 2 mm PLAQUE parallel to its
     panel: the client prints text on a thin plane's face, a hair in front, and
     never turns it (KWorldTextPool.cpp, Build 1009: "A plane: the thinnest local
     extent at most a fifth of the next one", next one > 1 cm). Text that turns
     toward the eye instead swings a long line's far end into the panel (the
     net-check 1.0.0 defect, and this world's own first review). Plaques sit 3-4
     cm in front of the surface behind them.
  6. Node rotations are baked to identity, and each progress bar's origin is its
     left end, so `k_transform_set_scale(bar, 1, f, 1)` grows it to the right.

THE REVIEW applies review/<lock|wall|chat>.snapshot (captured from the real
bridge by agent-bridge/scripts/capture-review-snapshots.mjs) exactly as
src/lib.rs applies a snapshot: visibility, gauges, copies, offsets, and the
world text drawn as white Roboto at 8 cm facing the camera. The light is a
stand-in for the client's pawn rig plus `sky: "night"`; it reviews composition
and legibility, not photometry. Pixels on the headset are the real check.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REVIEW = os.path.join(PKG, "review")
NODES = json.load(open(os.path.join(PKG, "nodes.json"), encoding="utf-8"))
FONT_DIR = "E:/Epic Games/UE_5.7/Engine/Content/Slate/Fonts"
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

EYE = 1.6
TEXT_SIZE = 0.08          # KWorldTextPool.cpp WorldTextSizeCm
LOBBY_URL = "world://lobby.micknerks"

# Panel frames: (azimuth degrees, radius to the panel surface). +azimuth is the
# visitor's left (Blender +Y); the spawn faces +X (UE forward at yaw 0).
CENTER = (0.0, 2.9)
LEFT = (56.0, 2.75)
RIGHT = (-56.0, 2.75)

# Conversation anchors: centre line and spacing (mirrored in the face:
# CONV_LEFT_M = -1.2 relative to this centre line, W.conv = 2.4).
CONV_Y = -0.35
CONV_TOP_Z = 2.42
CONV_STEP = 0.098

built = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0


MATS = {}


def mat(name, rgb, rough=0.6, metal=0.0, emit=None, emit_strength=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        # Strength stays at 1: r.MobileHDR=False clamps anything brighter to flat white.
        b.inputs["Emission Strength"].default_value = emit_strength
    MATS[name] = m
    return m


def frame_matrix(fr):
    az, r = fr
    a = math.radians(az)
    return Matrix.Translation((r * math.cos(a), r * math.sin(a), 0.0)) @ Matrix.Rotation(a, 4, "Z")


def to_world(fr, local):
    return frame_matrix(fr) @ Vector(local)


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake(obj):
    """Bake rotation and scale into the mesh so the node itself is identity-rotated."""
    select_only([obj])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def set_origin(obj, world_point):
    select_only([obj])
    cur = bpy.context.scene.cursor.location.copy()
    bpy.context.scene.cursor.location = Vector(world_point)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = cur


def box(name, fr, center, size, material, bevel=0.0):
    """A box in a panel frame. size = (depth toward the wall, width, height)."""
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.matrix_world = frame_matrix(fr) @ Matrix.Translation(center) @ Matrix.Diagonal((*size, 1.0))
    o.data.materials.append(material)
    if bevel > 0:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        select_only([o])
        bpy.ops.object.modifier_apply(modifier="Bevel")
    bake(o)
    return o


_fonts = {}


def font(weight="Medium"):
    if weight not in _fonts:
        _fonts[weight] = bpy.data.fonts.load(os.path.join(FONT_DIR, f"Roboto-{weight}.ttf"))
    return _fonts[weight]


def mesh_text(name, fr, center, text, size, material, weight="Medium", align="CENTER"):
    """Words as geometry, facing the visitor, laid on a panel in frame `fr`."""
    cu = bpy.data.curves.new(name + "Curve", type="FONT")
    cu.body = text
    cu.font = font(weight)
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.extrude = 0.0  # flat words: half the triangles, and they sit 4 mm proud of the face anyway
    cu.resolution_u = 3
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    # Text lies in XY reading along +X; stand it up facing -X (toward the
    # visitor) reading along -Y (the visitor's right), then into the frame.
    face = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    o.matrix_world = frame_matrix(fr) @ Matrix.Translation(center) @ face
    o.data.materials.append(material)
    select_only([o])
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    bake(o)
    return o


def join(name, parts, origin_world):
    select_only(parts)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name + "Mesh"
    set_origin(o, origin_world)
    return o


def node(name, obj, kind):
    """Register a scripted node: give it the extra the publisher keeps it by."""
    assert name not in built, name
    obj.name = name
    if kind == "button":
        obj["interactable"] = True
    else:
        obj["script_node"] = True
    built[name] = obj
    return obj


ANCHOR_FRAME = {}


def anchor(name, fr, local):
    """A world-text anchor: a 3 cm plaque, 2 mm thin, parallel to its panel (see rule 5).

    Unlike every other node, its rotation is NOT baked: the client judges "thin"
    from the mesh's own local bounds, so on an angled side panel a baked plaque
    would read as a fat diagonal box and its text would turn instead of lying flat.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.scale = (0.002, 0.03, 0.03)
    select_only([o])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.matrix_world = frame_matrix(fr) @ Matrix.Translation(local)
    o.data.materials.append(MATS["stud"])
    ANCHOR_FRAME[name] = fr
    return node(name, o, "text")


def button(name, fr, center, w, h, words, face_mat, label_mat=None, text_size=0.075, depth=0.04):
    body = box("_" + name + "Body", fr, center, (depth, w, h), face_mat, bevel=0.012)
    parts = [body]
    if words:
        parts.append(mesh_text("_" + name + "Label", fr, (center[0] - depth / 2 - 0.004, center[1], center[2]), words, text_size, label_mat or MATS["label"]))
    return node(name, join(name, parts, to_world(fr, center)), "button")


# ---------------------------------------------------------------------------
# The room
# ---------------------------------------------------------------------------

def materials():
    mat("stud", (0.02, 0.03, 0.05))
    mat("floor", (0.010, 0.013, 0.022), rough=0.7, metal=0.1)
    mat("wall", (0.008, 0.011, 0.020), rough=0.8)
    # Matte on purpose: a glossy panel mirrors the white world text in front of it.
    mat("frame", (0.025, 0.032, 0.050), rough=0.8, metal=0.1)
    mat("inset", (0.014, 0.020, 0.036), rough=0.9)
    mat("card", (0.030, 0.042, 0.068), rough=0.85)
    mat("button", (0.040, 0.058, 0.095), rough=0.8)
    mat("label", (0.85, 0.88, 0.92), emit=(0.85, 0.88, 0.92))
    mat("title", (0.55, 0.62, 0.72), emit=(0.55, 0.62, 0.72))
    mat("cyan", (0.05, 0.40, 0.65), emit=(0.10, 0.55, 0.85))
    mat("amber", (0.90, 0.48, 0.06), emit=(1.00, 0.55, 0.08))
    mat("green", (0.10, 0.60, 0.28), emit=(0.15, 0.75, 0.35))
    mat("red", (0.60, 0.10, 0.08), emit=(0.70, 0.12, 0.10))
    mat("amberFill", (0.07, 0.035, 0.008), rough=0.85)
    mat("redFace", (0.20, 0.04, 0.035), rough=0.8)
    mat("greenFace", (0.03, 0.14, 0.07), rough=0.8)
    mat("amberFace", (0.22, 0.11, 0.02), rough=0.8)
    mat("barBg", (0.02, 0.025, 0.04), rough=0.85)
    mat("portal", (0.08, 0.30, 0.45), emit=(0.10, 0.45, 0.70))


def build_room():
    # Floor: a disc, with a faint ring where the visitor stands.
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=3.5, depth=0.1, location=(0, 0, -0.05))
    floor = bpy.context.active_object
    floor.name = "Floor"
    floor.data.materials.append(MATS["floor"])
    bpy.ops.mesh.primitive_torus_add(major_radius=1.15, minor_radius=0.012, major_segments=64, minor_segments=6, location=(0, 0, 0.004))
    ring = bpy.context.active_object
    ring.name = "StandRing"
    ring.scale = (1, 1, 0.3)
    ring.data.materials.append(MATS["cyan"])
    bake(ring)

    # The curved wall behind the panels: 200 degrees of a 3.4 m cylinder.
    segs = 40
    verts, faces = [], []
    a0, a1 = math.radians(-100), math.radians(100)
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        for z in (0.0, 3.7):
            verts.append((3.4 * math.cos(a), 3.4 * math.sin(a), z))
    for i in range(segs):
        b = i * 2
        faces.append((b, b + 2, b + 3, b + 1))
    me = bpy.data.meshes.new("BackWallMesh")
    me.from_pydata(verts, [], faces)
    wall = bpy.data.objects.new("BackWall", me)
    bpy.context.collection.objects.link(wall)
    wall.data.materials.append(MATS["wall"])
    sol = wall.modifiers.new("Thick", "SOLIDIFY")
    sol.thickness = 0.1
    select_only([wall])
    bpy.ops.object.modifier_apply(modifier="Thick")
    # Two thin light lines along the wall: arcs on the wall only, never across the open sky.
    for z, nm in ((3.45, "WallLineHigh"), (0.25, "WallLineLow")):
        lv, lf = [], []
        for i in range(segs + 1):
            a = a0 + (a1 - a0) * i / segs
            for dz in (-0.012, 0.012):
                lv.append((3.33 * math.cos(a), 3.33 * math.sin(a), z + dz))
        for i in range(segs):
            b = i * 2
            lf.append((b, b + 1, b + 3, b + 2))
        lm = bpy.data.meshes.new(nm + "Mesh")
        lm.from_pydata(lv, [], lf)
        line = bpy.data.objects.new(nm, lm)
        bpy.context.collection.objects.link(line)
        line.data.materials.append(MATS["cyan"])

    # A low parapet behind the visitor closes the room, open to the night sky above. It is an
    # open ARC, never a closed ring: the publisher reads a closed shell as one solid collision
    # box over the floor (GLTF_007), which would trap the visitor.
    pv, pf = [], []
    p0, p1 = math.radians(100), math.radians(260)
    psegs = 32
    for i in range(psegs + 1):
        a = p0 + (p1 - p0) * i / psegs
        for z in (0.0, 0.9):
            pv.append((3.4 * math.cos(a), 3.4 * math.sin(a), z))
    for i in range(psegs):
        b = i * 2
        pf.append((b, b + 2, b + 3, b + 1))
    pm = bpy.data.meshes.new("ParapetMesh")
    pm.from_pydata(pv, [], pf)
    par = bpy.data.objects.new("Parapet", pm)
    bpy.context.collection.objects.link(par)
    par.data.materials.append(MATS["wall"])
    sol = par.modifiers.new("Thick", "SOLIDIFY")
    sol.thickness = 0.12
    select_only([par])
    bpy.ops.object.modifier_apply(modifier="Thick")

    # The door home: a declarative link (no program, no capability), behind the visitor.
    back = (180.0, 3.0)
    arch_parts = [
        box("_ArchL", back, (0, 0.62, 1.15), (0.12, 0.12, 2.3), MATS["frame"]),
        box("_ArchR", back, (0, -0.62, 1.15), (0.12, 0.12, 2.3), MATS["frame"]),
        box("_ArchTop", back, (0, 0, 2.35), (0.12, 1.36, 0.12), MATS["frame"]),
        mesh_text("_ArchWord", back, (-0.07, 0, 2.62), "LOBBY", 0.16, MATS["label"]),
    ]
    join("DoorArch", arch_parts, to_world(back, (0, 0, 0)))
    door = box("DoorLobby", back, (0.02, 0, 1.1), (0.04, 1.1, 2.2), MATS["portal"])
    set_origin(door, to_world(back, (0, 0, 1.1)))
    door["link"] = LOBBY_URL
    door["link_label"] = "Lobby"

    bpy.ops.mesh.primitive_cube_add(size=0.01, location=(0, 0, -0.02))
    sp = bpy.context.active_object
    sp.name = "spawn_point"
    sp["spawn_point"] = True
    sp.data.materials.append(MATS["stud"])


# ---------------------------------------------------------------------------
# The wall
# ---------------------------------------------------------------------------

def build_center():
    c = CENTER
    # Always there: the frame, the ticker band, the status strip.
    parts = [
        box("_CFrameBack", c, (0.06, 0, 1.7), (0.08, 3.8, 2.5), MATS["frame"], bevel=0.02),
        box("_CTicker", c, (-0.02, 0, 3.07), (0.06, 3.7, 0.26), MATS["inset"], bevel=0.01),
        box("_CTickerLine", c, (-0.055, 0, 2.935), (0.01, 3.7, 0.012), MATS["cyan"]),
        box("_CStatus", c, (-0.02, 0, 0.44), (0.05, 3.4, 0.16), MATS["inset"], bevel=0.01),
    ]
    join("CenterFrame", parts, to_world(c, (0, 0, 0)))

    # Lock screen.
    lock = [
        box("_LockInset", c, (-0.005, 0, 1.7), (0.02, 3.6, 2.3), MATS["inset"]),
        mesh_text("_LockTitle", c, (-0.03, 0, 2.3), "MISSION CONTROL", 0.26, MATS["label"], weight="Bold"),
        mesh_text("_LockSub", c, (-0.03, 0, 2.0), "Your Claude Code jobs, from inside Kosmos", 0.075, MATS["title"]),
        box("_LockRule", c, (-0.03, 0, 2.12), (0.01, 1.6, 0.008), MATS["amber"]),
    ]
    node("LockPanel", join("LockPanel", lock, to_world(c, (0, 0, 1.7))), "show")
    button("BtnSignIn", c, (-0.05, 0, 1.18), 0.9, 0.26, "SIGN IN", MATS["amberFace"], text_size=0.1)

    # Wall mode: the inset with its two headings.
    wall = [
        box("_WallInset", c, (-0.005, 0, 1.7), (0.02, 3.6, 2.3), MATS["inset"]),
        mesh_text("_WallHead", c, (-0.03, 1.35, 2.72), "WORKING NOW", 0.07, MATS["title"], weight="Bold"),
    ]
    node("WallPanel", join("WallPanel", wall, to_world(c, (0, 0, 1.7))), "show")

    for slot, (y, z) in zip("ABCD", ((0.85, 2.2), (-0.85, 2.2), (0.85, 1.42), (-0.85, 1.42))):
        card = box("_Card" + slot, c, (-0.04, y, z), (0.05, 1.62, 0.70), MATS["card"], bevel=0.02)
        edge = box("_CardEdge" + slot, c, (-0.068, y + 0.79, z), (0.01, 0.018, 0.6), MATS["cyan"])
        node("Card" + slot, join("Card" + slot, [card, edge], to_world(c, (-0.04, y, z))), "button")
        g = [
            box("_GT" + slot, c, (-0.075, y, z + 0.37), (0.01, 1.68, 0.022), MATS["amber"]),
            box("_GB" + slot, c, (-0.075, y, z - 0.37), (0.01, 1.68, 0.022), MATS["amber"]),
            box("_GL" + slot, c, (-0.075, y + 0.83, z), (0.01, 0.022, 0.76), MATS["amber"]),
            box("_GR" + slot, c, (-0.075, y - 0.83, z), (0.01, 0.022, 0.76), MATS["amber"]),
        ]
        node("Glow" + slot, join("Glow" + slot, g, to_world(c, (-0.075, y, z))), "show")
        for pill, m in (("PillRun", "cyan"), ("PillWait", "amber"), ("PillIdle", "green")):
            p = box("_" + pill + slot, c, (-0.075, y - 0.64, z + 0.25), (0.02, 0.2, 0.06), MATS[m], bevel=0.025)
            node(pill + slot, p, "show")
            set_origin(p, to_world(c, (-0.075, y - 0.64, z + 0.25)))
        bg = box("_BarBg" + slot, c, (-0.072, y, z - 0.30), (0.01, 1.44, 0.026), MATS["barBg"])
        node("BarBg" + slot, bg, "show")
        set_origin(bg, to_world(c, (-0.072, y, z - 0.30)))
        bar = box("_Bar" + slot, c, (-0.078, y, z - 0.30), (0.01, 1.44, 0.026), MATS["cyan"])
        node("Bar" + slot, bar, "show")
        set_origin(bar, to_world(c, (-0.078, y + 0.72, z - 0.30)))  # the left end
        anchor("TxCard" + slot, c, (-0.10, y + 0.05, z - 0.24))

    shelf = [
        box("_Shelf", c, (-0.04, 0, 0.74), (0.05, 3.5, 0.32), MATS["card"], bevel=0.015),
        mesh_text("_ShelfHead", c, (-0.07, 1.42, 0.835), "DONE TODAY", 0.055, MATS["title"], weight="Bold"),
    ]
    node("DoneShelf", join("DoneShelf", shelf, to_world(c, (-0.04, 0, 0.74))), "show")
    chip = box("_Chip", c, (-0.075, 0.95, 0.835), (0.02, 0.06, 0.06), MATS["green"], bevel=0.01)
    node("ChipDone", chip, "show")
    set_origin(chip, to_world(c, (-0.075, 0.95, 0.835)))
    anchor("TxDone", c, (-0.10, 0, 0.6))

    # Chat mode.
    chat = [
        box("_ChatInset", c, (-0.005, 0, 1.7), (0.02, 3.6, 2.3), MATS["inset"]),
        box("_ChatDivider", c, (-0.02, 1.12, 1.62), (0.01, 0.008, 1.9), MATS["frame"]),
        box("_ChatHeadLine", c, (-0.02, -0.35, 2.53), (0.01, 2.6, 0.006), MATS["cyan"]),
    ]
    node("ChatPanel", join("ChatPanel", chat, to_world(c, (0, 0, 1.7))), "show")
    for slot, z in zip("ABCD", (2.30, 1.92, 1.54, 1.16)):
        button("Rail" + slot, c, (-0.04, 1.47, z), 0.6, 0.32, "", MATS["button"])
        sel = box("_RailSel" + slot, c, (-0.065, 1.785, z), (0.01, 0.03, 0.28), MATS["cyan"])
        node("RailSel" + slot, sel, "show")
        set_origin(sel, to_world(c, (-0.065, 1.785, z)))
        anchor("TxRail" + slot, c, (-0.095, 1.47, z - 0.09))
    button("BtnBack", c, (-0.04, 1.47, 2.67), 0.6, 0.2, "< BACK TO WALL", MATS["button"], text_size=0.055)
    button("BtnStop", c, (-0.04, -1.55, 2.67), 0.42, 0.2, "STOP", MATS["redFace"], text_size=0.07)
    anchor("TxHeader", c, (-0.05, -0.35, 2.6))
    for i, slot in enumerate("ABCDEFGHIJKL"):
        anchor("TxConv" + slot, c, (-0.05, CONV_Y, CONV_TOP_Z - i * CONV_STEP))
    button("BtnPageUp", c, (-0.04, -1.68, 2.22), 0.2, 0.2, "^", MATS["button"], text_size=0.09)
    button("BtnPageDown", c, (-0.04, -1.68, 1.47), 0.2, 0.2, "v", MATS["button"], text_size=0.09)
    anchor("TxPage", c, (-0.05, -1.68, 1.8))

    ask = [
        box("_AskFill", c, (-0.03, -0.4, 1.035), (0.03, 2.7, 0.47), MATS["amberFill"], bevel=0.01),
        box("_AskTop", c, (-0.05, -0.4, 1.27), (0.01, 2.7, 0.014), MATS["amber"]),
        box("_AskBot", c, (-0.05, -0.4, 0.80), (0.01, 2.7, 0.014), MATS["amber"]),
    ]
    node("AskPanel", join("AskPanel", ask, to_world(c, (-0.03, -0.4, 1.035))), "show")
    anchor("TxAskA", c, (-0.08, -0.4, 1.06))
    anchor("TxAskB", c, (-0.08, -0.4, 0.84))

    row_z = 0.66
    button("BtnApprove", c, (-0.04, 0.45, row_z), 0.8, 0.17, "APPROVE", MATS["greenFace"], text_size=0.07)
    button("BtnDeny", c, (-0.04, -0.45, row_z), 0.8, 0.17, "DENY", MATS["redFace"], text_size=0.07)
    button("BtnWhy", c, (-0.04, -1.3, row_z), 0.6, 0.17, "ASK WHY", MATS["button"], text_size=0.065)
    button("BtnKeep", c, (-0.04, 0.6, row_z), 0.62, 0.17, "Keep going", MATS["button"], text_size=0.06)
    button("BtnSimple", c, (-0.04, -0.08, row_z), 0.68, 0.17, "Explain simply", MATS["button"], text_size=0.058)
    button("BtnSummary", c, (-0.04, -0.82, row_z), 0.74, 0.17, "Stop + summarize", MATS["button"], text_size=0.056)
    button("BtnReply", c, (-0.04, -1.47, row_z), 0.5, 0.17, "Reply...", MATS["amberFace"], text_size=0.06)

    anchor("TxTicker", c, (-0.085, 0, 2.99))
    anchor("TxStatus", c, (-0.08, 0, 0.38))
    anchor("TxLock", c, (-0.05, 0, 1.5))


def build_left():
    f = LEFT
    parts = [
        box("_LFrame", f, (0.04, 0, 1.7), (0.08, 1.45, 2.4), MATS["frame"], bevel=0.02),
        box("_LInset", f, (-0.005, 0, 1.7), (0.02, 1.33, 2.28), MATS["inset"]),
        mesh_text("_LHead", f, (-0.03, 0, 2.66), "START A JOB", 0.08, MATS["title"], weight="Bold"),
        box("_LLine", f, (-0.03, 0, 2.58), (0.01, 1.2, 0.006), MATS["cyan"]),
    ]
    join("LeftFrame", parts, to_world(f, (0, 0, 0)))
    anchor("TxProject", f, (-0.05, 0, 2.38))
    button("BtnProject", f, (-0.04, 0, 2.22), 1.2, 0.15, "CHANGE PROJECT", MATS["button"], text_size=0.05)
    for i, (name, words) in enumerate((("BtnTests", "Run all tests"), ("BtnPrs", "Review open PRs"), ("BtnToday", "Summarize today"), ("BtnNotes", "Draft release notes"))):
        button(name, f, (-0.04, 0, 1.94 - i * 0.27), 1.2, 0.22, words, MATS["button"], text_size=0.068)
    button("BtnNewTask", f, (-0.04, 0, 0.86), 1.2, 0.22, "+  New task", MATS["amberFace"], text_size=0.072)
    button("BtnSignOut", f, (-0.04, 0, 0.62), 0.5, 0.11, "Sign out", MATS["button"], text_size=0.045)


def build_right():
    f = RIGHT
    parts = [
        box("_RFrame", f, (0.04, 0, 1.7), (0.08, 1.45, 2.4), MATS["frame"], bevel=0.02),
        box("_RInset", f, (-0.005, 0, 1.7), (0.02, 1.33, 2.28), MATS["inset"]),
        mesh_text("_RHead", f, (-0.03, 0, 2.66), "NEEDS YOU", 0.08, MATS["amber"], weight="Bold"),
        box("_RLine", f, (-0.03, 0, 2.58), (0.01, 1.2, 0.006), MATS["amber"]),
    ]
    join("RightFrame", parts, to_world(f, (0, 0, 0)))
    for slot, z in zip("ABC", (2.2, 1.6, 1.0)):
        body = box("_Need" + slot, f, (-0.04, 0, z), (0.05, 1.25, 0.54), MATS["amberFill"], bevel=0.015)
        edge = box("_NeedEdge" + slot, f, (-0.068, 0.6, z), (0.01, 0.02, 0.48), MATS["amber"])
        node("Need" + slot, join("Need" + slot, [body, edge], to_world(f, (-0.04, 0, z))), "button")
        anchor("TxNeed" + slot, f, (-0.10, 0, z - 0.21))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def check_contract():
    want = set(NODES["text"]) | set(NODES["buttons"]) | set(NODES["show"])
    have = set(built)
    missing, extra = sorted(want - have), sorted(have - want)
    assert not missing and not extra, f"nodes.json mismatch: missing {missing}, extra {extra}"
    for n in have:
        assert not n[-1].isdigit(), n
    print(f"[mission-control] built all {len(have)} scripted nodes")


def export_glb():
    path = os.path.join(PKG, "world.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_extras=True,
        export_apply=True,
        use_selection=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_materials="EXPORT",
    )
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"[mission-control] exported {path} ({os.path.getsize(path)} bytes, ~{tris} triangles)")


# ---------------------------------------------------------------------------
# The review: apply a snapshot as src/lib.rs does, then render
# ---------------------------------------------------------------------------

def parse_snapshot(path):
    recs = []
    for line in open(path, encoding="utf-8").read().split("\n"):
        if not line or line == "AB1":
            continue
        parts = line.split(" ", 2)
        recs.append(parts)
    return recs


def unescape(s):
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append("\n" if s[i + 1] == "n" else s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


REVIEW_OBJS = []


def clear_review():
    for o in REVIEW_OBJS:
        bpy.data.objects.remove(o, do_unlink=True)
    REVIEW_OBJS.clear()


def world_text(anchor_obj, text, cam_loc, dx_m=0.0):
    """White Roboto at 8 cm, centred, bottom-aligned, printed on the anchor plaque's face (KWorldTextPool rule 1)."""
    cu = bpy.data.curves.new("WT", type="FONT")
    cu.body = text
    cu.font = font("Regular")
    cu.size = TEXT_SIZE
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM"
    o = bpy.data.objects.new("WT_" + anchor_obj.name, cu)
    bpy.context.collection.objects.link(o)
    # The world shifts conversation anchors along wasm +z, which is Blender -Y.
    fr = ANCHOR_FRAME[anchor_obj.name]
    face = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    rot = frame_matrix(fr).to_3x3()
    normal = rot @ Vector((-1, 0, 0))
    # A hair in front of the plaque: its half-thickness plus 0.5 cm.
    loc = anchor_obj.matrix_world.translation + Vector((0, -dx_m, 0)) + normal * 0.006
    o.matrix_world = Matrix.Translation(loc) @ frame_matrix((fr[0], 0.0)) @ face
    o.data.materials.append(MATS["worldText"])
    REVIEW_OBJS.append(o)


def apply_snapshot(name, cam_loc):
    clear_review()
    # The world starts by hiding everything but the lock panel; the snapshot then sets every node.
    for n, o in built.items():
        o.hide_render = n not in ("LockPanel",)
        if n.startswith("Bar"):
            o.scale = (1, 1, 1)
    for n in NODES["text"]:
        built[n].hide_render = True  # studs are 1 cm; hide them for clean review frames
    texts, offsets, copies = {}, {}, {}
    for r in parse_snapshot(os.path.join(REVIEW, name + ".snapshot")):
        k = r[0]
        if k == "T":
            texts[r[1]] = unescape(r[2] if len(r) > 2 else "")
        elif k == "X":
            texts.pop(r[1], None)
        elif k == "U":
            built[r[1]].hide_render = r[2] != "1"
        elif k == "G":
            # Raw UE relative scale (1, f, 1): UE Y is Blender's Y axis line.
            built[r[1]].scale = (1, max(0.02, int(r[2]) / 1000.0), 1)
        elif k == "O":
            offsets[r[1]] = int(r[2]) / 1000.0
        elif k == "C":
            copies[r[1]] = int(r[2])
    for n, t in texts.items():
        world_text(built[n], t, cam_loc, offsets.get(n, 0.0))
    for n, count in copies.items():
        src = built[n]
        for i in range(1, count):
            dup = src.copy()
            dup.data = src.data
            dup.location = src.location + Vector((0, -0.085 * i, 0))
            dup.hide_render = src.hide_render
            bpy.context.collection.objects.link(dup)
            REVIEW_OBJS.append(dup)
    print(f"[mission-control] applied {name}: {len(texts)} labels")


def setup_render():
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        s.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001 - fall back to CPU
        print("[mission-control] GPU unavailable, CPU render:", e)
    s.cycles.samples = 96
    s.cycles.use_denoising = True
    s.render.resolution_x = 1920
    s.render.resolution_y = 1080
    s.render.image_settings.file_format = "JPEG"  # a tenth of the PNG size in the repo
    s.render.image_settings.quality = 90
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    mat("worldText", (1, 1, 1), emit=(1, 1, 1))
    # Review only, after export: Cycles mirrors the white text in the panels in a way the
    # headset's mobile renderer does not. (Exporting this would add KHR_materials_specular,
    # which the publisher strips anyway: GLTF_019.)
    for m in MATS.values():
        b = m.node_tree.nodes["Principled BSDF"]
        if b.inputs["Emission Strength"].default_value == 0.0 or tuple(b.inputs["Emission Color"].default_value)[:3] == (0.0, 0.0, 0.0):
            b.inputs["Specular IOR Level"].default_value = 0.08

    w = bpy.data.worlds.new("NightSky")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    bg.inputs[1].default_value = 0.35
    # A star field: thresholded noise over a deep blue gradient (the client's `sky: "night"` stand-in).
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.72
    ramp.color_ramp.elements[0].color = (0.004, 0.007, 0.02, 1)
    ramp.color_ramp.elements[1].position = 0.76
    ramp.color_ramp.elements[1].color = (0.8, 0.85, 1.0, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    s.world = w

    # The client's pawn carries its own sun, sky and fill (memory: reference_pawn_light_tuning).
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 6))
    sun = bpy.context.active_object
    sun.data.energy = 1.2
    sun.rotation_euler = (math.radians(55), 0, math.radians(200))
    bpy.ops.object.light_add(type="AREA", location=(0.5, 0, 3.4))
    fill = bpy.context.active_object
    fill.data.energy = 60
    fill.data.size = 3.5


def camera(name, loc, look_at, fov_deg):
    cam_data = bpy.data.cameras.new(name)
    cam_data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(loc)
    direction = Vector(look_at) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def render(cam, out_name):
    s = bpy.context.scene
    s.camera = cam
    s.render.filepath = os.path.join(REVIEW, out_name)
    bpy.ops.render.render(write_still=True)
    print(f"[mission-control] rendered review/{out_name}")


def review():
    os.makedirs(REVIEW, exist_ok=True)
    setup_render()
    eye = Vector((0, 0, EYE))
    spawn = camera("CamSpawn", eye, (2.9, 0, 1.55), 96)
    close = camera("CamClose", (1.15, -0.05, 1.62), (2.9, -0.15, 1.7), 62)
    room = camera("CamRoom", (-3.9, 2.4, 3.6), (1.8, 0, 1.3), 70)
    door = camera("CamDoor", (1.6, 0.4, 1.6), (-3.0, 0, 1.3), 70)
    look_left = camera("CamLeft", eye, tuple(to_world(LEFT, (0, 0, 1.6))), 80)
    look_right = camera("CamRight", eye, tuple(to_world(RIGHT, (0, 0, 1.6))), 80)

    apply_snapshot("lock", eye)
    render(spawn, "lock.jpg")
    apply_snapshot("wall", eye)
    render(spawn, "wall.jpg")
    render(look_left, "wall_left.jpg")
    render(look_right, "wall_right.jpg")
    apply_snapshot("wall", Vector(room.location))
    render(room, "room.jpg")
    render(door, "door.jpg")
    apply_snapshot("chat", eye)
    render(spawn, "chat.jpg")
    apply_snapshot("chat", Vector(close.location))
    render(close, "chat_close.jpg")


def main():
    wipe()
    materials()
    build_room()
    build_center()
    build_left()
    build_right()
    check_contract()
    export_glb()
    if "--no-render" not in ARGS:
        review()


main()
