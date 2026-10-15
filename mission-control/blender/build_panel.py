"""
build_panel.py -- builds the Mission Control panel for world://lobby.micknerks, and its lit review.

@kosmos-system  Content (KosmosWorlds) -- Mission Control (DB-044)
@kosmos-owner   Content lane

Mission Control lives INSIDE the Lobby (the CEO, 2026-10-14). The owner stands on the
throne facing the hall, points at an unmarked spot on the front of the seat and
presses A; the system typing sheet asks for the bridge's passphrase; the panel then
rises in front of him. Leaving the Lobby closes it.

Run headless (no window, no editor):

    "E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_panel.py
    ... -- --no-render        export mc_assembly.glb only

Writes:
    mc_assembly.glb      the panel PARKED 200 m below the Lobby floor, the seal on the
                         throne seat and the Watch button on the dais; merged into the
                         live Lobby scene by mission-control-tools/lobby/merge_glb.mjs
    review/*.jpg         lit renders inside the live Lobby scene

WHY PARKED. Every visitor's headset runs the Lobby's program, and only the owner's
(after the ritual) ever raises the panel. Authoring it 200 m down means that if the
program fails to load, nobody ever sees a stray panel in the Lobby.

PLACEMENT. The panel is designed around a viewer at the origin facing +X (the old
standalone wall), then turned 180 degrees and set on the throne seat: the owner
stands at STAND (Lobby Blender coordinates; seat top 1.46 m, measured from the live
scene by mission-control-tools/lobby/measure_throne.py), facing -X into the hall.

THE NODE CONTRACT. Every name the script finds is in ../nodes.json, which the
bridge generates from its face layout (agent-bridge/scripts/write-nodes-json.mjs),
including the world-only nodes (seal, Watch button, move handles, frames, page dock).
This script builds exactly those nodes and asserts it built them all.

DEVICE RULES this file follows (memory notes, 2026-08 to 2026-10):
  1. No node name ends in a digit (the client strips a trailing `_<digit>`).
  2. `k_node_find` sees only nodes WITH A MESH: every text anchor is a mesh.
  3. The publisher's merge stage bakes childless, extras-less meshes away, so
     every node the script moves carries an extra (`interactable` on buttons,
     `script_node` on the rest), the frames included.
  4. A button is ONE mesh with its words merged in: `k_node_set_visible` turns
     collision off only on the node itself, so a separate label child would keep
     blocking the laser after its button hid.
  5. World text is white, 8 cm Roboto, centred on its anchor and bottom-aligned,
     depth-tested. Every anchor is a 3 cm x 3 cm x 2 mm PLAQUE parallel to its
     panel: the client prints text on a thin plane's face, a hair in front, and
     never turns it (KWorldTextPool.cpp, Build 1009). Plaques keep their rotation
     on the node (the client judges "thin" from local bounds).
  6. Other nodes' rotations are baked to identity; each progress bar's origin is its
     left end, so `k_transform_set_scale(bar, 1, f, 1)` grows it to the right.

THE REVIEW applies review/<lock|wall|chat>.snapshot (captured from the real bridge by
agent-bridge/scripts/capture-review-snapshots.mjs) exactly as src/lib.rs applies a
snapshot, with the panel raised, inside the live Lobby scene. It reviews composition
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

# Where the owner stands on the throne (Lobby Blender coordinates): the seat's centre,
# seat top 1.46 m, facing -X into the hall. Mirrored in src/lib.rs (the move limits).
STAND = (14.8, 0.0, 1.46)
# How far below the Lobby floor the panel is authored ("parked"). Mirrored in src/lib.rs.
PARK_DROP = 200.0
# The ritual's spot: the front of the seat, between the feet of someone standing on it
# and facing the hall (seat x 14.2-15.4, y -0.8..0.8).
SEAL_AT = (14.42, 0.0, 1.462)
# The Watch button: on the dais, to the throne's right as seen from the hall (y < 0),
# clear of the right arm (y -1.0) and the pier.
WATCH_AT = (14.3, -1.75, 0.9)
LOBBY_GLB = os.environ.get(
    "LOBBY_GLB", "E:/Kosmos_Integration/mission-control-door/lobby_1.1.1_live/scene.glb"
)

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
    mat("seal", (0.16, 0.16, 0.16), rough=0.9)  # a stone inlay, close to the seat's own grey


LOBBY_FRAME = (0.0, 0.0)  # identity: Lobby Blender coordinates as they are


def build_fixtures():
    """The two pieces that stay in the Lobby for every visitor (never parked).

    McSeal: an unmarked inlay on the front of the throne seat, the ritual's press.
    It is a hidden door, not a lock: anyone who watches can repeat the gesture. The
    sign-in after it is the lock. Standing on the seat facing the hall puts it just
    in front of your feet; from the floor it sits below the seat's front edge line.

    McWatchJoin: a small "Watch" plaque on the dais, right of the throne as seen from
    the hall. A group member types the owner's watch code there. Visible to every
    visitor; it does nothing (and the program makes no network call) without a code.
    """
    sx, sy, sz = SEAL_AT
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.09, depth=0.006, location=(sx, sy, sz))
    seal = bpy.context.active_object
    seal.data.materials.append(MATS["seal"])
    node("McSeal", seal, "button")

    wx, wy, wz = WATCH_AT
    f = LOBBY_FRAME
    parts = [
        box("_WatchPost", f, (wx, wy, wz + 0.5), (0.05, 0.05, 1.0), MATS["frame"]),
        box("_WatchPlate", f, (wx, wy, wz + 1.08), (0.04, 0.42, 0.17), MATS["button"], bevel=0.01),
        mesh_text("_WatchWord", f, (wx - 0.025, wy, wz + 1.08), "Watch", 0.075, MATS["label"]),
    ]
    node("McWatchJoin", join("McWatchJoin", parts, (wx, wy, wz + 1.08)), "button")


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
        box("_CControls", c, (0.03, 0, 0.21), (0.06, 3.8, 0.26), MATS["frame"], bevel=0.015),
    ]
    node("McCenterFrame", join("McCenterFrame", parts, to_world(c, (0, 0, 0))), "show")

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

    # The controls row under the wall: group watching, the move handles, Close.
    row = 0.21
    button("BtnWatch", c, (-0.02, 1.55, row), 0.56, 0.17, "Group watch", MATS["button"], text_size=0.055)
    anchor("TxWatch", c, (-0.02, 0.62, row - 0.04))
    handles = (
        ("McMoveLeft", "<", -0.05), ("McMoveUp", "^", -0.25), ("McMoveDown", "v", -0.45),
        ("McMoveRight", ">", -0.65), ("McMoveCloser", "Near", -0.88), ("McMoveFarther", "Far", -1.17),
    )
    for name, words, y in handles:
        w = 0.17 if len(words) == 1 else 0.25
        button(name, c, (-0.02, y, row), w, 0.17, words, MATS["button"], text_size=0.07 if len(words) == 1 else 0.055)
    button("McClose", c, (-0.02, -1.6, row), 0.38, 0.17, "Close", MATS["redFace"], text_size=0.06)


def build_page_dock():
    """The reserved spot for the pinned web page (DB-043, the page brief): right of the
    viewer, about 1 m from the head, facing the viewer. A plain plaque until the page
    brief's PAGE_001 exists; then it gains `page_dock = true` (the brief's proposed
    contract). Hidden, and so ignored by the page, until the panel opens."""
    return anchor("McPageDock", (0.0, 0.0), (0.85, -0.85, 1.5))


def build_left():
    f = LEFT
    parts = [
        box("_LFrame", f, (0.04, 0, 1.7), (0.08, 1.45, 2.4), MATS["frame"], bevel=0.02),
        box("_LInset", f, (-0.005, 0, 1.7), (0.02, 1.33, 2.28), MATS["inset"]),
        mesh_text("_LHead", f, (-0.03, 0, 2.66), "START A JOB", 0.08, MATS["title"], weight="Bold"),
        box("_LLine", f, (-0.03, 0, 2.58), (0.01, 1.2, 0.006), MATS["cyan"]),
    ]
    node("McLeftFrame", join("McLeftFrame", parts, to_world(f, (0, 0, 0))), "show")
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
    node("McRightFrame", join("McRightFrame", parts, to_world(f, (0, 0, 0))), "show")
    for slot, z in zip("ABC", (2.2, 1.6, 1.0)):
        body = box("_Need" + slot, f, (-0.04, 0, z), (0.05, 1.25, 0.54), MATS["amberFill"], bevel=0.015)
        edge = box("_NeedEdge" + slot, f, (-0.068, 0.6, z), (0.01, 0.02, 0.48), MATS["amber"])
        node("Need" + slot, join("Need" + slot, [body, edge], to_world(f, (-0.04, 0, z))), "button")
        anchor("TxNeed" + slot, f, (-0.10, 0, z - 0.21))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def check_contract():
    want = set(NODES["text"]) | set(NODES["buttons"]) | set(NODES["show"]) | set(NODES["world"])
    have = set(built)
    missing, extra = sorted(want - have), sorted(have - want)
    assert not missing and not extra, f"nodes.json mismatch: missing {missing}, extra {extra}"
    for n in have:
        assert not n[-1].isdigit(), n
    print(f"[mission-control] built all {len(have)} scripted nodes")


def place_panel(objs, dz=0.0):
    """Turn the viewer-at-origin design 180 degrees and stand it on the throne seat.

    Plaques keep their rotation on the node (rule 5); everything else is baked back
    to identity rotation (rule 6)."""
    m = Matrix.Translation((STAND[0], STAND[1], STAND[2] + dz)) @ Matrix.Rotation(math.pi, 4, "Z")
    for o in objs:
        o.matrix_world = m @ o.matrix_world
        if o.name not in ANCHOR_FRAME:
            select_only([o])
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def move_all(objs, dz):
    for o in objs:
        o.location.z += dz


def export_glb():
    path = os.path.join(PKG, "mc_assembly.glb")
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
# The review: inside the live Lobby, apply a snapshot as src/lib.rs does, render
# ---------------------------------------------------------------------------

def parse_snapshot(path):
    recs = []
    for line in open(path, encoding="utf-8").read().split("\n"):
        if not line or line == "AB1":
            continue
        recs.append(line.split(" ", 2))
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
PANEL = []  # the panel objects (main fills it), for the watcher review
# The world's own nodes that show whenever the panel is open (src/lib.rs OPEN_SHOWS).
OPEN_SHOWS = ("McCenterFrame", "McLeftFrame", "McRightFrame", "McClose", "McMoveCloser", "McMoveFarther",
              "McMoveLeft", "McMoveRight", "McMoveUp", "McMoveDown")
ALWAYS_SHOWN = ("McSeal", "McWatchJoin")


def clear_review():
    for o in REVIEW_OBJS:
        bpy.data.objects.remove(o, do_unlink=True)
    REVIEW_OBJS.clear()


def world_text(anchor_obj, text, dx_m=0.0):
    """White Roboto at 8 cm, centred, bottom-aligned, printed on the plaque's face (KWorldTextPool rule 1).

    The world shifts conversation anchors along the panel's right (src/lib.rs `shift`)."""
    cu = bpy.data.curves.new("WT", type="FONT")
    cu.body = text
    cu.font = font("Regular")
    cu.size = TEXT_SIZE
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM"
    o = bpy.data.objects.new("WT_" + anchor_obj.name, cu)
    bpy.context.collection.objects.link(o)
    rot = anchor_obj.matrix_world.to_3x3().normalized()
    normal = rot @ Vector((-1, 0, 0))   # out of the panel, toward the viewer
    right = rot @ Vector((0, -1, 0))    # the viewer's right
    face = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    loc = anchor_obj.matrix_world.translation + right * dx_m + normal * 0.006
    o.matrix_world = Matrix.Translation(loc) @ rot.to_4x4() @ face
    o.data.materials.append(MATS["worldText"])
    REVIEW_OBJS.append(o)


