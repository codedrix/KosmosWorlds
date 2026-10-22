"""render_review.py -- lit renders of a checkpoint world in a given script state.

@kosmos-system  Content (KosmosWorlds) -- the level-5/6 checkpoint worlds
@kosmos-owner   KOS-699 (builder vp-w1). Pattern: more-room/tools/render_modes.py. The same
                file ships in type-test/tools and visual-pack-check/tools; keep them identical.

Usage (Blender 5.1, headless):
  blender -b --factory-startup --python render_review.py -- \
      --glb <scene.glb> --snapshot <state.json> --views <views.json> --out <dir> \
      [--images <dir>] [--mr] [--font <dir with Inter-Regular.ttf, Inter-SemiBold.ttf>]

What it draws: the GLB, then exactly the meshes the mock host's snapshot left
visible (clones as copies of their source at the script's position), each
mesh slot with the colour, glow, opacity or picture the script set, and every
world text the script showed, placed the way the headset places it
(KWorldTextPool.cpp): on a thin upright card, printed flat on the card's face;
anywhere else, upright and turned toward the eye. Styled text gets its colour,
size, alignment, weight and the plate (#111828 at 85 %, 2 mm behind, padded by
half a glyph). So a render shows what the script did.

What it does NOT show truthfully:
  - lighting: a lit review rig (CLAUDE.md section 3: agents' green assertions are
    not pixels), not the headset's sky and pawn lights;
  - glow: Blender's emission, not the headset's LDR clamp (r.MobileHDR=False);
  - the MR room: a stand-in room in place of the real one behind passthrough;
  - the font: Inter from a local dry-run copy when --font is given (the headset's
    comes from the sitting), else Blender's default; level-5 text is Roboto on device.

views.json: [[name, [camera x, y, z], [look-at x, y, z], lens_mm], ...] in Blender
coordinates (Z up; the visitor stands at the origin facing +X; +Y is their left).
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]


def opt(name, default=None):
    if name in argv:
        return argv[argv.index(name) + 1]
    return default


GLB = os.path.abspath(opt("--glb"))
SNAP = os.path.abspath(opt("--snapshot"))
VIEWS = os.path.abspath(opt("--views"))
OUT = os.path.abspath(opt("--out"))
IMAGES = opt("--images")
FONT = opt("--font")
MR = "--mr" in argv
EYE = (0.0, 0.0, 1.62)


def g2b(p):
    """glTF (x, y up, z) -> Blender (x, -z, y up)."""
    return Vector((p[0], -p[2], p[1]))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


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
    scene.view_settings.view_transform = "Standard"
    try:
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.5, 0.5, 0.52, 1) if MR else (0.02, 0.025, 0.045, 1)
    bg.inputs[1].default_value = 0.35 if MR else 1.0
    return scene


def lights():
    # The review rig (render only, never exported): a soft key above-behind the visitor, a sun, a grey fill.
    key = bpy.data.lights.new("Key", "AREA")
    key.energy = 320
    key.size = 4
    o = bpy.data.objects.new("Key", key)
    o.location = (-1.0, 0.0, 3.6)
    o.rotation_euler = (math.radians(35), 0, math.radians(-90))
    bpy.context.collection.objects.link(o)
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 1.2
    s = bpy.data.objects.new("Sun", sun)
    s.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(s)
    back = bpy.data.lights.new("Back", "AREA")
    back.energy = 200
    back.size = 4
    b = bpy.data.objects.new("Back", back)
    b.location = (1.0, 0.0, 3.6)
    b.rotation_euler = (math.radians(-35), 0, math.radians(-90))
    bpy.context.collection.objects.link(b)


def stand_in_room():
    """MR only: a plain room standing in for the real one (passthrough)."""
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

    box("Floor", (1.5, 0, -0.01), (8, 8, 0.02), (0.42, 0.36, 0.3))
    box("FrontWall", (3.6, 0, 1.4), (0.1, 8, 2.8), (0.82, 0.8, 0.76))
    box("LeftWall", (1.5, 3.0, 1.4), (8, 0.1, 2.8), (0.78, 0.77, 0.74))
    box("RightWall", (1.5, -3.0, 1.4), (8, 0.1, 2.8), (0.78, 0.77, 0.74))
    box("BackWall", (-2.6, 0, 1.4), (0.1, 8, 2.8), (0.8, 0.79, 0.75))
    box("Window", (1.2, 2.94, 1.5), (1.2, 0.02, 1.0), (0.85, 0.92, 1.0))
    box("Sofa", (1.6, -2.2, 0.4), (1.8, 0.8, 0.8), (0.3, 0.32, 0.38))


FONTS = {}


def font(strong):
    key = "strong" if strong else "regular"
    if key in FONTS:
        return FONTS[key]
    f = None
    if FONT:
        p = os.path.join(FONT, "Inter-SemiBold.ttf" if strong else "Inter-Regular.ttf")
        if os.path.exists(p):
            f = bpy.data.fonts.load(p)
    FONTS[key] = f
    return f


def emission_material(name, rgb, strength=1.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*rgb, 1)
    em.inputs[1].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def plate_material():
    m = bpy.data.materials.get("Plate")
    if m:
        return m
    m = bpy.data.materials.new("Plate")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*hex_rgb("111828"), 1)
    em.inputs[1].default_value = 1.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.85
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    try:
        m.blend_method = "BLEND"
    except (AttributeError, TypeError):
        pass
    try:
        m.surface_render_method = "BLENDED"
    except (AttributeError, TypeError):
        pass
    return m


def plaque_normal(ob):
    """A thin upright plane (thinnest extent <= 1/5 of the next, the next > 1 cm): text prints flat on it."""
    if ob is None or ob.type != "MESH":
        return None
    dims = list(ob.dimensions)
    thin = min(range(3), key=lambda k: dims[k])
    nxt = min(dims[(thin + 1) % 3], dims[(thin + 2) % 3])
    if not (nxt > 0.01 and dims[thin] <= 0.2 * nxt):
        return None
    n = ob.matrix_world.col[thin].xyz.normalized()
    if abs(n.z) >= 0.7:
        return None
    if n.dot(Vector(EYE) - ob.matrix_world.translation) < 0:
        n = -n
    return n, dims[thin] / 2


def bounds_center(ob):
    corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(corners, Vector()) / 8.0


def add_text(name, t, anchor_ob):
    st = t.get("style") or {}
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = t["text"]
    curve.size = st.get("sizeMm", 80) / 1000.0
    curve.align_x = {"left": "LEFT", "right": "RIGHT"}.get(st.get("align"), "CENTER")
    curve.align_y = "BOTTOM"
    curve.space_line = 1.05
    f = font(st.get("strong", False)) if not st.get("engine", True) else None
    if f:
        curve.font = f
    ob = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(ob)
    base = bounds_center(anchor_ob) if anchor_ob is not None else g2b(t["pos"])
    ob.location = base + Vector((0, 0, t.get("offset", 0)))
    pl = plaque_normal(anchor_ob)
    if pl:
        d, half = pl
        ob.location = ob.location + d * (half + 0.005)
    else:
        d = Vector(EYE) - ob.location
    yaw = math.atan2(d.y, d.x) + math.radians(90)
    ob.rotation_euler = (math.radians(90), 0, yaw)
    ob.data.materials.append(emission_material(name + "Mat", hex_rgb(st.get("color", "ffffff"))))
    try:
        ob.visible_shadow = False
    except AttributeError:
        pass
    made = [ob]
    if st.get("plate"):
        bpy.context.view_layer.update()
        corners = [Vector(c) for c in ob.bound_box]
        lo = Vector((min(c.x for c in corners), min(c.y for c in corners), 0))
        hi = Vector((max(c.x for c in corners), max(c.y for c in corners), 0))
        pad = curve.size * 0.5
        w, h = (hi.x - lo.x) + 2 * pad, (hi.y - lo.y) + 2 * pad
        mid = (lo + hi) / 2
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        p = bpy.context.active_object
        p.name = name + "Plate"
        p.scale = (w, h, 1)
        p.parent = ob
        p.location = (mid.x, mid.y, -0.002)
        p.data.materials.append(plate_material())
        made.append(p)
    return made


def apply_overrides(ob, overrides, images):
    """Each slot's colour, glow, opacity or picture, on a copy of its material."""
    for s, ov in enumerate(overrides):
        if not ov or s >= len(ob.material_slots):
            continue
        src = ob.material_slots[s].material
        if src is None:
            continue
        m = src.copy()
        ob.material_slots[s].link = "OBJECT"
        ob.material_slots[s].material = m
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
        if bsdf is None:
            # An unlit import: colour the emission or background node it carries.
            for n in m.node_tree.nodes if m.use_nodes else []:
                if n.type in ("EMISSION", "RGB") and "color" in ov:
                    n.inputs[0].default_value = (*hex_rgb(ov["color"]), 1) if n.type == "EMISSION" else n.inputs[0].default_value
            continue
        if "texture" in ov and images:
            p = os.path.join(images, ov["texture"])
            if os.path.exists(p):
                img = bpy.data.images.load(p)
                tex = m.node_tree.nodes.new("ShaderNodeTexImage")
                tex.image = img
                m.node_tree.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
        elif "color" in ov:
            for link in list(bsdf.inputs["Base Color"].links):
                m.node_tree.links.remove(link)
            bsdf.inputs["Base Color"].default_value = (*hex_rgb(ov["color"]), 1)
        if "emissive" in ov:
            key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
            bsdf.inputs[key].default_value = (*hex_rgb(ov["emissive"]), 1)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = ov.get("strength", 1.0)
        if "opacity" in ov:
            bsdf.inputs["Alpha"].default_value = ov["opacity"]
            try:
                m.blend_method = "BLEND"
            except (AttributeError, TypeError):
                pass
            try:
                m.surface_render_method = "BLENDED"
            except (AttributeError, TypeError):
                pass


