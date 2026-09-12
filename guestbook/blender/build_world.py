"""Guestbook reference world - headless Blender scene build + glTF export + lit-render review.

@kosmos-system  Content (KosmosWorlds)
@kosmos-owner   NEW-10 (Phase B, Wave 2 device checkpoint)

Run:
    "E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P blender/build_world.py

Writes (relative to the guestbook/ package root, which is this file's parent's parent):
    world.glb            the exported scene, with the spawn_point / interactable / link extras
    review/spawn.png     the room as seen from the spawn point  (text VISIBLE)
    review/occluded.png  the room from the south-west floor     (text HIDDEN behind Partition)
    review/status.png    the diagnostic plate, read from the pressing position
    review/above.png     a labelled top-down plan of the room
    review/door.png      the link door, close enough to read its hover target
    review/approach.png  plate, plinth, count and phishing fixture in one frame

WHY THIS FILE EXISTS AT ALL
    Every scripted world gets a lit-render review before it ships: an agent's
    green assertion is not pixels (memory: feedback_scripted_world_build_review_2026_08_01).
    So the geometry and the review renders come out of ONE script - the pictures
    are of the same scene the .glb was written from, not of a scene someone
    remembered building.

COORDINATES
    Blender is Z-up, metres, and the glTF exporter converts to Y-up.
    The interior floor is z = 0, the room is x in [-4, 4], y in [-3, 3], walls 3 m.

THE OCCLUSION CONTRACT (cook runbook section 6 step 3)
    The live aggregate text is drawn by the CLIENT above the Plinth node, at
    TEXT_OFFSET_M metres. The Partition is a solid wall standing at y = 0 that
    spans x in [-4.0, -0.8]. Draw the line from an eye height of 1.6 m to the
    text position and you cross that wall from the south-WEST floor and miss it
    from the spawn in the south-EAST. That is the whole test: the text must
    disappear behind an opaque wall when the visitor walks left, which is only
    true if the engine depth-tests it.

RENDER-ONLY PROXIES
    The world text does not exist in the .glb - it is a runtime call. So the
    export happens FIRST, and the review renders then add flat Blender text
    objects at the exact positions the runtime text will occupy. They are never
    exported. Their sole job is to let a human (and this agent) SEE whether the
    wall covers that position.

    They cast NO SHADOW (`visible_shadow = False`). The real thing does not -
    world text is drawn by the client, not lit by the scene - and in the first
    pass the door label's shadow landed on the door slab and read as a garbled
    second address.

THE THREE WORLD TEXTS, AND WHY THERE ARE THREE NODES
    World text is keyed by NODE HANDLE, so one node can hold one string. The
    count goes on `Plinth`, the phishing imitation on `PhishPanel`, and the
    host-result readout on `StatusPlate` - a second string on `Plinth` would
    REPLACE the count rather than sit beneath it.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# Contract constants - these are mirrored in src/lib.rs and README.md.
# Changing one here without changing the other is the bug this comment exists
# to make obvious.
# ---------------------------------------------------------------------------

PLINTH_POS = (-1.5, 1.6, 0.0)     # origin at its base, on the floor
TEXT_OFFSET_M = 1.4               # k_ui_show_world_text offset_y, in glTF METRES
PHISH_POS = (-0.35, 1.55, 0.0)    # origin at its base
PHISH_TEXT_OFFSET_M = 1.26        # centre of the panel face
STATUS_POS = (-2.45, 1.6, 0.0)    # the diagnostic plate, beside the plinth
STATUS_TEXT_OFFSET_M = 1.0        # centre of the plate face
BEACON_POS = (1.6, 1.8, 1.15)     # centre; sits on BeaconStand's 1.0 m top
DOOR_POS_XY = (2.2, 2.94)         # set into the north wall (inner face y = 3.0)
SPAWN_POS = (2.0, -2.2, 0.0)      # floor-level marker; spawn-sync adds the 1.1 m capsule lift
EYE_M = 1.6                       # a standing visitor's eye height, for the review cameras

DOOR_URL = "world://home.micknerks"
DOOR_LABEL = "Home"

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REVIEW = os.path.join(PKG, "review")


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def wipe_scene():
    """Start from an empty file - `blender -b` opens the startup scene otherwise."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def make_material(name, rgb, roughness=0.7, metallic=0.0):
    """A plain Principled BSDF. No textures anywhere in this world: the whole
    scene is flat-coloured, which keeps it far inside the texture budget and
    makes the phishing fixture's 'world-drawn' look unmistakable."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_box(name, center, size, material):
    """An axis-aligned box. `center` and `size` are metres; the object's origin
    is left at `center` unless a caller re-origins it."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def add_cylinder(name, center, radius, height, material, verts=20):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=height, location=center
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def set_origin_to(obj, world_point):
    """Move an object's ORIGIN to a world point without moving its geometry.

    This matters more than it looks: the client attaches world text to the NODE
    origin and offsets upward from there, and the publisher's spawn-sync reads
    marker origins. A plinth whose origin sits at its own centre would put the
    text half a metre lower than this script claims.
    """
    bpy.context.view_layer.objects.active = obj
    cursor = bpy.context.scene.cursor.location.copy()
    bpy.context.scene.cursor.location = Vector(world_point)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = cursor


