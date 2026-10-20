/**
 * mock-host.mjs -- runs the built world.wasm the way the headset would, against
 * the mock bridge's day face, with the headset's limits enforced.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * This is a model of the client, not the client. What it models, and where
 * each rule comes from (client cook C-20261013-ecad7c5 unless noted):
 *   - k_node_find sees only nodes WITH A MESH; names collapse a trailing
 *     `_<digits>` (KWorldResolverSubsystem; memory notes 2026-10-06/08).
 *   - world text: at most 32 at once (KWasm::MAX_WORLD_TEXT), at most 128
 *     bytes (MAX_WORLD_TEXT_BYTES, refused with -7, never cut), 4 lines,
 *     offset_y clamped to 0..5 m.
 *   - created objects: at most 128 (MAX_CREATED_NODES), 16 a frame
 *     (MAX_NODE_CREATES_PER_FRAME, -6), unique names, clones keep the source's
 *     visibility (KDomSceneGraph.cpp k_node_clone).
 *   - network: the URL's origin must be in manifest network.connect (else -2);
 *     body <= 16 KiB (-7); 4 in flight (-6); 1 a second with bursts of 10 (-6);
 *     answers over 256 KiB are -5; OnNetResult arrives on a later tick and the
 *     body is readable only until the next tick (NET_CLIENT_IFACE.md, CL-2).
 *   - k_ui_prompt needs the visitor's press within 5 s (activation, D-082);
 *     one in flight; the answer comes back on a later tick.
 *   - no player_read: the module may not import any k_player_get_* function.
 * What it does NOT model: rendering, depth, the laser, the real tunnel,
 * TLS, the registry's origin check. Those are the device checkpoint's.
 */

import fs from "node:fs";

export const LIMITS = Object.freeze({
  maxTexts: 32,
  textBytes: 128,
  textLines: 4,
  maxCreated: 128,
  createsPerFrame: 16,
  requestBytes: 16 * 1024,
  responseBytes: 256 * 1024,
  inFlight: 4,
  ratePerS: 1,
  rateBurst: 10,
  activationS: 5,
});

/** Parse a GLB into {nodes: [{name, mesh, translation, extras}]}. */
export function readGlb(path) {
  const b = fs.readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
  return j;
}

const collapse = (name) => name.replace(/_\d+$/, "");

