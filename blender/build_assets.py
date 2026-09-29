"""Build Kinroot's 3D models in Blender and export them for the web app.

How to run (from the family-tree project folder, in a terminal):

    blender --background --python blender/build_assets.py

Or open Blender, go to the Scripting tab, open this file and press Run Script.

It writes three files into static/models/:
    person_node.glb  - the brass medallion each person hangs in (the photo goes on "Portrait")
    trunk.glb        - the tree trunk at the bottom of the scene
    leaves.glb       - the ring of leaves behind each medallion
and saves kinroot_assets.blend so you can reshape things by hand.

The web app uses the SHAPES from these files. Colours come from the app, so
everything matches the golden-hour look (and leaves can turn gold in the
time-lapse). After editing the .blend, export each collection again with
File > Export > glTF 2.0 (Format: glTF Binary, Limit to: Selected Objects),
keeping the same file names.

Rules the web app relies on:
  * Blender units = web units. The trunk's base is at the origin (the app scales it to 3.2 tall).
  * The medallion faces Blender's -Y (toward the Front view), about 0.62 in radius.
  * The photo goes on the object named exactly "Portrait", which needs a UV map.
  * Leaves sit just behind the medallion (+Y).

render_poster.py reuses the functions below to build a printable poster.
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "static", "models"))
TRUNK_HEIGHT = 3.2

PALETTE = {
    "brass": "#c9973f", "portrait": "#f3ead3", "bark": "#6b4a2f", "ink": "#1b3326",
    "greens": ["#4e7f3c", "#6a9a4c", "#86b268", "#3f6b33", "#5b8c43"],
    "golds": ["#d9a441", "#e8bb58", "#c68b2d", "#f0c96d", "#dba64a"],
}


# ------------------------------------------------------------ helpers

def linear(hex_color):
    """'#b8893a' -> linear RGB, which is what Blender materials expect."""
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def material(name, hex_color, metallic=0.0, roughness=0.6, emission=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*linear(hex_color), 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        for key in ("Emission Color", "Emission"):       # the name changed in Blender 4.0
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*linear(hex_color), 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def collection(name, parent=None):
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col


def link_to(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def smooth(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True


def apply_transforms(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


# ------------------------------------------------------------ models

def build_person_node(col, with_portrait=True):
    """Brass ring, back plate and hook, facing -Y. Optionally the Portrait disc."""
    brass = material("Brass", PALETTE["brass"], metallic=0.85, roughness=0.3)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.085, major_segments=64,
                                     minor_segments=16, rotation=(math.pi / 2, 0, 0))
    ring = bpy.context.active_object
    ring.name = "Frame"
    ring.data.materials.append(brass)
    smooth(ring)
    apply_transforms(ring)
    link_to(ring, col)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.6, depth=0.04, vertices=64,
                                        rotation=(math.pi / 2, 0, 0), location=(0, 0.035, 0))
    back = bpy.context.active_object
    back.name = "BackPlate"
    back.data.materials.append(brass)
    apply_transforms(back)
    link_to(back, col)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.1, minor_radius=0.026, location=(0, 0, 0.77),
                                     rotation=(0, math.pi / 2, 0))
    hook = bpy.context.active_object
    hook.name = "Hook"
    hook.data.materials.append(brass)
    smooth(hook)
    apply_transforms(hook)
    link_to(hook, col)

    if with_portrait:
        portrait = make_portrait("Portrait", material("PortraitPaper", PALETTE["portrait"], roughness=0.8))
        col.objects.link(portrait)
    return col


def make_portrait(name, mat):
    """A flat disc facing -Y, with UVs that map a square photo onto it."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    radius, segments = 0.56, 64
    center = bm.verts.new((0, -0.012, 0))
    ring = [bm.verts.new((radius * math.cos(a), -0.012, radius * math.sin(a)))
            for a in (2 * math.pi * i / segments for i in range(segments))]
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for i in range(segments):
        face = bm.faces.new((center, ring[i], ring[(i + 1) % segments]))   # this order faces -Y (the front)
        for loop in face.loops:
            x, _, z = loop.vert.co
            loop[uv_layer].uv = (0.5 + x / (2 * radius), 0.5 + z / (2 * radius))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    return obj


