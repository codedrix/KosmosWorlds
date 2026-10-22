/**
 * mock-host.mjs -- runs a built world.wasm the way the headset would, for the
 * level-5 (text input) and level-6 (the visual pack) checkpoint worlds.
 *
 * @kosmos-system  Content (KosmosWorlds) -- the level-5/6 checkpoint worlds
 * @kosmos-owner   KOS-699 (builder vp-w1, 2026-10-22). Pattern: more-room/tools/mock-host.mjs.
 *                 The same file ships in type-test/tools and visual-pack-check/tools (a world
 *                 folder is self-contained); keep the two copies identical.
 *
 * This is a model of the client, not the client. Every rule below names its
 * source in kosmos-client feat/device-p2-2026-10 at a1936d8 (level 6; the
 * text-input code is unchanged since 944abfa, Build 1013):
 *
 *   scene      k_node_find sees only nodes WITH A MESH, names collapse a trailing
 *              `_<digits>` (KWorldResolverSubsystem); a press walks up the attach
 *              parents to the first node with an OnInteract subscription (KOS-220).
 *   text       k_ui_show_world_text(_ex): 1..128 bytes, 4 lines, -7 otherwise; a
 *              pool of `maxTexts` (32 on a level-5 client, 64 at level 6,
 *              KWasm::MAX_WORLD_TEXT), -5 when full; _ex: alpha must be 0xFF, size
 *              0 or 10..160, flags align 0-2 | strong 4 | plate 8 | engine 16, strong
 *              with engine refused, all -7 (KDomUI.cpp ValidateWorldTextExArgs).
 *   input      k_ui_text_begin in the host's order: -1 node, -2 ui_basic, -3 start
 *              text, -7 flags/caps (ValidateBeginArgs), -8 multi-line, -11 no fresh
 *              press and no live Enter re-arm (a press opens at most one keyboard),
 *              -6 a session open or one began < 1 s ago. Masked forces the password
 *              keyboard whatever the layout (KeyboardKindFor). Typed text is cut at
 *              the cap on a code-point boundary (CleanTypedText). OnTextInput: at most
 *              one "1" a tick, then the end code; the text stays readable until the
 *              first tick after the end; k_ui_text_end ends with no event.
 *   activation k_world_navigate needs a local press in the last 5 s (-11); an Enter
 *              re-arms text input only and stamps nothing; hover never stamps.
 *   material   Begin -1/-2/-7 (a mesh, a slot in range), argument -7, the 64 writes a
 *              frame -6 (reset counts but is never refused), -8 (no base colour; glow
 *              on an unlit material; opacity on a non-BLEND one; a picture without
 *              UV0), the 256 (node, slot) instances -5 (KDomMaterial.cpp).
 *   pictures   assets.images[] decoded at load, 1024 px a side, 24 MiB decoded in all
 *              (w x h x 4), 16 entries; k_texture_set_bundle -4 for anything else
 *              (KBundleImages.cpp).
 *   hover      OnHoverEnter after a 60 ms rest on a press target, OnHoverExit 60 ms
 *              after leaving it, per hand (param2 0 left, 1 right); 10 Enters a
 *              second with bursts of 10; an Exit at once when the menu opens and no
 *              Enter while it is up; only when the world subscribes a hover event
 *              (KWorldHoverSubsystem.h, RESOLVE_SPEC 10.10.4).
 *   travel     at travel start every material override and picture is released and
 *              recorded; a refused or cancelled travel gives them back, a parameter
 *              the world wrote meanwhile keeps the newer value and a reset pair stays
 *              reset (FKMaterialOverrides::CaptureForTravel / RestoreAfterStoppedTravel).
 *
 * What it does NOT model: rendering, depth, the real laser and hands, the OS
 * keyboard, the shroud, focus. Those are the device checkpoint's.
 */

import fs from "node:fs";

export const LIMITS = Object.freeze({
  textBytes: 128,
  textLines: 4,
  activationS: 5,
  rearmS: 5,
  beginIntervalS: 1,
  plainMax: 512,
  maskedMax: 128,
  materialInstances: 256,
  materialWritesPerFrame: 64,
  images: 16,
  imageSide: 1024,
  imageBudget: 24 * 1024 * 1024,
  hoverDwellS: 0.06,
  hoverExitS: 0.06,
  hoverRate: 10,
  hoverBurst: 10,
  maxCreated: 128,
  createsPerFrame: 16,
});