/** The minimum page count the module declares for its imported memory (the wasm import section). */
export function importedMemoryMinPages(bytes) {
  let p = 8;
  const u32 = () => {
    let r = 0;
    let shift = 0;
    let b;
    do {
      b = bytes[p++];
      r |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return r >>> 0;
  };
  const skipName = () => {
    const n = u32();
    p += n;
  };
  while (p < bytes.length) {
    const id = bytes[p++];
    const size = u32();
    const end = p + size;
    if (id === 2) {
      const count = u32();
      for (let i = 0; i < count; i++) {
        skipName();
        skipName();
        const kind = bytes[p++];
        if (kind === 0) u32(); // function: type index
        else if (kind === 1) {
          p++; // table: element type
          const f = bytes[p++];
          u32();
          if (f & 1) u32();
        } else if (kind === 2) {
          const f = bytes[p++];
          const min = u32();
          if (f & 1) u32();
          return min;
        } else if (kind === 3) p += 2; // global: type + mutability
      }
    }
    p = end;
  }
  throw new Error("the module imports no memory (WASM_006)");
}

export class Host {
  /**
   * @param wasmPath  world.wasm
   * @param glbPath   world.glb
   * @param manifest  the parsed manifest.json
   * @param net       (method, path, bodyBuffer, headers) => {status, body: string|Buffer}  (sync; the mock bridge).
   *                  headers carries what the headset sends: x-world-address and content-type.
   */
  constructor({ wasmPath, glbPath, manifest, net }) {
    this.manifest = manifest;
    this.net = net;
    this.time = 0;
    this.frame = 0;
    this.log = [];
    this.events = []; // what happened, for assertions
    // --- scene
    this.nodes = new Map(); // handle -> node
    this.byName = new Map();
    let h = 1;
    const gltf = readGlb(glbPath);
    for (const n of gltf.nodes) {
      // Box half-extents (from the POSITION accessor) and yaw, for the laser check.
      let half = null;
      // The rendered centre the client anchors text to (KWorldTextPool: the
      // component's bounds origin): the middle of ALL the mesh's primitives,
      // turned by the node's yaw. A plaque's keel lowers it on purpose.
      let center = [0, 0, 0];
      const q = n.rotation ?? [0, 0, 0, 1];
      const yaw = 2 * Math.atan2(q[1], q[3]);
      if (n.mesh !== undefined) {
        const prims = gltf.meshes[n.mesh].primitives;
        const acc = gltf.accessors[prims[0].attributes.POSITION];
        half = acc.max.map((v, i) => (v - acc.min[i]) / 2);
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const pr of prims) {
          const a = gltf.accessors[pr.attributes.POSITION];
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], a.min[k]);
            hi[k] = Math.max(hi[k], a.max[k]);
          }
        }
        const c = lo.map((v, k) => (v + hi[k]) / 2);
        // glTF yaw about +Y: x' = x cos + z sin, z' = -x sin + z cos.
        center = [c[0] * Math.cos(yaw) + c[2] * Math.sin(yaw), c[1], -c[0] * Math.sin(yaw) + c[2] * Math.cos(yaw)];
      }
      const node = {
        half,
        center,
        yaw,
        handle: h++,
        name: collapse(n.name ?? ""),
        mesh: n.mesh !== undefined,
        meshIndex: n.mesh,
        pos: [...(n.translation ?? [0, 0, 0])],
        visible: true,
        created: false,
        alive: true,
        extras: n.extras ?? {},
      };
      this.nodes.set(node.handle, node);
      if (!this.byName.has(node.name)) this.byName.set(node.name, node);
    }
    this.nextHandle = h;
    this.created = 0;
    this.createdPeak = 0;
    this.createsThisFrame = 0;
    // --- text
    this.texts = new Map(); // handle -> {text, offset}
    this.textPeak = 0;
    this.textRefusals = [];
    // --- events
    this.subs = new Map(); // id -> {name, node, fn}
    this.nextSub = 1;
    this.lastPress = -1e9;
    this.prompt = null;
    // --- network
    this.connect = new Set(manifest.network?.connect ?? []);
    this.inFlight = [];
    this.bucket = LIMITS.rateBurst;
    this.ready = []; // completions to deliver next tick
    this.readable = new Map(); // request id -> body (until next tick)
    this.netAvailable = true;
    this.maxRequestBytes = 0;
    this.maxResponseBytes = 0;
    this.requests = [];
    this.netRefusals = [];
    this.sounds = [];

    const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
    this.imports = WebAssembly.Module.imports(module);
    const memImport = this.imports.find((i) => i.kind === "memory");
    if (!memImport) throw new Error("WASM_006: the module must import its memory");
    for (const i of this.imports) {
      if (i.kind === "function" && /^k_player_get_/.test(i.name)) throw new Error(`NET_005: a network world may not import ${i.name}`);
    }
    const minPages = importedMemoryMinPages(fs.readFileSync(wasmPath));
    if (minPages > 128) throw new Error(`the module asks for ${minPages} pages of memory; the host's cap is 128 (8 MB)`);
    this.memoryPages = minPages;
    this.memory = new WebAssembly.Memory({ initial: minPages, maximum: 128 });
    const env = { memory: this.memory };
    const kosmos = this.hostFunctions();
    const want = {};
    for (const i of this.imports) {
      if (i.kind !== "function") continue;
      if (!kosmos[i.name]) throw new Error(`import ${i.module}.${i.name} is not modelled`);
      (want[i.module] ??= {})[i.name] = kosmos[i.name];
    }
    want[memImport.module] = { ...(want[memImport.module] ?? {}), [memImport.name]: this.memory };
    this.instance = new WebAssembly.Instance(module, { ...want, env });
    this.table = this.instance.exports.__indirect_function_table;
    if (!this.table) throw new Error("WASM_008: no exported table");
  }

  // --- memory helpers
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

  hostFunctions() {
    const H = this;
    const node = (h) => {
      const n = H.nodes.get(h);
      return n && n.alive ? n : null;
    };
    return {
      k_node_find(p, l) {
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
        if (!name || name.length > 64 || H.byName.has(collapse(name))) return -7;
        if (/_\d+$/.test(name)) return -7; // our model: a collapsed name would collide
        if (H.created >= LIMITS.maxCreated) return -5;
        if (H.createsThisFrame >= LIMITS.createsPerFrame) return -6;
        H.createsThisFrame++;
        H.created++;
        H.createdPeak = Math.max(H.createdPeak, H.created);
        const n = { ...s, handle: H.nextHandle++, name, pos: [...s.pos], created: true, alive: true, source: s.name };
        H.nodes.set(n.handle, n);
        H.byName.set(name, n);
        return n.handle;
      },
      k_node_destroy(h) {
        const n = node(h);
        if (!n) return -1;
        if (!n.created) return -7;
        n.alive = false;
        H.byName.delete(n.name);
        H.texts.delete(h);
        H.created--;
        for (const [id, s] of H.subs) if (s.node === h) H.subs.delete(id);
        return 0;
      },
      k_transform_set_position(h, x, y, z) {
        const n = node(h);
        if (!n) return -1;
        if (![x, y, z].every(Number.isFinite) || [x, y, z].some((v) => Math.abs(v) > 1000)) return -7;
        n.pos = [x, y, z];
        return 0;
      },
      k_ui_show_world_text(h, p, l, off) {
        const n = node(h);
        if (!n) return -1;
        const raw = H.bytes(p, l);
        const text = raw.toString("utf8");
        if (l < 1 || l > LIMITS.textBytes || text.split("\n").length > LIMITS.textLines) {
          H.textRefusals.push({ node: n.name, len: l, text });
          return -7;
        }
        if (!H.texts.has(h) && H.texts.size >= LIMITS.maxTexts) {
          H.textRefusals.push({ node: n.name, reason: "pool full", text });
          return -5;
        }
        // The client keeps a held text's first placement when only the words change
        // (KWorldTextPool.cpp): a new offset is ignored until the text is hidden.
        const prev = H.texts.get(h);
        H.texts.set(h, { text, offset: prev ? prev.offset : Math.min(5, Math.max(0, off)) });
        H.textPeak = Math.max(H.textPeak, H.texts.size);
        return 0;
      },
      k_ui_hide_world_text(h) {
        H.texts.delete(h);
        return 0;
      },
      k_ui_prompt(p, l, out, cap, req) {
        if (H.time - H.lastPress > LIMITS.activationS) return -11;
        if (H.prompt) return -6;
        H.prompt = { text: H.str(p, l), out, cap, req };
        H.events.push({ t: H.time, kind: "prompt", text: H.prompt.text });
        return 0;
      },
      k_event_subscribe(p, l, h, fn) {
        if (!node(h)) return 0;
        const id = H.nextSub++;
        H.subs.set(id, { name: H.str(p, l), node: h, fn });
        return id;
      },
      k_event_subscribe_global(p, l, fn) {
        const id = H.nextSub++;
        H.subs.set(id, { name: H.str(p, l), node: 0, fn });
        return id;
      },
      k_event_unsubscribe(id) {
        return H.subs.delete(id) ? 0 : -1;
      },
      k_audio_play(h, p, l) {
        const name = H.str(p, l);
        if (!(H.manifest.assets.audio ?? []).some((a) => a === name || a.endsWith("/" + name))) return -4;
        H.sounds.push({ t: H.time, name, at: H.nodes.get(h)?.name ?? "global" });
        return 0;
      },
      k_net_status() {
        return H.netAvailable ? 1 : 0;
      },
      k_net_fetch(method, up, ul, bp, bl, flags, req) {
        const url = H.str(up, ul);
        let origin;
        try {
          origin = new URL(url).origin;
        } catch {
          return -7;
        }
        if (!url.startsWith("https://")) return -7;
        if (!H.netAvailable || !H.connect.has(origin)) {
          H.netRefusals.push({ url, rc: -2 });
          return -2;
        }
        if (bl > LIMITS.requestBytes) return -7;
        if (H.inFlight.length >= LIMITS.inFlight) {
          H.netRefusals.push({ url, rc: -6, why: "in flight" });
          return -6;
        }
        if (H.bucket < 1) {
          H.netRefusals.push({ url, rc: -6, why: "rate" });
          return -6;
        }
        H.bucket -= 1;
        const body = Buffer.from(H.bytes(bp, bl));
        H.maxRequestBytes = Math.max(H.maxRequestBytes, bl);
        H.requests.push({ t: H.time, method: method === 1 ? "POST" : "GET", url, body: body.toString("utf8") });
        const headers = { "x-world-address": `${H.manifest.world.id}.${H.manifest.world.author}`, "content-type": flags & 2 ? "application/json" : "text/plain" };
        const ans = H.net(method === 1 ? "POST" : "GET", new URL(url).pathname, body, headers);
        const bytes = Buffer.isBuffer(ans.body) ? ans.body : Buffer.from(ans.body ?? "", "utf8");
        H.maxResponseBytes = Math.max(H.maxResponseBytes, bytes.length);
        const status = bytes.length > LIMITS.responseBytes ? -5 : ans.status;
        H.inFlight.push(req);
        // Delivered on a later tick, never inside the call.
        H.ready.push({ req, status, body: status === -5 ? Buffer.alloc(0) : bytes, at: H.frame + 2 });
        return 0;
      },
      k_net_read(req, out, cap) {
        const b = H.readable.get(req);
        if (!b) return -7;
        if (cap === 0) return b.length;
        const n = Math.min(cap, b.length);
        new Uint8Array(H.memory.buffer, out, n).set(b.subarray(0, n));
        return n;
      },
      k_log(lv, p, l) {
        H.log.push(H.str(p, l));
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
    this.bucket = Math.min(LIMITS.rateBurst, this.bucket + LIMITS.ratePerS * dt);
    this.readable.clear();
    // The prompt answers.
    if (this.prompt && this.prompt.answer !== undefined) {
      const { out, cap, req, answer } = this.prompt;
      this.prompt = null;
      const subs = [...this.subs.values()].filter((s) => s.name === "OnPromptResult");
      let result = -1;
      if (answer !== null) {
        const b = Buffer.from(answer, "utf8").subarray(0, cap);
        new Uint8Array(this.memory.buffer, out, b.length).set(b);
        result = b.length;
      }
      for (const s of subs) this.call(s.fn, 0, 0, req, result);
    }
    this.instance.exports.k_tick(dt);
    // Network completions, after k_tick (ServiceNetwork's place in the client's tick).
    const due = this.ready.filter((r) => r.at <= this.frame);
    this.ready = this.ready.filter((r) => r.at > this.frame);
    for (const r of due) {
      this.inFlight = this.inFlight.filter((x) => x !== r.req);
      this.readable.set(r.req, r.body);
      for (const s of [...this.subs.values()].filter((s) => s.name === "OnNetResult")) this.call(s.fn, 0, 0, r.req, r.status);
    }
  }

  run(seconds, dt = 1 / 72) {
    const end = this.time + seconds;
    while (this.time < end) this.tick(dt);
  }

  /**
   * The laser, approximated: a ray from the visitor's eye (standing at the spawn)
   * to the node's centre. Returns the first visible mesh it enters, or null.
   * Hidden nodes have no collision on device (k_node_set_visible sets NoCollision).
   */
  firstHit(target) {
    const o = [0, 1.62, 0];
    const d = target.pos.map((v, i) => v - o[i]);
    let best = null;
    for (const n of this.nodes.values()) {
      if (!n.alive || !n.visible || !n.half) continue;
      if (n.half.every((h) => h < 0.006)) continue; // 1 cm text studs
      if (n.extras.hollow) {
        // A ring (radii r0..r1, heights y0..y1 about its node): sample the ray through the band.
        const [r0, r1, y0, y1] = n.extras.hollow;
        for (let k = 1; k < 600; k++) {
          const t = k / 600;
          const p = [o[0] + d[0] * t - n.pos[0], o[1] + d[1] * t - n.pos[1], o[2] + d[2] * t - n.pos[2]];
          const r = Math.hypot(p[0], p[2]);
          if (r >= r0 && r <= r1 && p[1] >= y0 && p[1] <= y1) {
            if (!best || t < best.t) best = { t, node: n };
            break;
          }
        }
        continue;
      }
      // Into the box's frame (yaw about +Y).
      const c = Math.cos(-n.yaw), s = Math.sin(-n.yaw);
      const rel = o.map((v, i) => v - n.pos[i]);
      const lo = [rel[0] * c + rel[2] * s, rel[1], -rel[0] * s + rel[2] * c];
      const ld = [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
      let t0 = 0, t1 = 1;
      let hit = true;
      for (let k = 0; k < 3 && hit; k++) {
        if (Math.abs(ld[k]) < 1e-9) {
          if (Math.abs(lo[k]) > n.half[k]) hit = false;
        } else {
          let a = (-n.half[k] - lo[k]) / ld[k], b = (n.half[k] - lo[k]) / ld[k];
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) hit = false;
        }
      }
      if (hit && (!best || t0 < best.t)) best = { t: t0, node: n };
    }
    return best?.node ?? null;
  }

  /** The visitor presses a node (by name or handle). */
  press(which) {
    const n = typeof which === "number" ? this.nodes.get(which) : this.byName.get(which);
    if (!n || !n.alive) throw new Error(`press: no node ${which}`);
    if (!n.visible) throw new Error(`press: ${n.name} is hidden (no collision on device)`);
    const first = this.firstHit(n);
    if (first && first !== n) throw new Error(`press: the laser hits ${first.name} before ${n.name}`);
    this.lastPress = this.time;
    const subs = [...this.subs.values()].filter((s) => s.name === "OnInteract" && s.node === n.handle);
    if (!subs.length) throw new Error(`press: ${n.name} has no OnInteract subscription (a dead press)`);
    for (const s of subs) this.call(s.fn, 0, n.handle, 0, 0);
  }

  answerPrompt(text) {
    if (!this.prompt) throw new Error("no prompt is open");
    this.prompt.answer = text;
  }

  /** Visible texts with their world positions: what a frame would show. */
  shownTexts() {
    return [...this.texts.entries()]
      .map(([h, t]) => ({ node: this.nodes.get(h), ...t }))
      .filter((t) => t.node && t.node.alive && t.node.visible !== false)
      .map((t) => {
        const c = t.node.center ?? [0, 0, 0];
        return { name: t.node.name, text: t.text, pos: [t.node.pos[0] + c[0], t.node.pos[1] + c[1] + t.offset, t.node.pos[2] + c[2]] };
      });
  }

  textOf(name) {
    const n = this.byName.get(name);
    return n ? this.texts.get(n.handle)?.text : undefined;
  }

  /** A snapshot for the renderer: every alive, visible mesh node and every text. */
  scene() {
    const nodes = [...this.nodes.values()]
      .filter((n) => n.alive && n.mesh && n.visible)
      .map((n) => ({ name: n.name, source: n.source ?? n.name, mesh: n.meshIndex, pos: n.pos }));
    return { nodes, texts: this.shownTexts() };
  }
}
