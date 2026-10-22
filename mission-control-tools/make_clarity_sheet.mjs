// make_clarity_sheet.mjs -- review/clarity_sheet.jpg: each clarity-pass view, 1.3.0 beside 1.4.0.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (CLARITY_PASS.md section D)
// @kosmos-owner  Content lane
//
// One row per view: on the left the 1.3.0 render, labelled "1.3.0", on the right the 1.4.0
// render from mission-control/review/, labelled "1.4.0", both scaled to the same height.
//
// Where the 1.3.0 renders come from:
//   - the views 1.3.0 already rendered (seal_ring, arc, cubes_calm, puck_close, watcher) are
//     read from git at the 1.3.0 merge, cee4f69 (`git show cee4f69:mission-control/review/...`);
//   - the views new in the clarity pass (arc_empty, watch_post, watch_post_throne) have no
//     1.3.0 render in git. Render them from a detached worktree at cee4f69, with the 1.3.0
//     build_panel.py, its own geometry and the 1.3.0 bridge's words (for arc_empty, the 1.3.0
//     bridge's snapshot after pairing and pressing CubePlus), the same cameras as 1.4.0's,
//     and pass that folder as --old. A file in --old wins over git.
//
// Usage: node mission-control-tools/make_clarity_sheet.mjs [--old <folder of 1.3.0 jpgs>]
// Needs ffmpeg on PATH (drawtext, with the UE Roboto font).
//
// Integration: reads mission-control/review/*.jpg (written by blender/build_panel.py); writes
// mission-control/review/clarity_sheet.jpg. Nothing here reaches the package.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const review = path.join(repo, "mission-control", "review");
const OLD_COMMIT = "cee4f69";
const VIEWS = [
  ["seal_ring", "the Pairing Seal"],
  ["arc", "the arc, a job open"],
  ["arc_empty", "the arc, signed in with no jobs"],
  ["cubes_calm", "the ledge and the puck"],
  ["puck_close", "the puck"],
  ["watcher", "a watcher in the hall"],
  ["watch_post", "the Watch post, standing at it"],
  ["watch_post_throne", "the Watch post, from the throne"],
];
const H = 540;
const FONT = "E\\:/Epic Games/UE_5.7/Engine/Content/Slate/Fonts/Roboto-Bold.ttf";

const args = process.argv.slice(2);
const oldDir = args.includes("--old") ? path.resolve(args[args.indexOf("--old") + 1]) : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-clarity-sheet-"));

/** A JPEG's width and height, from its first SOF marker. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  throw new Error(`no SOF in ${file}`);
}

/** The 1.3.0 render of a view: --old first, then git at cee4f69. */
function oldRender(name) {
  if (oldDir && fs.existsSync(path.join(oldDir, `${name}.jpg`))) return path.join(oldDir, `${name}.jpg`);
  const out = path.join(tmp, `old_${name}.jpg`);
  try {
    fs.writeFileSync(out, execFileSync("git", ["-C", repo, "show", `${OLD_COMMIT}:mission-control/review/${name}.jpg`], { maxBuffer: 64 << 20 }));
  } catch {
    throw new Error(`no 1.3.0 render of ${name}: pass --old <folder> (see the header)`);
  }
  return out;
}

const rows = VIEWS.map(([name, what]) => {
  const files = [oldRender(name), path.join(review, `${name}.jpg`)];
  if (!fs.existsSync(files[1])) throw new Error(`missing review/${name}.jpg: run build_panel.ps1 first`);
  const widths = files.map((f) => {
    const [w, h] = jpegSize(f);
    return 2 * Math.round((w * H) / h / 2);
  });
  return { name, what, files, widths };
});
const gap = 16;
const W = Math.max(...rows.map((r) => r.widths[0] + gap + r.widths[1]));

const inputs = [];
const chains = [];
rows.forEach((r, k) => {
  const tiles = r.files.map((f, j) => {
    inputs.push("-i", f);
    const idx = inputs.length / 2 - 1;
    const label = `${j === 0 ? "1.3.0" : "1.4.0"}   ${r.what}`;
    chains.push(
      `[${idx}:v]scale=${r.widths[j]}:${H},drawbox=x=0:y=0:w=iw:h=46:color=black@0.72:t=fill,` +
        `drawtext=fontfile='${FONT}':text='${label}':fontcolor=${j === 0 ? "0xB8C4D0" : "0x5FE6FF"}:fontsize=30:x=16:y=9[t${k}_${j}]`,
    );
    return `[t${k}_${j}]`;
  });
  chains.push(`${tiles[0]}pad=iw+${gap}:ih:0:0:black[g${k}]`);
  chains.push(`[g${k}]${tiles[1]}hstack=inputs=2,pad=${W}:${H + gap}:0:0:black[r${k}]`);
});
chains.push(`${rows.map((_, k) => `[r${k}]`).join("")}vstack=inputs=${rows.length}[out]`);

const out = path.join(review, "clarity_sheet.jpg");
const res = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", "3", out],
  { stdio: "inherit" },
);
fs.rmSync(tmp, { recursive: true, force: true });
if (res.status !== 0) throw new Error(`ffmpeg failed (${res.status})`);
console.log(`wrote mission-control/review/clarity_sheet.jpg (${W} x ${rows.length * (H + gap)}, ${rows.length} views)`);