/** Parse a GLB's JSON chunk. */
export function readGlb(path) {
  const b = fs.readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
}

const collapse = (name) => name.replace(/_\d+$/, "");

/** Cut UTF-8 text to max bytes on a code-point boundary (CleanTypedText, after control characters go). */
export function cleanTyped(raw, max) {
  const isDropped = (cp) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
  const s = [...raw].filter((ch) => !isDropped(ch.codePointAt(0))).join("");
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** PNG or JPEG pixel size from the header (the client reads it before decoding). */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p < buf.length) {
      if (buf[p] !== 0xff) return null;
      const m = buf[p + 1];
      const len = buf.readUInt16BE(p + 2);
      if (m >= 0xc0 && m <= 0xc2) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
      p += 2 + len;
    }
  }
  return null;
}

export class Host {
  /**
   * @param wasmPath   world.wasm
   * @param glbPath    world.glb (the source, or the bundle's optimized scene)
   * @param manifest   the parsed manifest.json
   * @param level      the client's host API level (5: Build 1013; 6: the visual-pack cook)
   * @param images     { "<declared path>": Buffer } (assets.images[] bytes)
   */
  constructor({ wasmPath, glbPath, manifest, level = 6, images = {} }) {
    this.manifest = manifest;
    this.level = level;
    this.maxTexts = level >= 6 ? 64 : 32;
    this.time = 0;
    this.frame = 0;
    this.events = [];
    this.caps = new Set(manifest.capabilities ?? []);
    // --- scene
    this.nodes = new Map();
    this.byName = new Map();
    const gltf = readGlb(glbPath);
    this.gltf = gltf;
    const parentOf = new Map();
    gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
    let h = 1;
    const handleOfIndex = new Map();
    gltf.nodes.forEach((n, i) => {
      const prims = n.mesh !== undefined ? gltf.meshes[n.mesh].primitives : [];
      const mats = prims.map((p) => (p.material !== undefined ? gltf.materials[p.material] : {}));
      const node = {
        index: i,
        handle: h++,
        name: collapse(n.name ?? ""),
        mesh: n.mesh !== undefined,
        meshIndex: n.mesh,
        pos: [...(n.translation ?? [0, 0, 0])],
        visible: true,
        created: false,
        alive: true,
        extras: n.extras ?? {},
        yaw: 2 * Math.atan2((n.rotation ?? [0, 0, 0, 1])[1], (n.rotation ?? [0, 0, 0, 1])[3]),
        boxes: prims.map((p) => {
          const a = gltf.accessors[p.attributes.POSITION];
          return { lo: a.min, hi: a.max, invisible: (p.material !== undefined && gltf.materials[p.material].alphaMode === "BLEND" && (gltf.materials[p.material].pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1])[3] === 0) };
        }),
        slots: mats.map((m, s) => ({
          name: m.name ?? `slot${s}`,
          unlit: !!m.extensions?.KHR_materials_unlit,
          blend: m.alphaMode === "BLEND",
          uv0: prims[s].attributes.TEXCOORD_0 !== undefined,
        })),
      };
      handleOfIndex.set(i, node.handle);
      this.nodes.set(node.handle, node);
      if (!this.byName.has(node.name)) this.byName.set(node.name, node);
    });
    for (const [c, p] of parentOf) this.nodes.get(handleOfIndex.get(c)).parent = handleOfIndex.get(p);
    this.nextHandle = h;
    this.created = 0;
    this.createsThisFrame = 0;
    // --- text
    this.texts = new Map(); // handle -> {text, offset, style}
    this.textRefusals = [];
    this.textPeak = 0;
    // --- events
    this.subs = new Map();
    this.nextSub = 1;
    this.lastPress = -1e9;
    // --- text input
    this.ti = { session: null, lastBegin: -1e9, consumedPress: -1, rearm: -1e9, deliveries: [], keyboards: [] };
    // --- materials
    this.mat = new Map(); // "h:s" -> {color, emissive, strength, opacity, texture}
    this.matWrites = 0;
    this.matCreated = 0;
    this.travelCapture = null;
    this.travelWrites = new Map();
    // --- pictures
    this.images = new Map();
    this.imageBytes = 0;
    for (const p of manifest.assets?.images ?? []) {
      if (this.images.size >= LIMITS.images) break;
      const buf = images[p];
      if (!buf) continue;
      const sz = imageSize(buf);
      if (!sz || sz.w > LIMITS.imageSide || sz.h > LIMITS.imageSide) continue;
      const cost = sz.w * sz.h * 4;
      if (this.imageBytes + cost > LIMITS.imageBudget) continue;
      this.imageBytes += cost;
      this.images.set(p, sz);
    }
    // --- hover
    this.hover = [0, 1].map(() => ({ on: null, since: 0, entered: null, offSince: null }));
    this.hoverBucket = LIMITS.hoverBurst;
    this.menuOpen = false;
    this.navigations = [];

