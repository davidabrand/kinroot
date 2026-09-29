"""Render your family tree as a golden-hour poster in Blender.

1. On the tree page, open the "⋯" menu and choose "Export for a Blender poster".
   That downloads a file like the-brand-family-poster.json.
2. From the family-tree project folder, run:

     blender --background --python blender/render_poster.py -- path/to/the-brand-family-poster.json

   Optional extras after the file name:
     --out poster.png      where to save the picture (default: next to the .json)
     --size 3600x4800      pixels (default picks portrait or landscape to suit your tree)
     --samples 64          more = smoother but slower
     --cycles              use Cycles instead of Eevee (slower, more realistic light)

   You can also open this file in Blender's Scripting tab and press Run Script.
   It then uses the newest *-poster.json in your Downloads folder.

Photos are read from instance/uploads, so run it on the computer where Kinroot runs.
To use Kinroot's typeface, put Alegreya-ExtraBold.ttf in blender/fonts/ (free from Google Fonts).

3600 x 4800 pixels prints at 12 x 16 inches (300 dpi) or 18 x 24 inches (200 dpi).
"""
import glob
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_assets as kit  # noqa: E402  (same folder: the medallion, leaves and trunk)

UPLOADS = os.path.normpath(os.path.join(HERE, "..", "instance", "uploads"))
FONT_FILES = glob.glob(os.path.join(HERE, "fonts", "*.ttf")) + glob.glob(os.path.join(HERE, "fonts", "*.otf"))
SUN_DIR = Vector((-0.5, 0.84, 0.2)).normalized()   # same low evening sun as the web app, in Blender's axes


# ------------------------------------------------------------ inputs

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"json": None, "out": None, "size": None, "samples": 64, "cycles": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out":
            opts["out"], i = argv[i + 1], i + 1
        elif a == "--size":
            w, h = argv[i + 1].lower().split("x")
            opts["size"], i = (int(w), int(h)), i + 1
        elif a == "--samples":
            opts["samples"], i = int(argv[i + 1]), i + 1
        elif a == "--cycles":
            opts["cycles"] = True
        elif not opts["json"]:
            opts["json"] = a
        i += 1
    if not opts["json"]:
        found = sorted(glob.glob(os.path.join(os.path.expanduser("~"), "Downloads", "*-poster.json")), key=os.path.getmtime)
        if not found:
            sys.exit("No poster file given, and none found in Downloads. Export one from the tree page first.")
        opts["json"] = found[-1]
    if not opts["out"]:
        opts["out"] = os.path.splitext(opts["json"])[0] + ".png"
    return opts


def b3(p):
    """three.js (x, y-up, z-toward-viewer) -> Blender (x, y-into-screen, z-up)."""
    return Vector((p[0], -p[2], p[1]))