def leaf_mesh(name, length=0.74, width=0.21):
    """One pointed, slightly cupped leaf lying along +Z from the origin, in the XZ plane."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    steps = 8
    left, right = [], []
    for i in range(1, steps):
        t = i / steps
        half = math.sin(math.pi * t) ** 0.8 * width
        cup = -0.035 * math.sin(math.pi * t)
        left.append(bm.verts.new((-half, cup, t * length)))
        right.append(bm.verts.new((half, cup, t * length)))
    base = bm.verts.new((0, 0, 0))
    tip = bm.verts.new((0, 0, length))
    outline = [base] + right + [tip] + list(reversed(left))
    bm.faces.new(outline)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def build_leaves(col, gold=False, seed=7):
    """Two rings of leaves behind the medallion. gold=True for relatives who've passed away."""
    rand = random.Random(seed)
    colors = PALETTE["golds"] if gold else PALETTE["greens"]
    mats = [material(f"{'Gold' if gold else 'Leaf'}{i}", c, roughness=0.7) for i, c in enumerate(colors)]
    for ring, (count, radius, size, depth) in enumerate(((10, 0.6, 1.05, 0.12), (12, 0.5, 0.78, 0.07))):
        for k in range(count):
            a = k / count * 2 * math.pi + (0.26 if ring else 0) + rand.uniform(-0.1, 0.1)
            obj = bpy.data.objects.new(f"Leaf{ring}_{k}", leaf_mesh(f"LeafMesh{ring}_{k}"))
            obj.data.materials.append(rand.choice(mats))
            scale = size * rand.uniform(0.85, 1.15)
            obj.scale = (scale, scale, scale)
            # Point the leaf outward (angle a in the XZ plane) with a little random tilt.
            obj.rotation_euler = (rand.uniform(-0.35, 0.35), -(a - math.pi / 2) + rand.uniform(-0.17, 0.17),
                                  rand.uniform(-0.35, 0.35))
            obj.location = (math.cos(a) * radius, depth, math.sin(a) * radius)
            col.objects.link(obj)
    return col


def build_trunk(col, seed=3):
    rand = random.Random(seed)
    bark = material("Bark", PALETTE["bark"], roughness=0.92)
    bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=TRUNK_HEIGHT, vertices=28,
                                        location=(0, 0, TRUNK_HEIGHT / 2))
    trunk = bpy.context.active_object
    trunk.name = "Trunk"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=10)
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in trunk.data.vertices:
        t = v.co.z / TRUNK_HEIGHT + 0.5                        # 0 at the base, 1 at the top
        taper = 0.95 - 0.58 * t + 0.5 * (1 - t) ** 6
        twist = t * 0.6
        x, y = v.co.x, v.co.y
        x, y = x * math.cos(twist) - y * math.sin(twist), x * math.sin(twist) + y * math.cos(twist)
        bump = 1 + rand.uniform(-0.05, 0.05)
        v.co.x, v.co.y = x * taper * bump, y * taper * bump
    trunk.data.materials.append(bark)
    smooth(trunk)
    link_to(trunk, col)
    for i in range(6):
        angle = i / 6 * 2 * math.pi + rand.uniform(-0.25, 0.25)
        length = rand.uniform(1.8, 2.7)
        bpy.ops.mesh.primitive_cone_add(radius1=0.3, radius2=0.03, depth=length, vertices=10)
        root = bpy.context.active_object
        root.name = f"Root{i}"
        root.rotation_euler = (0, math.radians(81), angle)
        reach = 0.5 + length / 2
        root.location = (math.cos(angle) * reach, math.sin(angle) * reach, 0.2)
        root.data.materials.append(bark)
        smooth(root)
        apply_transforms(root)
        link_to(root, col)
    return col


def export_collection(col, filename):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in col.all_objects:
        obj.select_set(True)
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True)
    print(f"  wrote {path}")


def reset_scene():
    """Start from an empty scene without touching anything you have open."""
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:   # run from Blender's Scripting tab: build in a fresh scene instead
        bpy.context.window.scene = bpy.data.scenes.new("KinrootAssets")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    reset_scene()
    print("Building Kinroot models...")
    person = build_person_node(collection("PersonNode"))
    trunk = build_trunk(collection("Trunk"))
    leaves = build_leaves(collection("Leaves"))
    export_collection(person, "person_node.glb")
    export_collection(trunk, "trunk.glb")
    export_collection(leaves, "leaves.glb")
    if bpy.app.background:
        blend_path = os.path.join(HERE, "kinroot_assets.blend")
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        print(f"  saved {blend_path}")
    print("Done. Refresh the tree page in your browser to see the new models.")


if __name__ == "__main__":
    main()