def join_into(name, parts, origin):
    """Join several meshes into ONE object.

    An interactable must be a single node: a separate decorative child steals
    the click from the node the world subscribed to
    (memory: feedback_glow_decoration_steals_interact_2026_08_02).
    """
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name + "Mesh"
    set_origin_to(obj, origin)
    return obj


# ---------------------------------------------------------------------------
# The room
# ---------------------------------------------------------------------------

def build_room():
    mats = {
        "floor": make_material("M_Floor", (0.62, 0.60, 0.56), roughness=0.85),
        "wall": make_material("M_Wall", (0.88, 0.87, 0.84), roughness=0.9),
        "partition": make_material("M_Partition", (0.36, 0.40, 0.45), roughness=0.8),
        "plinth": make_material("M_Plinth", (0.72, 0.55, 0.33), roughness=0.55),
        "door": make_material("M_Door", (0.10, 0.34, 0.36), roughness=0.5),
        # Deliberately chrome-coloured: the phishing fixture's whole job is to
        # LOOK like a system panel. It is world geometry with world-drawn text,
        # and the checkpoint asks a human to tell it from the real sheet.
        "panel": make_material("M_PhishPanel", (0.16, 0.17, 0.20), roughness=0.35),
        "post": make_material("M_Post", (0.22, 0.22, 0.24), roughness=0.7),
        "stand": make_material("M_BeaconStand", (0.50, 0.50, 0.52), roughness=0.8),
        # Instrument grey-green: legibly a readout, and legibly NOT the chrome
        # the phishing panel is imitating.
        "status": make_material("M_StatusPlate", (0.20, 0.26, 0.24), roughness=0.6),
        "beacon": make_material("M_Beacon", (0.95, 0.68, 0.15), roughness=0.25),
    }

    # --- shell -------------------------------------------------------------
    add_box("Floor", (0.0, 0.0, -0.05), (8.4, 6.4, 0.1), mats["floor"])
    add_box("WallNorth", (0.0, 3.1, 1.5), (8.4, 0.2, 3.0), mats["wall"])
    add_box("WallSouth", (0.0, -3.1, 1.5), (8.4, 0.2, 3.0), mats["wall"])
    add_box("WallEast", (4.1, 0.0, 1.5), (0.2, 6.0, 3.0), mats["wall"])
    add_box("WallWest", (-4.1, 0.0, 1.5), (0.2, 6.0, 3.0), mats["wall"])

    # --- the occluder ------------------------------------------------------
    # Spans x in [-4.0, -0.8] at y = 0, 2.6 m tall. See THE OCCLUSION CONTRACT.
    add_box("Partition", (-2.4, 0.0, 1.3), (3.2, 0.2, 2.6), mats["partition"])

    # --- the guestbook plinth (ONE node, interactable) ---------------------
    base = add_box("_PlinthBase", (PLINTH_POS[0], PLINTH_POS[1], 0.05), (0.62, 0.62, 0.10), mats["plinth"])
    col = add_cylinder("_PlinthCol", (PLINTH_POS[0], PLINTH_POS[1], 0.55), 0.20, 0.90, mats["plinth"], verts=20)
    cap = add_box("_PlinthCap", (PLINTH_POS[0], PLINTH_POS[1], 1.03), (0.52, 0.52, 0.06), mats["plinth"])
    plinth = join_into("Plinth", [base, col, cap], PLINTH_POS)
    plinth["interactable"] = True

    # --- the diagnostic plate ----------------------------------------------
    # Its own node, because world text is keyed by NODE HANDLE: a second string
    # on `Plinth` would replace the count rather than sit under it. Instrument
    # grey-green - it is a readout, not part of the exhibit.
    #
    # Placed BESIDE the plinth, not in front of it: the first pass put it at
    # (-1.5, 0.95) where it stood between the visitor and the thing they are
    # meant to press, and covered the plinth's column in the approach render.
    #
    # The plate is a BACKING, not a frame. World text size is fixed by the
    # client and a world cannot set it, so the real string may well overhang
    # these edges on device. That is expected; what the plate provides is a node
    # to attach to and a place to look.
    s_post = add_box("_StatusPost", (STATUS_POS[0], STATUS_POS[1], 0.425), (0.06, 0.06, 0.85), mats["post"])
    s_face = add_box("_StatusFace", (STATUS_POS[0], STATUS_POS[1], 1.00), (1.00, 0.05, 0.34), mats["status"])
    join_into("StatusPlate", [s_post, s_face], STATUS_POS)

    # --- the phishing fixture (world-drawn, deliberately NOT a system sheet)
    post = add_box("_PhishPost", (PHISH_POS[0], PHISH_POS[1], 0.475), (0.08, 0.08, 0.95), mats["post"])
    face = add_box("_PhishFace", (PHISH_POS[0], PHISH_POS[1], 1.26), (0.90, 0.06, 0.62), mats["panel"])
    # Two materials survive the join as two primitives on one mesh: a dark post
    # and a chrome-coloured face. Still ONE node, which is what matters.
    join_into("PhishPanel", [post, face], PHISH_POS)

    # --- the declarative door: a `link` extra and NOT ONE LINE OF CODE ------
    # On the NORTH wall, in the open half of the room, so a visitor spawning at
    # the south walks toward it rather than having to turn around to find it.
    # The frame is JOINED into the same object: a link target must be ONE node
    # (the client resolves it by component name and the press must not land on a
    # decorative child).
    leaf = add_box("_DoorLeaf", DOOR_POS_XY + (1.05,), (1.0, 0.12, 2.1), mats["door"])
    jamb_l = add_box("_DoorJambL", (DOOR_POS_XY[0] - 0.56, DOOR_POS_XY[1] + 0.02, 1.10), (0.12, 0.10, 2.20), mats["door"])
    jamb_r = add_box("_DoorJambR", (DOOR_POS_XY[0] + 0.56, DOOR_POS_XY[1] + 0.02, 1.10), (0.12, 0.10, 2.20), mats["door"])
    lintel = add_box("_DoorLintel", (DOOR_POS_XY[0], DOOR_POS_XY[1] + 0.02, 2.21), (1.24, 0.10, 0.12), mats["door"])
    door = join_into("Door_Home", [leaf, jamb_l, jamb_r, lintel], DOOR_POS_XY + (0.0,))
    door["link"] = DOOR_URL
    door["link_label"] = DOOR_LABEL

    # --- the timer-driven beacon (rotated by k_timer_set_interval) ---------
    add_box("BeaconStand", (1.6, 1.8, 0.5), (0.34, 0.34, 1.0), mats["stand"])
    beacon = add_box("Beacon", BEACON_POS, (0.30, 0.30, 0.30), mats["beacon"])
    beacon.rotation_euler = (0.0, 0.0, math.radians(45.0))

    # --- the spawn marker --------------------------------------------------
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=SPAWN_POS, radius=0.3)
    spawn = bpy.context.active_object
    spawn.name = "SpawnPoint"
    spawn["spawn_point"] = True


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_glb(path):
    """Export with `export_extras=True` - that flag is the whole mechanism.

    Blender writes object custom properties into the glTF node's `extras`, and
    the publisher reads `spawn_point`, `interactable` and `link` from exactly
    there. Without the flag the file exports cleanly, validates as geometry,
    and every marker in this world silently does not exist.
    """
    kwargs = dict(
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
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # Older/newer exporters drop or rename optional keys; retry with the
        # minimum set that still carries the extras.
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", export_extras=True, export_apply=True
        )
    print("[guestbook] exported %s (%d bytes)" % (path, os.path.getsize(path)))