def composite(under_path, over_path, out_path):
    import numpy as np
    under = bpy.data.images.load(under_path)
    over = bpy.data.images.load(over_path)
    w, h = under.size
    u = np.array(under.pixels[:], dtype=np.float32).reshape(h, w, 4)
    o = np.array(over.pixels[:], dtype=np.float32).reshape(h, w, 4)
    a = o[..., 3:4]
    rgb = o[..., :3] * a + u[..., :3] * (1 - a)
    out = np.concatenate([rgb, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new("Composite", w, h, alpha=False)
    img.pixels[:] = out.ravel()
    img.filepath_raw = out_path
    img.file_format = "PNG"
    img.save()
    for im in (under, over, img):
        bpy.data.images.remove(im)


def main():
    with open(SNAP, encoding="utf-8") as f:
        state = json.load(f)
    with open(VIEWS, encoding="utf-8") as f:
        views = json.load(f)
    scene = reset()
    lights()
    if MR:
        stand_in_room()
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=GLB)
    imported = {o.name: o for o in bpy.data.objects if o.name not in before and o.type == "MESH"}
    visible = {}
    for n in state["nodes"]:
        visible.setdefault(n["name"], n)
    for name, ob in imported.items():
        if name not in visible:
            ob.hide_render = True
    anchors = dict(imported)
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
        c.location = g2b(n["pos"])
        bpy.context.collection.objects.link(c)
        anchors[n["name"]] = c
    bpy.context.view_layer.update()
    for n in state["nodes"]:
        ob = anchors.get(n["name"])
        if ob is not None and any(n.get("mat") or []):
            apply_overrides(ob, n["mat"], IMAGES)
    for k, t in enumerate(state["texts"]):
        add_text(f"T{k}", t, anchors.get(t["name"]))
    bpy.context.view_layer.update()
    os.makedirs(OUT, exist_ok=True)
    for view_name, cam_pos, target, lens in views:
        cam_data = bpy.data.cameras.new("Cam" + view_name)
        cam_data.lens = lens
        cam = bpy.data.objects.new("Cam" + view_name, cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = Vector(cam_pos)
        cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        final = os.path.join(OUT, f"{view_name}.png")
        if not MR:
            scene.render.filepath = final
            bpy.ops.render.render(write_still=True)
        else:
            # Passthrough is a layer UNDER every virtual pixel: the room alone, then the world
            # alone on a transparent film, then the world laid over the room.
            stand_in = [o for o in scene.objects if o.name.startswith("StandIn")]
            world_obs = [o for o in scene.objects if o.type in ("MESH", "FONT") and not o.name.startswith("StandIn")]
            saved = {o.name: o.hide_render for o in world_obs}
            for o in world_obs:
                o.hide_render = True
            room_png = final.replace(".png", "-room.tmp.png")
            scene.render.film_transparent = False
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
        print("RENDERED", final)


main()
