# desk_review.py -- lit renders of the Kosmos Desk board inside the packaged Lobby 1.5.0 scene.
#
# @kosmos-system Content (KosmosWorlds) -- the Kosmos Desk board in the Lobby
# @kosmos-owner  Content lane
#
#   blender -b --python-exit-code 1 --python mission-control/blender/desk_review.py
#
# Reads the PACKAGED scene (package_lobby.mjs output, DESK_SCENE_GLB), so the board is the merged
# node set the headset gets, not a Blender rebuild. Raises what lib.rs raises in cubes mode (the
# desk board, the ledge, its cubes and the puck: DELTA = 200 m up) and prints the words of the real
# desk face's snapshots (agent-bridge/scripts/capture-desk-snapshots.mjs: review/desk*.snapshot)
# the way lib.rs does: white Roboto 8 cm, centred on the anchor, bottom-aligned, shifted along the
# board by the snapshot's O offset. Mission Control's own labels are left off (build_panel.py's
# renders show them). Renders, not pixels: the device checkpoint is the real check.
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REVIEW = os.path.join(PKG, "review")
SCENE = os.environ.get("DESK_SCENE_GLB", "E:/Kosmos_Integration/desk-board/lobby_1.5.0/scene.glb")
FONT = "E:/Epic Games/UE_5.7/Engine/Content/Slate/Fonts/Roboto-Regular.ttf"
STAND = (14.8, 0.0, 1.46)
EYE = 1.6
PARK_DROP = 200.0
TEXT_SIZE = 0.08
RAISED = ["McDeskBoard", "TxDeskHead"] + [f"TxDesk{k}" for k in "ABCDEFGH"] + [
    "McLedge", "CubeA", "CubeB", "CubeC", "CubeACalm", "CubeBCalm", "CubeCCalm", "CubePlus", "McClose",
    "Puck", "PuckCalm",
]


def vpt(x, y, z):
    """A viewer-frame point (feet on the seat, +x ahead, +y the owner's left) in Lobby coordinates."""
    return (STAND[0] - x, STAND[1] - y, STAND[2] + z)


def camera(name, loc, look_at, fov_deg):
    data = bpy.data.cameras.new(name)
    data.angle = math.radians(fov_deg)
    cam = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return cam


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
        print("[desk] GPU unavailable, CPU render:", e)
    s.cycles.samples = 96
    s.cycles.use_denoising = True
    s.render.image_settings.file_format = "JPEG"
    s.render.image_settings.quality = 90
    s.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("LobbyDay")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    s.world = w
    bpy.ops.object.light_add(type="SUN", location=(10, 0, 20))
    sun = bpy.context.active_object
    sun.data.energy = 2.0
    sun.data.use_shadow = False  # no dynamic shadows on the headset
    sun.rotation_euler = (math.radians(50), 0, math.radians(160))


def text_material():
    m = bpy.data.materials.new("deskWorldText")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1, 1, 1, 1)
    b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    b.inputs["Emission Strength"].default_value = 1.0
    return m


def parse(path):
    recs = []
    for line in open(path, encoding="utf-8").read().split("\n"):
        if line and line != "AB1":
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


WORDS = []


def show(snapshot, font, mat):
    for o in WORDS:
        bpy.data.objects.remove(o, do_unlink=True)
    WORDS.clear()
    texts, shift = {}, {}
    for r in parse(os.path.join(REVIEW, snapshot + ".snapshot")):
        if r[0] == "T":
            texts[r[1]] = unescape(r[2])
        elif r[0] == "X":
            texts.pop(r[1], None)
        elif r[0] == "O":
            shift[r[1]] = max(-0.8, min(0.8, int(r[2]) / 1000.0))  # lib.rs DESK_SHIFT_MAX_M
    # lib.rs parks an anchor with no words (desk_sync), so only the anchors that carry text show.
    for name in ["TxDeskHead"] + [f"TxDesk{k}" for k in "ABCDEFGH"]:
        bpy.data.objects[name].hide_render = name not in texts
    for name, text in texts.items():
        a = bpy.data.objects[name]
        cu = bpy.data.curves.new("WT", type="FONT")
        cu.body = text
        cu.font = font
        cu.size = TEXT_SIZE
        cu.align_x = "CENTER"
        cu.align_y = "BOTTOM"
        o = bpy.data.objects.new("WT_" + name, cu)
        bpy.context.collection.objects.link(o)
        rot = a.matrix_world.to_3x3().normalized()
        normal = rot @ Vector((-1, 0, 0))  # out of the face, toward the eye
        right = rot @ Vector((0, -1, 0))   # glTF local +Z: the board's right (lib.rs DESK_RIGHT)
        face = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        loc = a.matrix_world.translation + right * shift.get(name, 0.0) + normal * 0.006
        o.matrix_world = Matrix.Translation(loc) @ rot.to_4x4() @ face
        o.data.materials.append(mat)
        WORDS.append(o)


def render(cam, out_name, eye=True):
    s = bpy.context.scene
    s.camera = cam
    s.render.resolution_x, s.render.resolution_y = (1600, 1360) if eye else (1920, 1080)
    s.render.filepath = os.path.join(REVIEW, out_name)
    bpy.ops.render.render(write_still=True)
    print(f"[desk] rendered review/{out_name}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SCENE)
    missing = [n for n in RAISED if n not in bpy.data.objects]
    if any(n.startswith(("McDesk", "TxDesk")) for n in missing):
        raise RuntimeError(f"the packaged scene lacks desk nodes: {missing}")
    for n in RAISED:
        if n in bpy.data.objects:
            bpy.data.objects[n].location.z += PARK_DROP
    bpy.context.view_layer.update()
    setup_render()
    font = bpy.data.fonts.load(FONT)
    mat = text_material()
    eye = vpt(0, 0, EYE)
    a = math.radians(72)
    look = vpt(2.5 * math.cos(a), 2.5 * math.sin(a), 1.615)
    # The head turned left to the board, at the headset's ~90 degrees across.
    cam_eye = camera("CamDesk", eye, look, 90)
    # The owner's eye straight ahead: where the board sits in the view (the left edge).
    cam_ahead = camera("CamAhead", eye, vpt(2.0, 0.9, 1.25), 90)
    show("desk", font, mat)
    render(cam_eye, "desk_eye.jpg")
    render(cam_ahead, "desk_ahead.jpg")
    show("desk_full", font, mat)
    render(cam_eye, "desk_full.jpg")
    show("desk_offline", font, mat)
    render(cam_eye, "desk_offline.jpg")


try:
    main()
except Exception as e:  # noqa: BLE001 - any failure: report it and exit non-zero
    import traceback
    traceback.print_exc()
    print(f"[desk] REVIEW FAILED: {e}")
    sys.stdout.flush()
    os._exit(1)