# ---------------------------------------------------------------------------
# Lit-render review
# ---------------------------------------------------------------------------

def add_review_lighting():
    """A sun plus a sky world, approximating the client's own rig.

    The client's pawn carries the lights (sun 2.5 / sky 1.0 / fill 0.30, baked -
    memory: reference_pawn_light_tuning) and `sky: "day"` gives the world a lit
    sky. This is a stand-in for reviewing composition and occlusion, not a
    photometric match, and the README says so.
    """
    world = bpy.data.worlds.new("ReviewSky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.38, 0.50, 0.70, 1.0)
    bg.inputs[1].default_value = 0.65
    bpy.context.scene.world = world

    bpy.ops.object.light_add(type="SUN", location=(4.0, -4.0, 8.0))
    sun = bpy.context.active_object
    sun.name = "ReviewSun"
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(48.0), 0.0, math.radians(35.0))

    bpy.ops.object.light_add(type="AREA", location=(-2.0, 0.0, 2.9))
    fill = bpy.context.active_object
    fill.name = "ReviewFill"
    fill.data.energy = 45.0
    fill.data.size = 4.0

    # The first pass of these renders blew every wall out to flat white and the
    # Partition read as the same value as the walls behind it, which is exactly
    # the failure a lit-render review is for: an occlusion you cannot SEE is not
    # an occlusion you have verified. Tone-map instead of guessing at wattages.
    view = bpy.context.scene.view_settings
    try:
        view.view_transform = "AgX"
    except TypeError:
        view.view_transform = "Filmic"
    view.look = "None"
    view.exposure = 0.4