def apply_snapshot(name, open_panel=True):
    clear_review()
    for n, o in built.items():
        o.hide_render = not (n in ALWAYS_SHOWN or (open_panel and n in OPEN_SHOWS))
        if n.startswith("Bar"):
            o.scale = (1, 1, 1)
    texts, offsets, copies = {}, {}, {}
    if open_panel:
        for r in parse_snapshot(os.path.join(REVIEW, name + ".snapshot")):
            k = r[0]
            if k == "T":
                texts[r[1]] = unescape(r[2] if len(r) > 2 else "")
            elif k == "X":
                texts.pop(r[1], None)
            elif k == "U":
                built[r[1]].hide_render = r[2] != "1"
            elif k == "G":
                built[r[1]].scale = (1, max(0.02, int(r[2]) / 1000.0), 1)
            elif k == "O":
                offsets[r[1]] = int(r[2]) / 1000.0
            elif k == "C":
                copies[r[1]] = int(r[2])
    for n in NODES["text"]:
        built[n].hide_render = True  # the plaques themselves are 3 cm; keep the frames clean
    for n, t in texts.items():
        world_text(built[n], t, offsets.get(n, 0.0))
    for n, count in copies.items():
        src = built[n]
        for i in range(1, count):
            dup = src.copy()
            dup.data = src.data
            # Copies step along the viewer's right: Blender +Y here (src/lib.rs CHIP_STEP_M along wasm -z).
            dup.location = src.location + Vector((0, 0.085 * i, 0))
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
    s.render.image_settings.file_format = "JPEG"
    s.render.image_settings.quality = 90
    s.view_settings.view_transform = "AgX"
    mat("worldText", (1, 1, 1), emit=(1, 1, 1))
    # Review only: Cycles mirrors white text in glossy panels in a way the headset's mobile
    # renderer does not. (Exported, this would be KHR_materials_specular, stripped anyway.)
    for m in MATS.values():
        b = m.node_tree.nodes["Principled BSDF"]
        if b.inputs["Emission Strength"].default_value == 0.0 or tuple(b.inputs["Emission Color"].default_value)[:3] == (0.0, 0.0, 0.0):
            b.inputs["Specular IOR Level"].default_value = 0.08
    # The Lobby is a day world (`sky: "day"`): a soft sky plus a sun, as the client's pawn rig lights it.
    w = bpy.data.worlds.new("LobbyDay")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    s.world = w
    bpy.ops.object.light_add(type="SUN", location=(10, 0, 20))
    sun = bpy.context.active_object
    sun.data.energy = 2.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(160))


