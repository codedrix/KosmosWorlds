"""render_modes.py -- lit renders of More Room in every mode, VR and MR.

@kosmos-system  Content (KosmosWorlds) -- More Room
@kosmos-owner   More Room v1 (design session 2026-10-14)

Usage (Blender 5.1, headless):
  blender -b --factory-startup --python more-room/tools/render_modes.py -- <vr|mr> <out_dir>

What it draws: the variant's world.glb, then, for each renders/state-<v>-<mode>.json
written by `scenario.mjs --snapshots`, exactly the nodes the world script left
visible (clones are copies of their template at the script's position) and
every world text it showed, as white 8 cm text facing the camera. So a render
shows what the script did, not a drawing of what it should do.

What it does NOT show truthfully, and the design doc says so:
  - lighting: a lit review rig (CLAUDE.md section 3: agents' green assertions
    are not pixels), not the headset's night sky and pawn lights;
  - the MR room: a stand-in room (walls, a desk, a window) modelled here, in
    place of the CEO's real room, which the headset shows through passthrough;
  - the font: Blender's default, not the headset's RobotoDistanceField.
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
VARIANT, OUT = argv[0], os.path.abspath(argv[1])
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODES = ["signin", "morning", "prep", "about", "focus", "triage", "triage-after", "wrap"]
EYE = (0.0, 0.0, 1.62)  # Blender Z-up; the visitor at the spawn, standing


def g2b(p):
    """glTF (x, y up, z) -> Blender (x, -z, y up)."""
    return Vector((p[0], -p[2], p[1]))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    try:
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    if VARIANT == "vr":
        bg.inputs[0].default_value = (0.012, 0.016, 0.03, 1)  # the night sky, roughly
        bg.inputs[1].default_value = 1.0
    else:
        bg.inputs[0].default_value = (0.55, 0.55, 0.55, 1)
        bg.inputs[1].default_value = 0.35
    return scene


def lights():
    # The review rig: a soft key from above-behind the visitor and a fill.
    key = bpy.data.lights.new("Key", "AREA")
    key.energy = 260 if VARIANT == "vr" else 320
    key.size = 4
    o = bpy.data.objects.new("Key", key)
    o.location = (-1.0, 0.0, 3.6)
    o.rotation_euler = (math.radians(35), 0, math.radians(-90))
    bpy.context.collection.objects.link(o)
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 0.5 if VARIANT == "vr" else 0.9
    s = bpy.data.objects.new("Sun", sun)
    s.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(s)


def stand_in_room():
    """MR only: a plain room standing in for the CEO's real one (passthrough)."""
    def box(name, loc, size, rgb):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
        ob = bpy.context.active_object
        ob.name = "StandIn" + name
        ob.scale = size  # a size-1 cube scaled by the full dimensions
        m = bpy.data.materials.new("StandIn" + name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
        ob.data.materials.append(m)
        return ob

    box("Floor", (1.5, 0, -0.01), (8, 8, 0.02), (0.42, 0.36, 0.3))  # wood floor
    box("FrontWall", (3.5, 0, 1.4), (0.1, 8, 2.8), (0.82, 0.8, 0.76))
    box("LeftWall", (1.5, 2.8, 1.4), (8, 0.1, 2.8), (0.78, 0.77, 0.74))
    box("RightWall", (1.5, -2.8, 1.4), (8, 0.1, 2.8), (0.78, 0.77, 0.74))
    box("BackWall", (-2.4, 0, 1.4), (0.1, 8, 2.8), (0.8, 0.79, 0.75))
    box("Desk", (0.77, 0, 0.72), (0.7, 1.9, 0.04), (0.55, 0.4, 0.26))
    for i, (x, y) in enumerate([(0.47, 0.9), (0.47, -0.9), (1.07, 0.9), (1.07, -0.9)]):
        box(f"Leg{i}", (x, y, 0.35), (0.04, 0.04, 0.7), (0.2, 0.2, 0.2))
    box("Monitor", (1.05, 0.0, 1.02), (0.03, 0.62, 0.36), (0.05, 0.05, 0.06))
    box("Window", (1.2, 2.74, 1.5), (1.2, 0.02, 1.0), (0.85, 0.92, 1.0))
    box("Shelf", (-2.3, 0, 1.0), (0.3, 1.4, 0.03), (0.5, 0.38, 0.25))


def text_material():
    m = bpy.data.materials.new("WorldText")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (1, 1, 1, 1)
    em.inputs[1].default_value = 1.6
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def add_text(name, body, pos, mat, cam_loc):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = 0.08  # the headset's fixed 8 cm
    curve.align_x = "CENTER"
    curve.align_y = "BOTTOM"
    curve.space_line = 1.05
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    ob.location = g2b(pos)
    # Yaw-faces the camera, as world text does.
    d = cam_loc - ob.location
    ob.rotation_euler = (math.radians(90), 0, math.atan2(d.y, d.x) + math.radians(90))
    ob.data.materials.append(mat)
    return ob


def render_state(state, out_png, views):
    scene = reset()
    lights()
    if VARIANT == "mr":
        stand_in_room()
    glb = os.path.join(ROOT, f"world-{VARIANT}", "world.glb")
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("StandIn")}
    visible = {}
    for n in state["nodes"]:
        visible.setdefault(n["name"], n)
    # Static nodes: show the ones the script left visible, where it left them.
    for name, ob in imported.items():
        n = visible.get(name)
        if n is None:
            ob.hide_render = True
            ob.hide_viewport = True
        else:
            ob.location = g2b(n["pos"])
    # Clones: a copy of the template at the script's position.
    for n in state["nodes"]:
        if n["name"] in imported:
            continue
        src = imported.get(n["source"])
        if src is None:
            continue
        c = src.copy()
        c.data = src.data
        c.name = n["name"]
        c.hide_render = False
        c.hide_viewport = False
        c.location = g2b(n["pos"])
        bpy.context.collection.objects.link(c)
    mat = text_material()
    for i, (view_name, cam_pos, target, lens) in enumerate(views):
        cam_data = bpy.data.cameras.new("Cam" + view_name)
        cam_data.lens = lens
        cam = bpy.data.objects.new("Cam" + view_name, cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = Vector(cam_pos)
        direction = Vector(target) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        texts = []
        for k, t in enumerate(state["texts"]):
            texts.append(add_text(f"T{k}", t["text"], t["pos"], mat, cam.location))
        final = out_png.replace(".png", f"-{view_name}.png")
        if VARIANT == "vr":
            scene.render.filepath = final
            bpy.ops.render.render(write_still=True)
        else:
            # Passthrough is a layer UNDER every virtual pixel: the real room never
            # hides virtual content. So: the room alone, then the world alone on a
            # transparent film, then the world laid over the room.
            stand_in = [o for o in scene.objects if o.name.startswith("StandIn")]
            world_obs = [o for o in scene.objects if o.type in ("MESH", "FONT") and not o.name.startswith("StandIn")]
            saved = {o.name: o.hide_render for o in world_obs}
            for o in world_obs:
                o.hide_render = True
            scene.render.film_transparent = False
            room_png = final.replace(".png", "-room.tmp.png")
            scene.render.filepath = room_png
            bpy.ops.render.render(write_still=True)
            for o in world_obs:
                o.hide_render = saved[o.name]
            for o in stand_in:
                o.hide_render = True
            scene.render.film_transparent = True
            scene.render.image_settings.color_mode = "RGBA"
            world_png = final.replace(".png", "-world.tmp.png")
            scene.render.filepath = world_png
            bpy.ops.render.render(write_still=True)
            for o in stand_in:
                o.hide_render = False
            scene.render.film_transparent = False
            composite(room_png, world_png, final)
            os.remove(room_png)
            os.remove(world_png)
        for ob in texts:
            bpy.data.objects.remove(ob, do_unlink=True)
        print("RENDERED", final)


def composite(under_path, over_path, out_path):
    import numpy as np

    under = bpy.data.images.load(under_path)
    over = bpy.data.images.load(over_path)
    w, h = under.size
    u = np.array(under.pixels[:], dtype=np.float32).reshape(h, w, 4)
    o = np.array(over.pixels[:], dtype=np.float32).reshape(h, w, 4)
    a = o[..., 3:4]
    rgb = o[..., :3] * a + u[..., :3] * (1 - a) if o[..., :3].max() <= 1.0 else o[..., :3] + u[..., :3] * (1 - a)
    out = np.concatenate([rgb, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new("Composite", w, h, alpha=False)
    img.pixels[:] = out.ravel()
    img.filepath_raw = out_path
    img.file_format = "PNG"
    img.save()
    for im in (under, over, img):
        bpy.data.images.remove(im)


VIEWS = [
    # name, camera (Blender), look-at (Blender), lens mm (18 mm ~ 90 degrees wide)
    ("eye", EYE, (3.0, 0.0, 1.35), 16),
    ("desk", (0.0, 0.0, 1.62), (0.9, 0.0, 0.72), 18),
    ("overview", (-2.6, -2.2, 2.9), (1.4, 0.2, 1.1), 16),
]

os.makedirs(OUT, exist_ok=True)
for mode in MODES:
    path = os.path.join(ROOT, "renders", f"state-{VARIANT}-{mode}.json")
    with open(path, encoding="utf-8") as f:
        state = json.load(f)
    views = VIEWS if mode in ("morning", "triage", "focus", "wrap") else VIEWS[:1]
    if mode == "triage-after":
        views = [VIEWS[1], ("behind", (0.3, 0.0, 1.62), (-1.7, 0.0, 1.0), 18)]
    render_state(state, os.path.join(OUT, f"{VARIANT}-{mode}.png"), views)