def add_text_proxy(name, body, location, size=0.10, color=(0.05, 0.05, 0.05)):
    """A flat Blender text object standing in for a runtime `k_ui_show_world_text`.

    Render-only. Faces -Y (south), which is roughly toward both review cameras,
    so the same proxy is legible from the visible viewpoint and is either
    covered or not covered from the occluded one. It is never exported: the
    export runs before any of these exist.
    """
    bpy.ops.object.text_add(location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.body = body
    obj.data.size = size
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    mat = make_material("M_" + name, color, roughness=0.5)
    obj.data.materials.append(mat)
    # NO SHADOW. The real thing does not cast one: world text is drawn by the
    # client, not lit by the scene. Without this the ReviewSun threw each
    # proxy's glyphs onto the surface behind it, and in the first pass the door
    # label's shadow landed on the door slab and read as a garbled SECOND
    # address — a reviewer had to crop the image and check the sun angle to tell
    # it from a duplicate object. Evidence that smears the string under test is
    # weaker than it should be.
    obj.visible_shadow = False
    return obj


def add_plan_label(text, xy, size=0.20, color=(0.08, 0.09, 0.11)):
    """A flat label lying face-up at z = 2.9 m - under the 3 m wall tops, so the
    top-down ortho sees it and no eye-level camera ever does (they are added
    after the four eye-level renders anyway)."""
    bpy.ops.object.text_add(location=(xy[0], xy[1], 2.9))
    obj = bpy.context.active_object
    obj.name = "PlanLabel_" + text.split()[0].strip(":")
    obj.data.body = text
    obj.data.size = size
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    mat = make_material("M_" + obj.name, color, roughness=0.5)
    obj.data.materials.append(mat)
    return obj


def add_plan_annotations():
    """Labels + a spawn disc, for the plan render only."""
    disc_mat = make_material("M_SpawnDisc", (0.85, 0.25, 0.20), roughness=0.6)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=0.35, depth=0.01,
        location=(SPAWN_POS[0], SPAWN_POS[1], 0.006),
    )
    disc = bpy.context.active_object
    disc.name = "PlanSpawnDisc"
    disc.data.materials.append(disc_mat)

    add_plan_label("SPAWN", (SPAWN_POS[0], SPAWN_POS[1] - 0.62), size=0.22, color=(0.70, 0.15, 0.12))
    # Plinth's label goes SOUTH of it and StatusPlate's NORTH: they are 0.95 m
    # apart in x and the two label strings are ~2 m wide, so side by side on the
    # same row they overprinted each other.
    add_plan_label("Plinth (interactable)", (PLINTH_POS[0] + 0.10, PLINTH_POS[1] - 0.58))
    add_plan_label("StatusPlate (host results)", (STATUS_POS[0] - 0.10, STATUS_POS[1] + 0.62), size=0.17)
    add_plan_label("PhishPanel", (PHISH_POS[0] + 0.55, PHISH_POS[1] - 0.55), size=0.17)
    add_plan_label("Beacon (timer)", (BEACON_POS[0] + 0.10, BEACON_POS[1] - 0.62), size=0.17)
    add_plan_label("Door_Home  link -> world://home.micknerks",
                   (DOOR_POS_XY[0] - 0.2, DOOR_POS_XY[1] - 0.45), size=0.17)
    add_plan_label("Partition (the occluder)", (-2.4, -0.45), size=0.19)