def camera(name, loc, look_at, fov_deg):
    cam_data = bpy.data.cameras.new(name)
    cam_data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return cam


def render(cam, out_name):
    s = bpy.context.scene
    s.camera = cam
    s.render.filepath = os.path.join(REVIEW, out_name)
    bpy.ops.render.render(write_still=True)
    print(f"[mission-control] rendered review/{out_name}")


def review():
    os.makedirs(REVIEW, exist_ok=True)
    bpy.ops.import_scene.gltf(filepath=LOBBY_GLB)
    setup_render()
    eye = (STAND[0], STAND[1], STAND[2] + EYE)
    ahead = (STAND[0] - 2.9, STAND[1], STAND[2] + 1.55)
    owner = camera("CamOwner", eye, ahead, 96)
    close = camera("CamClose", (STAND[0] - 1.15, 0.05, STAND[2] + 1.62), (STAND[0] - 2.9, 0.15, STAND[2] + 1.7), 62)
    hall = camera("CamHall", (8.6, -2.4, 2.3), (13.2, 0.0, 2.7), 70)
    seal = camera("CamSeal", (14.95, 0.15, 2.65), (14.42, 0.0, 1.46), 70)
    watch = camera("CamWatch", (11.6, -2.6, 2.4), (14.3, -1.2, 1.6), 60)

    apply_snapshot("lock", open_panel=False)
    render(seal, "ritual_seal.jpg")
    render(watch, "watch_button.jpg")
    apply_snapshot("lock")
    render(owner, "lock.jpg")
    apply_snapshot("wall")
    render(owner, "wall.jpg")
    render(hall, "hall_view.jpg")
    apply_snapshot("chat")
    render(owner, "chat.jpg")
    render(close, "chat_close.jpg")

    # A watcher's copy: turned 180 degrees about the centre panel's vertical axis and lowered
    # to the hall floor (src/lib.rs `place`, WATCH_PIVOT_X / WATCH_LOWER_M), seen from the hall.
    pivot_x = STAND[0] - 2.9
    turn = Matrix.Translation((pivot_x, 0, -(STAND[2] - 0.03))) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation((-pivot_x, 0, 0))
    saved = {o.name: o.matrix_world.copy() for o in PANEL}
    for o in PANEL:
        o.matrix_world = turn @ o.matrix_world
    watcher = camera("CamWatcher", (pivot_x - 3.0, 0.0, 1.65), (pivot_x, 0.0, 1.75), 90)
    apply_snapshot("watch")
    render(watcher, "watcher.jpg")
    for o in PANEL:
        o.matrix_world = saved[o.name]


def main():
    wipe()
    materials()
    build_center()
    build_left()
    build_right()
    build_page_dock()
    panel = [o for o in bpy.data.objects]
    PANEL.extend(panel)
    place_panel(panel)
    build_fixtures()
    check_contract()
    move_all(panel, -PARK_DROP)
    export_glb()
    move_all(panel, PARK_DROP)
    if "--no-render" not in ARGS:
        review()


main()
