"""to_jpeg.py -- renders/png/*.png -> renders/*.jpg (quality 82), for the repo.

@kosmos-system  Content (KosmosWorlds) -- More Room
@kosmos-owner   More Room v1

Usage: blender -b --factory-startup --python more-room/tools/to_jpeg.py
"""
import bpy, glob, os

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for p in sorted(glob.glob(os.path.join(root, "renders", "png", "*.png"))):
    img = bpy.data.images.load(p)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 82
    scene.render.image_settings.color_mode = "RGB"
    out = os.path.join(root, "renders", os.path.basename(p)[:-4] + ".jpg")
    img.save_render(out, scene=scene)
    bpy.data.images.remove(img)
    print("JPEG", out)