def render_from(name, location, look_at, lens=24.0, ortho_scale=None, resolution=(1280, 720),
                exposure=None):
    cam_data = bpy.data.cameras.new(name + "Cam")
    if ortho_scale is not None:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho_scale
    else:
        cam_data.lens = lens
    cam = bpy.data.objects.new(name + "Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(location)
    direction = Vector(look_at) - Vector(location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    # 8-bit RGB at full compression. The default 16-bit RGBA put ~950 KB of
    # alpha and dither into each picture of a flat-shaded grey room; these are
    # review evidence committed to a content repo, and they should not outweigh
    # the world they document by two orders of magnitude.
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    scene.render.filepath = os.path.join(REVIEW, name + ".png")

    previous_exposure = scene.view_settings.exposure
    if exposure is not None:
        scene.view_settings.exposure = exposure
    bpy.ops.render.render(write_still=True)
    scene.view_settings.exposure = previous_exposure
    print("[guestbook] rendered %s" % scene.render.filepath)


def pick_render_engine():
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            print("[guestbook] render engine: %s" % engine)
            return
        except TypeError:
            continue
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    print("[guestbook] render engine: CYCLES (48 samples)")


def build_review_renders():
    add_review_lighting()
    pick_render_engine()

    text_pos = (PLINTH_POS[0], PLINTH_POS[1], TEXT_OFFSET_M)
    phish_pos = (PHISH_POS[0], PHISH_POS[1], PHISH_TEXT_OFFSET_M)

    status_pos = (STATUS_POS[0], STATUS_POS[1] - 0.04, STATUS_TEXT_OFFSET_M)

    add_text_proxy("ProxyCount", "12 visitors signed", text_pos, size=0.13)
    # The status plate, showing the line that matters most at the sitting.
    add_text_proxy(
        "ProxyStatus",
        "prompt refused:\nERR_NO_ACTIVATION (-11)",
        status_pos,
        size=0.050,
        color=(0.80, 0.92, 0.86),
    )
    add_text_proxy(
        "ProxyPhish",
        "Enter your password\nto continue",
        (phish_pos[0], phish_pos[1] - 0.05, phish_pos[2]),
        size=0.070,
        color=(0.94, 0.94, 0.96),
    )
    # The client draws the hover label as the RESOLVED CANONICAL ADDRESS in
    # chrome type, above the `link_label` - so the proxy shows the address, not
    # the word "Home". It sits clear of the lintel (top 2.27 m).
    add_text_proxy(
        "ProxyDoor",
        "world://home.micknerks",
        (DOOR_POS_XY[0], DOOR_POS_XY[1] - 0.24, 2.50),
        size=0.085,
        color=(0.15, 0.17, 0.20),
    )

    # 1. From the spawn point: the count text must be VISIBLE past the
    #    Partition's east end.
    render_from("spawn", (SPAWN_POS[0], SPAWN_POS[1], EYE_M), (-0.3, 1.9, 1.25), lens=17.0)

    # 2. From the south-west floor, two and a bit metres to the LEFT of the
    #    spawn: the same text position must be COVERED by the Partition.
    render_from("occluded", (-3.2, -2.4, EYE_M), text_pos, lens=16.0)

    # 4. The declarative door on the north wall, straight on and far enough back
    #    that the hover-label proxy is inside the frame.
    render_from("door", (2.6, -0.9, EYE_M), (DOOR_POS_XY[0], DOOR_POS_XY[1], 1.45), lens=26.0)

    # 4. The approach: status plate, plinth, count and phishing fixture in one
    #    frame, the way a visitor sees them after walking past the Partition's
    #    east end. This is also the position §2.5's 2 m legibility target is
    #    actually met from - the spawn is 5.2 m out and is a SIGHT-LINE test.
    render_from("approach", (0.4, -0.2, EYE_M), (-1.6, 1.7, 1.2), lens=20.0)

    # 5. The status plate, read from where a visitor stands to press the plinth.
    #    Its own shot because the whole point of the plate is that a person can
    #    READ the host's refusal code, and a wide approach frame shrinks a
    #    23-character line to nothing.
    render_from("status", (-1.05, 0.50, EYE_M), (STATUS_POS[0], STATUS_POS[1], STATUS_TEXT_OFFSET_M),
                lens=34.0)

    # 6. Plan view, LAST - nothing floats, the door is reachable, the partition
    #    really does split the room. Square frame: a 16:9 ortho at this scale
    #    cropped the north and south walls out of the first pass. Labelled,
    #    because an unlabelled top-down of a white room says nothing - and the
    #    labels are added last precisely so they cannot appear in the four
    #    eye-level shots above.
    #    Rendered a stop darker than the eye-level shots: seen from straight
    #    above, the floor takes the sun flat and washed the Partition out to
    #    nearly the floor's own value in the first pass.
    add_plan_annotations()
    render_from("above", (0.0, 0.0, 12.0), (0.0, 0.0, 0.0), ortho_scale=9.2,
                resolution=(1024, 1024), exposure=-1.6)


# ---------------------------------------------------------------------------

def main():
    os.makedirs(REVIEW, exist_ok=True)
    wipe_scene()
    build_room()
    export_glb(os.path.join(PKG, "world.glb"))
    build_review_renders()
    print("[guestbook] done")


if __name__ == "__main__":
    main()