    const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
    this.imports = WebAssembly.Module.imports(module);
    const memImport = this.imports.find((i) => i.kind === "memory");
    if (!memImport) throw new Error("WASM_006: the module must import its memory");
    this.memory = new WebAssembly.Memory({ initial: 17, maximum: 128 });
    const kosmos = this.hostFunctions();
    const want = {};
    for (const i of this.imports) {
      if (i.kind !== "function") continue;
      if (!kosmos[i.name]) throw new Error(`import ${i.module}.${i.name} is not modelled`);
      (want[i.module] ??= {})[i.name] = kosmos[i.name];
    }
    want[memImport.module] = { ...(want[memImport.module] ?? {}), [memImport.name]: this.memory };
    this.instance = new WebAssembly.Instance(module, want);
    this.table = this.instance.exports.__indirect_function_table;
    if (!this.table) throw new Error("WASM_008: no exported table");
  }

  bytes(ptr, len) {
    return Buffer.from(new Uint8Array(this.memory.buffer, ptr >>> 0, len >>> 0));
  }
  str(ptr, len) {
    return this.bytes(ptr, len).toString("utf8");
  }
  call(fnIndex, ...args) {
    const f = this.table.get(fnIndex);
    if (!f) throw new Error(`no function at table index ${fnIndex}`);
    f(...args);
  }
  subsFor(name, node) {
    return [...this.subs.values()].filter((s) => s.name === name && (s.node === 0 || s.node === node));
  }
  /** The press target: the node or the first attach ancestor with an OnInteract subscription. */
  pressTarget(handle) {
    let n = this.nodes.get(handle);
    for (let depth = 0; n && depth < 64; depth++) {
      if ([...this.subs.values()].some((s) => s.name === "OnInteract" && s.node === n.handle)) return n;
      n = n.parent ? this.nodes.get(n.parent) : null;
    }
    return null;
  }
  hasCap(c) {
    return this.caps.has(c);
  }

  hostFunctions() {
    const H = this;
    const node = (h) => {
      const n = H.nodes.get(h);
      return n && n.alive ? n : null;
    };
    const showText = (h, p, l, off, style) => {
      if (!H.hasCap("ui_basic")) return -2;
      const n = node(h);
      if (!n) return -1;
      if (l < 1 || l > LIMITS.textBytes || !Number.isFinite(off)) return -7;
      if (style.err) return -7;
      // KWasmText.cpp class G: the 4th line feed onwards becomes a space (never refused).
      const parts = H.str(p, l).split("\n");
      const text = parts.length > LIMITS.textLines ? parts.slice(0, LIMITS.textLines - 1).join("\n") + "\n" + parts.slice(LIMITS.textLines - 1).join(" ") : parts.join("\n");
      if (!H.texts.has(h) && H.texts.size >= H.maxTexts) {
        H.textRefusals.push({ node: n.name, reason: "pool full", text });
        return -5;
      }
      const prev = H.texts.get(h);
      H.texts.set(h, { text, offset: prev ? prev.offset : Math.min(5, Math.max(0, off)), style });
      H.textPeak = Math.max(H.textPeak, H.texts.size);
      return 0;
    };
    const exStyle = (rgba, size, flags) => {
      const u = rgba >>> 0;
      const align = flags & 3;
      const err = (u & 0xff) !== 0xff || (size !== 0 && (size < 10 || size > 160)) || (flags & ~(3 | 4 | 8 | 16)) !== 0 || ((flags & 4) && (flags & 16)) || align === 3;
      return { err, color: (u >>> 8).toString(16).padStart(6, "0"), sizeMm: size === 0 ? 80 : size, align: ["center", "left", "right"][align] ?? "?", strong: !!(flags & 4), plate: !!(flags & 8), engine: !!(flags & 16) };
    };
    const matBegin = (h, s) => {
      const n = node(h);
      if (!n) return [-1];
      if (!H.hasCap("scene_write")) return [-2];
      if (!n.mesh || s < 0 || s >= n.slots.length) return [-7];
      return [0, n, n.slots[s]];
    };
    const instance = (h, s) => {
      const key = `${h}:${s}`;
      if (H.mat.has(key)) return [0, H.mat.get(key)];
      if (H.mat.size >= LIMITS.materialInstances) return [-5];
      const e = {};
      H.mat.set(key, e);
      H.matCreated++;
      return [0, e];
    };
    const noteTravel = (h, s, bit) => {
      if (!H.travelCapture) return;
      const key = `${h}:${s}`;
      H.travelWrites.set(key, (H.travelWrites.get(key) ?? 0) | bit);
    };
    return {
      k_node_find(p, l) {
        if (!H.hasCap("scene_read")) return -2;
        const n = H.byName.get(collapse(H.str(p, l)));
        return n && n.alive && n.mesh ? n.handle : 0;
      },
      k_node_set_visible(h, v) {
        const n = node(h);
        if (!n) return -1;
        n.visible = !!v;
        return 0;
      },
      k_node_clone(src, parent, p, l) {
        const s = node(src);
        if (!s || !s.mesh) return -1;
        const name = H.str(p, l);
        if (!name || name.length > 64 || H.byName.has(collapse(name)) || /_\d+$/.test(name)) return -7;
        if (H.created >= LIMITS.maxCreated) return -5;
        if (H.createsThisFrame >= LIMITS.createsPerFrame) return -6;
        H.createsThisFrame++;
        H.created++;
        // A copy starts with the authored materials, never the source's overrides (KDomSceneGraph.cpp).
        const n = { ...s, handle: H.nextHandle++, name, pos: [...s.pos], created: true, alive: true, source: s.name, slots: s.slots.map((x) => ({ ...x })) };
        H.nodes.set(n.handle, n);
        H.byName.set(name, n);
        return n.handle;
      },
      k_transform_set_position(h, x, y, z) {
        if (!H.hasCap("transform")) return -2;
        if (![x, y, z].every(Number.isFinite)) return -7;
        const n = node(h);
        if (!n) return -1;
        if ([x, y, z].some((v) => Math.abs(v) > 1000)) return -3;
        // World position; the writers only parent created copies at the root, so local = world there.
        n.pos = [x, y, z];
        return 0;
      },
      k_transform_get_position(h, px, py, pz) {
        if (!H.hasCap("scene_read")) return -2;
        const n = node(h);
        if (!n) return -1;
        const w = H.worldOf(n).pos;
        const f = new Float32Array(H.memory.buffer);
        f[px >>> 2] = w[0];
        f[py >>> 2] = w[1];
        f[pz >>> 2] = w[2];
        return 0;
      },
      k_ui_show_world_text(h, p, l, off) {
        return showText(h, p, l, off, { color: "ffffff", sizeMm: 80, align: "center", strong: false, plate: false, engine: true });
      },
      k_ui_show_world_text_ex(h, p, l, off, rgba, size, flags) {
        if (H.level < 6) throw new Error("k_ui_show_world_text_ex on a level-5 client: the import would not link");
        return showText(h, p, l, off, exStyle(rgba, size, flags));
      },
      k_ui_hide_world_text(h) {
        H.texts.delete(h);
        return 0;
      },
      k_event_subscribe(p, l, h, fn) {
        if (!H.hasCap("events")) return -2;
        if (!node(h)) return -1;
        const id = H.nextSub++;
        H.subs.set(id, { name: H.str(p, l), node: h, fn });
        return id;
      },
      k_event_subscribe_global(p, l, fn) {
        if (!H.hasCap("events")) return -2;
        const id = H.nextSub++;
        H.subs.set(id, { name: H.str(p, l), node: 0, fn });
        return id;
      },
      k_event_unsubscribe(id) {
        return H.subs.delete(id) ? 0 : -1;
      },
      k_api_version() {
        return H.level;
      },
      k_world_navigate(p, l) {
        if (!H.hasCap("world_navigate")) return -2;
        const url = H.str(p, l);
        if (H.time - H.lastPress > LIMITS.activationS) {
          H.navigations.push({ t: H.time, url, rc: -11 });
          return -11;
        }
        H.navigations.push({ t: H.time, url, rc: 0 });
        H.pendingTravel = { url, t: H.time };
        return 0;
      },
      // --- level 5: world text input
      k_ui_text_begin(h, flags, max, ip, il, req) {
        const n = node(h);
        if (!n) return -1;
        if (!H.hasCap("ui_basic")) return -2;
        if (il < 0) return -3;
        const masked = (flags & 1) !== 0;
        const layout = (flags >> 4) & 0xf;
        if ((flags & ~(1 | 2 | (0xf << 4))) !== 0 || layout > 3) return -7;
        if (max < 1 || max > (masked ? LIMITS.maskedMax : LIMITS.plainMax)) return -7;
        if (masked && il > 0) return -7;
        if (il > max) return -7;
        if (flags & 2) return -8;
        const ti = H.ti;
        const freshPress = H.time - H.lastPress <= LIMITS.activationS && ti.consumedPress !== H.lastPress;
        const liveRearm = H.time - ti.rearm <= LIMITS.rearmS;
        if (!freshPress && !liveRearm) return -11;
        if ((ti.session && ti.session.phase === "open") || H.time - ti.lastBegin < LIMITS.beginIntervalS) return -6;
        if (freshPress) ti.consumedPress = H.lastPress;
        else ti.rearm = -1e9;
        ti.lastBegin = H.time;
        const keyboard = masked ? "password" : ["text", "email", "number", "web"][layout];
        const init = il > 0 ? cleanTyped(H.str(ip, il), max) : "";
        ti.session = { req, node: h, masked, max, text: init, phase: "open", changed: false, endCode: 0, delivered: false, keyboard };
        ti.keyboards.push({ t: H.time, req, keyboard, masked, max });
        return 0;
      },
      k_ui_text_read(req, out, cap) {
        if (!H.hasCap("ui_basic")) return -2;
        if (cap < 0) return -3;
        const s = H.ti.session;
        if (!s || s.req !== req || s.phase === "idle") return -7;
        const b = Buffer.from(s.text, "utf8");
        if (cap > 0) new Uint8Array(H.memory.buffer, out, Math.min(cap, b.length)).set(b.subarray(0, Math.min(cap, b.length)));
        return b.length;
      },
      k_ui_text_end(req) {
        if (!H.hasCap("ui_basic")) return -2;
        const s = H.ti.session;
        if (!s || s.req !== req || s.phase !== "open") return -7;
        s.phase = "ended";
        s.endCode = 0;
        s.delivered = true; // no event owed
        s.endedByWorld = true;
        H.events.push({ t: H.time, kind: "text_end", req });
        return 0;
      },
      // --- level 6: materials and pictures
      k_material_set_color(h, s, rgba) {
        const [r, , slot] = matBegin(h, s);
        if (r) return r;
        if (((rgba >>> 0) & 0xff) !== 0xff) return -7;
        if (H.matWrites >= LIMITS.materialWritesPerFrame) return -6;
        const [q, e] = instance(h, s);
        if (q) return q;
        e.color = ((rgba >>> 0) >>> 8).toString(16).padStart(6, "0");
        H.matWrites++;
        noteTravel(h, s, 1);
        void slot;
        return 0;
      },
      k_material_set_emissive(h, s, rgb, strength) {
        const [r, , slot] = matBegin(h, s);
        if (r) return r;
        if (((rgb >>> 0) & 0xff000000) !== 0 || !Number.isFinite(strength)) return -7;
        if (H.matWrites >= LIMITS.materialWritesPerFrame) return -6;
        if (slot.unlit) return -8;
        const [q, e] = instance(h, s);
        if (q) return q;
        e.emissive = (rgb >>> 0).toString(16).padStart(6, "0");
        e.strength = Math.min(1, Math.max(0, strength));
        H.matWrites++;
        noteTravel(h, s, 4);
        return 0;
      },
      k_material_set_opacity(h, s, o) {
        const [r, , slot] = matBegin(h, s);
        if (r) return r;
        if (!Number.isFinite(o)) return -7;
        if (H.matWrites >= LIMITS.materialWritesPerFrame) return -6;
        if (!slot.blend) return -8;
        const [q, e] = instance(h, s);
        if (q) return q;
        e.opacity = Math.min(1, Math.max(0, o));
        H.matWrites++;
        noteTravel(h, s, 2);
        return 0;
      },
      k_material_reset(h, s) {
        const [r] = matBegin(h, s);
        if (r) return r;
        H.mat.delete(`${h}:${s}`);
        H.matWrites++;
        noteTravel(h, s, 16);
        return 0;
      },
      k_texture_set_bundle(h, s, p, l) {
        const [r, , slot] = matBegin(h, s);
        if (r) return r;
        if (l <= 0 || l > 1024) return -7;
        if (H.matWrites >= LIMITS.materialWritesPerFrame) return -6;
        const path = H.str(p, l);
        if (!H.images.has(path)) return -4;
        if (!slot.uv0) return -8;
        const [q, e] = instance(h, s);
        if (q) return q;
        e.texture = path;
        e.color = "ffffff";
        H.matWrites++;
        noteTravel(h, s, 8 | 1);
        return 0;
      },
    };
  }

  init() {
    this.instance.exports.k_init();
  }

  /** One frame (1/72 s by default). */
  tick(dt = 1 / 72) {
    this.frame++;
    this.time += dt;
    this.createsThisFrame = 0;
    this.matWrites = 0;
    // BeginFrame: an ended session whose end went out (or owed nothing) stops being readable.
    const s = this.ti.session;
    if (s && s.phase === "ended" && s.delivered) this.ti.session = { ...s, phase: "idle" };
    this.serviceHover(dt);
    this.instance.exports.k_tick(dt);
    // CollectDeliveries: at most one "changed", then the end code.
    const t = this.ti.session;
    if (t && (t.phase === "open" || (t.phase === "ended" && !t.delivered))) {
      const out = [];
      if (t.changed) {
        out.push(1);
        t.changed = false;
      }
      if (t.phase === "ended" && !t.delivered) {
        out.push(t.endCode);
        t.delivered = true;
      }
      for (const code of out) {
        this.events.push({ t: this.time, kind: "text_event", req: t.req, code });
        for (const sub of this.subsFor("OnTextInput", t.node)) this.call(sub.fn, 0, t.node, t.req, code);
      }
    }
  }

  run(seconds, dt = 1 / 72) {
    const end = this.time + seconds;
    while (this.time < end - 1e-9) this.tick(dt);
  }

  /** A node's world transform (translation + yaw about +Y; the writers use nothing else). */
  worldOf(n) {
    const chain = [];
    for (let m = n; m; m = m.parent ? this.nodes.get(m.parent) : null) chain.unshift(m);
    let pos = [0, 0, 0];
    let yaw = 0;
    for (const m of chain) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      // glTF yaw about +Y: x' = x cos + z sin, z' = -x sin + z cos.
      pos = [pos[0] + m.pos[0] * c + m.pos[2] * s, pos[1] + m.pos[1], pos[2] - m.pos[0] * s + m.pos[2] * c];
      yaw += m.yaw;
    }
    return { pos, yaw };
  }
  /** A point in a node's local frame, in world space. */
  toWorld(n, p) {
    const { pos, yaw } = this.worldOf(n);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [pos[0] + p[0] * c + p[2] * s, pos[1] + p[1], pos[2] - p[0] * s + p[2] * c];
  }
  /** The middle of a node's first visible box, in world space. */
  centerOf(n) {
    const b = n.boxes.find((x) => !x.invisible) ?? n.boxes[0];
    return this.toWorld(n, b.lo.map((v, k) => (v + b.hi[k]) / 2));
  }
  /**
   * The laser, approximated: a ray from the visitor's eye (standing at `eye`) to the
   * target's middle. Returns the node of the first visible box it enters (per
   * primitive, so a ring's hole is a hole: the client collides per triangle).
   */
  firstHit(target, eye = [0, 1.62, 0]) {
    const to = this.centerOf(target);
    const d = to.map((v, i) => v - eye[i]);
    let best = null;
    for (const n of this.nodes.values()) {
      if (!n.alive || !n.visible || !n.mesh) continue;
      const { pos, yaw } = this.worldOf(n);
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      const rel = eye.map((v, i) => v - pos[i]);
      const lo0 = [rel[0] * c + rel[2] * s, rel[1], -rel[0] * s + rel[2] * c];
      const ld = [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
      for (const b of n.boxes) {
        if (b.hi.every((v, k) => v - b.lo[k] < 0.012)) continue; // text studs
        let t0 = 0, t1 = 1.0001, hit = true;
        for (let k = 0; k < 3 && hit; k++) {
          if (Math.abs(ld[k]) < 1e-12) {
            if (lo0[k] < b.lo[k] || lo0[k] > b.hi[k]) hit = false;
          } else {
            let ta = (b.lo[k] - lo0[k]) / ld[k], tb = (b.hi[k] - lo0[k]) / ld[k];
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) hit = false;
          }
        }
        if (hit && (!best || t0 < best.t)) best = { t: t0, node: n };
      }
    }
    return best?.node ?? null;
  }

  /** The visitor presses a node (by name or handle). opts.eye: where they stand; opts.noRay: skip the laser check. */
  press(which, opts = {}) {
    const n = typeof which === "number" ? this.nodes.get(which) : this.byName.get(which);
    if (!n || !n.alive) throw new Error(`press: no node ${which}`);
    if (!n.visible) throw new Error(`press: ${n.name} is hidden (no collision on device)`);
    if (!opts.noRay) {
      const first = this.firstHit(n, opts.eye);
      if (first && first !== n && this.pressTarget(first.handle) !== this.pressTarget(n.handle)) throw new Error(`press: the laser hits ${first.name} before ${n.name}`);
    }
    const target = this.pressTarget(n.handle);
    this.lastPress = this.time; // a press on any mesh stamps activation
    if (!target) return false;
    for (const s of this.subsFor("OnInteract", target.handle)) if (s.node === target.handle) this.call(s.fn, 0, target.handle, 0, 0);
    return true;
  }

  // --- the visitor at the keyboard
  type(text) {
    const s = this.ti.session;
    if (!s || s.phase !== "open") throw new Error("type: no keyboard is up");
    const next = cleanTyped(text, s.max);
    if (next !== s.text) {
      s.text = next;
      s.changed = true;
    }
  }
  enter() {
    const s = this.ti.session;
    if (!s || s.phase !== "open") throw new Error("enter: no keyboard is up");
    s.phase = "ended";
    s.endCode = 2;
    s.delivered = false;
    this.ti.rearm = this.time;
  }
  closeKeyboard() {
    const s = this.ti.session;
    if (!s || s.phase !== "open") throw new Error("close: no keyboard is up");
    s.phase = "ended";
    s.endCode = -1;
    s.delivered = false;
  }

  // --- hover
  /** Point a hand's ray at a node (by name), or at nothing (null). */
  point(hand, which) {
    const n = which === null ? null : this.byName.get(which);
    if (which !== null && !n) throw new Error(`point: no node ${which}`);
    if (n && !n.visible) throw new Error(`point: ${n.name} is hidden (no collision on device: the ray passes through)`);
    const target = n ? this.pressTarget(n.handle) : null;
    const st = this.hover[hand];
    const id = target ? target.handle : null;
    if (id !== st.on) {
      st.on = id;
      st.since = this.time;
    }
  }
  setMenuOpen(open) {
    this.menuOpen = open;
  }
  hoverSubscribed() {
    return [...this.subs.values()].some((s) => s.name === "OnHoverEnter" || s.name === "OnHoverExit");
  }
  deliverHover(name, target, hand) {
    this.events.push({ t: this.time, kind: name, node: this.nodes.get(target)?.name, hand });
    for (const s of this.subsFor(name, target)) this.call(s.fn, 0, target, 0, hand);
  }
  serviceHover(dt) {
    this.hoverBucket = Math.min(LIMITS.hoverBurst, this.hoverBucket + LIMITS.hoverRate * dt);
    if (!this.hoverSubscribed()) {
      // A world with no hover subscription pays nothing and hears nothing; what was entered is forgotten.
      for (const st of this.hover) st.entered = null;
      return;
    }
    for (let hand = 0; hand < 2; hand++) {
      const st = this.hover[hand];
      if (this.menuOpen) {
        if (st.entered !== null) {
          this.deliverHover("OnHoverExit", st.entered, hand);
          st.entered = null;
        }
        st.since = this.time; // no Enter until the menu closes and the ray rests again
        continue;
      }
      if (st.entered !== null && !this.nodes.get(st.entered)?.visible) {
        // The target was hidden (k_node_set_visible): an Exit at once.
        this.deliverHover("OnHoverExit", st.entered, hand);
        st.entered = null;
        st.on = null;
        continue;
      }
      if (st.entered !== null && st.on !== st.entered) {
        st.offSince ??= this.time;
        if (this.time - st.offSince >= LIMITS.hoverExitS) {
          this.deliverHover("OnHoverExit", st.entered, hand);
          st.entered = null;
          st.offSince = null;
        }
      } else if (st.entered !== null) {
        st.offSince = null;
      }
      if (st.entered === null && st.on !== null && this.time - st.since >= LIMITS.hoverDwellS && st.refused !== st.on) {
        if (this.hoverBucket >= 1) {
          this.hoverBucket -= 1;
          st.entered = st.on;
          this.deliverHover("OnHoverEnter", st.on, hand);
        } else {
          st.refused = st.on; // not queued; this target waits until the ray leaves and rests again
          this.events.push({ t: this.time, kind: "hover_refused", hand });
        }
      }
      if (st.on !== st.refused) st.refused = undefined;
    }
  }

  // --- travel
  /** Travel starts: release and record every override and picture. */
  travelStart() {
    this.travelCapture = { mat: new Map([...this.mat].map(([k, v]) => [k, { ...v }])), images: new Map(this.images) };
    this.travelWrites = new Map();
    this.mat = new Map();
    this.images = new Map();
    this.events.push({ t: this.time, kind: "travel_start" });
  }
  /** The travel is cancelled or refused: give everything back. */
  travelStopped() {
    const cap = this.travelCapture;
    if (!cap) throw new Error("no travel in progress");
    this.images = cap.images;
    for (const [key, v] of cap.mat) {
      const w = this.travelWrites.get(key) ?? 0;
      if (w & 16) continue; // reset since: stays reset
      const now = this.mat.get(key) ?? {};
      const out = { ...v };
      if (w & 1) out.color = now.color;
      if (w & 2) out.opacity = now.opacity;
      if (w & 4) {
        out.emissive = now.emissive;
        out.strength = now.strength;
      }
      if (w & 8) out.texture = now.texture;
      this.mat.set(key, out);
    }
    this.travelCapture = null;
    this.travelWrites = new Map();
    this.pendingTravel = null;
    this.events.push({ t: this.time, kind: "travel_stopped" });
  }

  // --- reads for scenarios and renders
  textOf(name) {
    const n = this.byName.get(name);
    return n ? this.texts.get(n.handle)?.text : undefined;
  }
  styleOf(name) {
    const n = this.byName.get(name);
    return n ? this.texts.get(n.handle)?.style : undefined;
  }
  materialOf(name, slot = 0) {
    const n = this.byName.get(name);
    return n ? this.mat.get(`${n.handle}:${slot}`) : undefined;
  }
  /** A snapshot for the renderer: every alive, visible mesh, its overrides, and every text. */
  scene() {
    const nodes = [...this.nodes.values()]
      .filter((n) => n.alive && n.mesh && n.visible)
      .map((n) => ({ name: n.name, source: n.source ?? n.name, created: n.created, pos: n.pos, mat: n.slots.map((_, s) => this.mat.get(`${n.handle}:${s}`) ?? null) }));
    const texts = [...this.texts.entries()]
      .map(([h, t]) => ({ node: this.nodes.get(h), ...t }))
      .filter((t) => t.node && t.node.alive && t.node.visible)
      .map((t) => ({ name: t.node.name, source: t.node.source ?? t.node.name, pos: t.node.pos, text: t.text, offset: t.offset, style: t.style }));
    return { nodes, texts };
  }
}