def catmull_rom(points, samples=28):
    """Smooth path through the control points, the same curve shape the web app draws."""
    pts = [Vector(p) for p in points]
    if len(pts) < 2:
        return pts
    ext = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    out = []
    segs = len(pts) - 1
    for s in range(segs):
        p0, p1, p2, p3 = ext[s], ext[s + 1], ext[s + 2], ext[s + 3]
        steps = max(2, samples // segs)
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


# ------------------------------------------------------------ scene pieces

def font():
    if FONT_FILES:
        try:
            return bpy.data.fonts.load(FONT_FILES[0], check_existing=True)
        except RuntimeError:
            pass
    return None


def text(name, body, size, location, mat, col, bold_font=None, align="CENTER"):
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = body
    curve.align_x = align
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = size * 0.03
    if bold_font:
        curve.font = bold_font
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    obj.location = location
    obj.rotation_euler = (math.radians(90), 0, 0)   # stand the text up, facing the camera (-Y)
    col.objects.link(obj)
    return obj


def portrait_material(person):
    photo = person.get("photo")
    path = os.path.join(UPLOADS, photo) if photo else None
    if not path or not os.path.exists(path):
        return None
    mat = bpy.data.materials.new(f"Photo {person['name']}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.75
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size[0] or 1, img.size[1] or 1
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    coords = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    # Crop to a centred square, like a portrait in a locket.
    sx, sy = (h / w, 1.0) if w > h else (1.0, w / h)
    mapping.inputs["Scale"].default_value = (sx, sy, 1)
    mapping.inputs["Location"].default_value = ((1 - sx) / 2, (1 - sy) / 2, 0)
    nt.links.new(coords.outputs["UV"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def instance(name, col, location, target):
    obj = bpy.data.objects.new(name, None)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = col
    obj.location = location
    target.objects.link(obj)
    return obj


def sky_world(scene):
    world = bpy.data.worlds.new("Golden hour")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    try:
        sky = nt.nodes.new("ShaderNodeTexSky")
        for kind in ("NISHITA", "MULTIPLE_SCATTERING", "SINGLE_SCATTERING"):   # names differ across versions
            try:
                sky.sky_type = kind
                break
            except TypeError:
                continue
        if hasattr(sky, "sun_elevation"):
            sky.sun_elevation = math.asin(SUN_DIR.z)
            sky.sun_rotation = math.atan2(SUN_DIR.x, SUN_DIR.y) % (2 * math.pi)
        if hasattr(sky, "sun_intensity"):
            sky.sun_intensity = 0.5
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.32
    except Exception as err:   # fall back to a plain warm gradient colour
        print("  (no sky texture:", err, ")")
        bg.inputs["Color"].default_value = (*kit.linear("#f6c98a"), 1)
        bg.inputs["Strength"].default_value = 0.9


def sun(scene_col):
    light = bpy.data.lights.new("Evening sun", "SUN")
    light.energy = 4.0
    light.color = kit.linear("#ffc27a")
    light.angle = math.radians(2.5)
    obj = bpy.data.objects.new("Evening sun", light)
    obj.rotation_euler = SUN_DIR.to_track_quat("Z", "Y").to_euler()   # a sun lamp shines along its -Z
    scene_col.objects.link(obj)
    fill = bpy.data.lights.new("Fill", "SUN")
    fill.energy = 1.1
    fill.color = kit.linear("#fff0dc")
    fill_obj = bpy.data.objects.new("Fill", fill)
    fill_obj.rotation_euler = Vector((0.3, -1.0, 0.45)).normalized().to_track_quat("Z", "Y").to_euler()
    scene_col.objects.link(fill_obj)


def choose_engine(scene, opts):
    if opts["cycles"]:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = max(opts["samples"], 64)
        scene.cycles.use_denoising = True
        return
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    eevee = scene.eevee
    if hasattr(eevee, "taa_render_samples"):
        eevee.taa_render_samples = opts["samples"]
    for flag in ("use_soft_shadows", "use_gtao", "use_bloom", "use_shadows", "use_raytracing"):
        if hasattr(eevee, flag):
            setattr(eevee, flag, True)


# ------------------------------------------------------------ build and render

def main():
    opts = parse_args()
    with open(opts["json"], encoding="utf-8") as f:
        data = json.load(f)
    people, branches = data.get("people", []), data.get("branches", [])
    if not people:
        sys.exit("That poster file has nobody in it.")
    print(f"Building a poster of “{data.get('tree', 'your family')}” with {len(people)} people...")

    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        bpy.context.window.scene = bpy.data.scenes.new("KinrootPoster")
    scene = bpy.context.scene
    root = scene.collection

    # Parts to copy: built once, hidden, then placed for every person.
    templates = kit.collection("Templates")
    frame = kit.build_person_node(kit.collection("Medallion", templates), with_portrait=False)
    green = kit.build_leaves(kit.collection("Leaves", templates))
    gold = kit.build_leaves(kit.collection("Gold leaves", templates), gold=True, seed=11)
    trunk = kit.build_trunk(kit.collection("Trunk", templates))
    scene.view_layers[0].layer_collection.children["Templates"].exclude = True

    tree = kit.collection("Tree")
    ink = kit.material("Ink", kit.PALETTE["ink"], roughness=0.6)
    paper = kit.material("PortraitPaper", kit.PALETTE["portrait"], roughness=0.8)
    bark = kit.material("Bark", kit.PALETTE["bark"], roughness=0.92)
    vine = kit.material("Vine", "#e3a93f", metallic=0.7, roughness=0.35)
    bold = font()

    scale = data.get("trunk_height", 3.2) / kit.TRUNK_HEIGHT
    trunk_obj = instance("Trunk", trunk, b3(data.get("trunk_position", [0, 0, 0])), tree)
    trunk_obj.scale = (scale, scale, scale)

    for b in branches:
        raw = [b3(p) for p in b["points"]]
        pts = raw if len(raw) > 6 else catmull_rom(raw)   # the app exports already-smooth curves
        curve = bpy.data.curves.new("Branch", type="CURVE")
        curve.dimensions = "3D"
        r0 = b.get("radius", 0.1)
        r1 = b.get("radius_end", r0)
        curve.bevel_depth = r0
        curve.bevel_resolution = 3
        curve.use_fill_caps = True
        spline = curve.splines.new("POLY")
        spline.points.add(len(pts) - 1)
        for i, p in enumerate(pts):
            spline.points[i].co = (p.x, p.y, p.z, 1.0)
            spline.points[i].radius = 1.0 + (r1 / r0 - 1.0) * i / max(1, len(pts) - 1)   # taper like the app
        obj = bpy.data.objects.new("Branch", curve)
        obj.data.materials.append(vine if b["kind"] == "vine" else bark)
        tree.objects.link(obj)

    # Knots where branches meet (so every joint is solid wood, as in the app).
    for k in data.get("knots", []):
        mesh = bpy.data.meshes.new("Knot")
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=k["radius"])
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("Knot", mesh)
        obj.location = b3(k["position"])
        obj.data.materials.append(bark)
        kit.smooth(obj)
        tree.objects.link(obj)

    lowest, highest = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for p in people:
        loc = b3(p["position"])
        lowest = Vector(map(min, lowest, loc))
        highest = Vector(map(max, highest, loc))
        instance(f"Leaves {p['name']}", gold if p.get("departed") else green, loc, tree)
        instance(f"Medallion {p['name']}", frame, loc, tree)
        photo = portrait_material(p)
        disc = kit.make_portrait(f"Portrait {p['name']}", photo or paper)
        disc.location = loc
        tree.objects.link(disc)
        if photo is None:
            text(f"Initials {p['name']}", p.get("initials", "?"), 0.46, loc + Vector((0, -0.03, -0.02)), ink, tree, bold)
        text(f"Name {p['name']}", p["name"], 0.24, loc + Vector((0, -0.05, -1.02)), ink, tree, bold)
        if p.get("lifespan"):
            text(f"Years {p['name']}", p["lifespan"], 0.16, loc + Vector((0, -0.05, -1.3)), ink, tree)

    # Ground
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "Ground"
    ground.data.materials.append(kit.material("Meadow", "#5c7440", roughness=1))
    kit.link_to(ground, tree)

    # Title above the crown
    top = highest.z + 2.2
    centre_x = (lowest.x + highest.x) / 2
    title_mat = kit.material("Title", "#1b3326", roughness=0.5)
    text("Title", data.get("tree", "Our family"), 1.1, Vector((centre_x, lowest.y - 1.5, top)), title_mat, tree, bold)
    years = [int(s[:4]) for s in (p.get("lifespan", "") for p in people) if s[:4].isdigit()]
    if years:
        text("Subtitle", f"{min(years)} – today  ·  {len(people)} people", 0.42,
             Vector((centre_x, lowest.y - 1.5, top - 1.05)), title_mat, tree)

    sky_world(scene)
    sun(root)

    # Camera framing the whole tree, title included
    width = max(highest.x - lowest.x, 4) + 5
    height = (top + 1.2) + 1.0
    if opts["size"]:
        rx, ry = opts["size"]
    else:
        rx, ry = (4800, 3600) if width > height * 1.1 else (3600, 4800)
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 50
    cam = bpy.data.objects.new("Camera", cam_data)
    root.objects.link(cam)
    scene.camera = cam
    aspect = rx / ry
    fov = 2 * math.atan(cam_data.sensor_width / (2 * cam_data.lens))   # horizontal field of view
    # With the default "Auto" sensor fit, the sensor width covers the longer side of the picture.
    v_fov = 2 * math.atan(math.tan(fov / 2) / aspect) if aspect >= 1 else fov
    h_fov = fov if aspect >= 1 else 2 * math.atan(math.tan(fov / 2) * aspect)
    dist = max((height / 2) / math.tan(v_fov / 2), (width / 2) / math.tan(h_fov / 2)) * 1.05
    target = Vector((centre_x, (lowest.y + highest.y) / 2, height / 2 - 0.4))
    cam.location = target + Vector((dist * 0.08, -dist, dist * 0.05))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = rx, ry, 100
    r.image_settings.file_format = "PNG"
    r.filepath = opts["out"]
    choose_engine(scene, opts)
    for view in ("AgX", "Filmic"):
        try:
            scene.view_settings.view_transform = view
            break
        except TypeError:
            continue

    print(f"Rendering {rx} x {ry} with {scene.render.engine.replace('BLENDER_', '').replace('_NEXT', '').title()}... this can take a few minutes.")
    bpy.ops.render.render(write_still=True)
    print(f"Saved your poster: {opts['out']}")


if __name__ == "__main__":
    main()
