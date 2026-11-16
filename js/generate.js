// Builds the push / pull line test G-code
import { fill } from './macro.js';

export const LAYERS = 4;            // rim, tabs and bars: layers 1-3, numbers: layer 4
const WALLS = 3;
const DIGIT_H = 3.2, DIGIT_W = 1.8, DIGIT_GAP = 0.75;

// Corners of a digit: x 0..1, y 0..1
const P = { TL: [0, 1], TR: [1, 1], ML: [0, 0.5], MR: [1, 0.5], BL: [0, 0], BR: [1, 0] };
const DIGITS = {
  0: [['TL', 'TR', 'BR', 'BL', 'TL']],
  1: [['TL', 'BL']],
  2: [['TL', 'TR', 'MR', 'ML', 'BL', 'BR']],
  3: [['TL', 'TR', 'BR', 'BL'], ['ML', 'MR']],
  4: [['TL', 'ML', 'MR'], ['TR', 'BR']],
  5: [['TR', 'TL', 'ML', 'MR', 'BR', 'BL']],
  6: [['TR', 'TL', 'BL', 'BR', 'MR', 'ML']],
  7: [['TL', 'TR', 'BR']],
  8: [['TL', 'TR', 'BR', 'BL', 'TL'], ['ML', 'MR']],
  9: [['BL', 'BR', 'TR', 'TL', 'ML', 'MR']],
};

export function paValues(v) {
  const out = [];
  if (!(v.pa_step > 0) || v.pa_end < v.pa_start) return out;
  const n = Math.floor((v.pa_end - v.pa_start) / v.pa_step + 1e-6) + 1;
  for (let i = 0; i < n && i < 200; i++) out.push(+(v.pa_start + i * v.pa_step).toFixed(6));
  return out;
}

function decimals(v) {
  const d = (x) => { const s = String(+(+x).toFixed(6)); return s.includes('.') ? s.split('.')[1].length : 0; };
  return Math.max(2, d(v.pa_start), d(v.pa_step), d(v.pa_end));
}

// '1' is a single line, so it gets no width of its own
function charWidth(c) { return c === '.' ? 0.5 : c === '1' ? 0 : DIGIT_W; }

function textWidth(t) {
  let w = 0;
  for (const c of t) w += charWidth(c) + DIGIT_GAP;
  return w - DIGIT_GAP;
}

// Sizes of the test in its own coordinates (bars from x 0 to bar length)
export function layout(v) {
  const W = v.line_width, ks = paValues(v);
  const pitch = Math.max(5, 3 * W + 2.5);
  const rim = WALLS * W;
  const labels = ks.map((k) => k.toFixed(decimals(v)));
  const numW = Math.max(0, ...labels.map(textWidth));
  const tabW = numW + 4 + rim;
  const ix0 = 0, ix1 = v.line_length;
  const iy0 = -4, iy1 = Math.max(0, ks.length - 1) * pitch + 4;
  const ox0 = ix0 - rim, oy0 = iy0 - rim, ox1 = ix1 + rim, oy1 = iy1 + rim;
  return {
    W, ks, labels, pitch, rim, tabW, numW,
    ix0, ix1, iy0, iy1, ox0, oy0, ox1, oy1,
    x0: ox0 - tabW, x1: ox1 + tabW, y0: oy0, y1: oy1,
  };
}

// Where the test lands on the bed
export function placement(v) {
  const L = layout(v);
  const dx = v.center_x - (L.x0 + L.x1) / 2, dy = v.center_y - (L.y0 + L.y1) / 2;
  return { L, dx, dy, min: [L.x0 + dx, L.y0 + dy], max: [L.x1 + dx, L.y1 + dy] };
}

// Extrusion cross section (rectangle with round sides, like the slicers use)
export function lineArea(w, h) { return (w - h * (1 - Math.PI / 4)) * h; }

// Speeds and accelerations actually used
export function derived(v) {
  const area = lineArea(v.line_width, v.layer_height);
  const flowCap = v.max_flow > 0 ? v.max_flow / area : Infinity;
  const speedCap = Math.min(flowCap, v.max_speed > 0 ? v.max_speed : Infinity);
  const fast = Math.min(v.fast_speed, speedCap);
  const accelCap = v.max_accel > 0 ? v.max_accel : Infinity;
  const accel = Math.min(v.test_accel, accelCap);
  const slow = Math.min(v.slow_speed, speedCap);
  const fastLen = v.line_length - 2 * v.slow_length;
  // distance to get from slow to fast (and back)
  const rampDist = accel > 0 ? (fast * fast - slow * slow) / (2 * accel) : Infinity;
  const reached = 2 * rampDist <= fastLen;
  const peak = reached ? fast : Math.sqrt(slow * slow + accel * Math.max(0, fastLen));
  return {
    area, flowCap, fast, slow, accel, rampDist, fastLen, reached, peak,
    fastFlow: fast * area, wantedFlow: v.fast_speed * area,
    fastCapped: fast < v.fast_speed, accelCapped: accel < v.test_accel,
  };
}

// Values for start / end G-code placeholders
export function makeVars(v, cfgVars, place) {
  const vars = { ...(cfgVars || {}) };
  const one = (x) => [x];
  Object.assign(vars, {
    nozzle_temperature_initial_layer: one(v.nozzle_temp_first),
    nozzle_temperature: one(v.nozzle_temp),
    first_layer_temperature: one(v.nozzle_temp_first),
    temperature: one(v.nozzle_temp),
    bed_temperature_initial_layer: one(v.bed_temp_first),
    bed_temperature: one(v.bed_temp),
    first_layer_bed_temperature: one(v.bed_temp_first),
    bed_temperature_initial_layer_single: v.bed_temp_first,
    bed_temperature_initial_layer_vector: String(v.bed_temp_first),
    layer_height: v.layer_height,
    initial_layer_print_height: v.first_layer_height,
    first_layer_height: v.first_layer_height,
    nozzle_diameter: one(v.nozzle_diameter),
    filament_diameter: one(v.filament_diameter),
    filament_flow_ratio: one(v.flow_ratio),
    filament_max_volumetric_speed: one(v.max_flow),
    retraction_length: one(v.retract_length),
    pressure_advance: one(v.base_pa),
    initial_tool: 0, initial_extruder: 0, current_extruder: 0, next_extruder: 0, previous_extruder: -1,
    current_object_idx: 0, total_toolchanges: 0, has_wipe_tower: false,
    layer_num: 0, layer_z: v.first_layer_height,
    total_layer_count: LAYERS, max_layer_z: v.first_layer_height + (LAYERS - 1) * v.layer_height,
    first_layer_print_min: place.min, first_layer_print_max: place.max,
    first_layer_print_size: [place.max[0] - place.min[0], place.max[1] - place.min[1]],
    adaptive_bed_mesh_min: place.min, adaptive_bed_mesh_max: place.max,
    print_bed_min: [v.bed_x0, v.bed_y0], print_bed_max: [v.bed_x1, v.bed_y1],
    print_bed_size: [v.bed_x1 - v.bed_x0, v.bed_y1 - v.bed_y0],
    input_filename_base: 'pa_line_test', plate_name: 'pa_line_test',
    is_extruder_used: [true],
  });
  if (!('overall_chamber_temperature' in vars)) {
    const c = vars.chamber_temperature;
    vars.overall_chamber_temperature = Array.isArray(c) ? Math.max(...c.map(Number).filter(isFinite), 0) : (+c || 0);
  }
  if (!('filament_type' in vars) && v.filament_type) vars.filament_type = [v.filament_type];
  return vars;
}

const f3 = (x) => String(+x.toFixed(3));
const f5 = (x) => String(+x.toFixed(5));

class Writer {
  constructor(v) {
    this.v = v; this.lines = [];
    this.x = null; this.y = null; this.z = 0;
    this.retracted = false; this.hopped = false;
    this.accel = null; this.type = null;
    this.e = 0; this.time = 0; this.maxFlow = 0;
    const r = v.filament_diameter / 2;
    this.filArea = Math.PI * r * r;
  }
  out(s) { this.lines.push(s); }
  setType(t) { if (t !== this.type) { this.out(';TYPE:' + t); this.type = t; } }
  setAccel(a) {
    a = Math.round(Math.min(a, this.v.max_accel > 0 ? this.v.max_accel : a));
    if (a !== this.accel) { this.out('SET_VELOCITY_LIMIT ACCEL=' + a); this.accel = a; }
  }
  retract() {
    const v = this.v;
    if (this.retracted || !(v.retract_length > 0)) return;
    this.out(`G1 E-${f5(v.retract_length)} F${Math.round(v.retract_speed * 60)}`);
    this.time += v.retract_length / v.retract_speed;
    this.retracted = true;
    if (v.z_hop > 0) { this.out(`G1 Z${f3(this.z + v.z_hop)} F${Math.round(Math.min(v.travel_speed, 20) * 60)}`); this.hopped = true; }
  }
  unretract() {
    const v = this.v;
    if (this.hopped) { this.out(`G1 Z${f3(this.z)} F${Math.round(Math.min(v.travel_speed, 20) * 60)}`); this.hopped = false; }
    if (this.retracted) {
      this.out(`G1 E${f5(v.retract_length)} F${Math.round(v.deretract_speed * 60)}`);
      this.time += v.retract_length / v.deretract_speed;
      this.retracted = false;
    }
  }
  travel(x, y) {
    const v = this.v;
    const d = this.x === null ? Infinity : Math.hypot(x - this.x, y - this.y);
    if (d < 1e-4) return;
    if (d > v.retract_min_travel) this.retract();
    const a = this.accel;
    if (d > 2) this.setAccel(v.travel_accel);
    const s = Math.min(v.travel_speed, v.max_speed > 0 ? v.max_speed : Infinity);
    this.out(`G1 X${f3(x)} Y${f3(y)} F${Math.round(s * 60)}`);
    if (isFinite(d)) this.time += d / s + s / Math.max(this.accel || 1000, 1);
    if (a !== null && d > 2) this.setAccel(a);
    this.x = x; this.y = y;
  }
  extrude(x, y, speed, h) {
    const v = this.v, w = v.line_width;
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 1e-4) return;
    this.unretract();
    const area = lineArea(w, h);
    const cap = v.max_flow > 0 ? v.max_flow / area : Infinity;
    const s = Math.min(speed, cap, v.max_speed > 0 ? v.max_speed : Infinity);
    const e = d * area / this.filArea * v.flow_ratio;
    this.out(`G1 X${f3(x)} Y${f3(y)} E${f5(e)} F${Math.round(s * 60)}`);
    this.e += e; this.time += d / s;
    this.maxFlow = Math.max(this.maxFlow, s * area);
    this.x = x; this.y = y;
  }
  path(pts, speed, h) {
    this.travel(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) this.extrude(pts[i][0], pts[i][1], speed, h);
  }
}

// Solid fill at +45 (sgn 1) or -45 (sgn -1) degrees, lines one width apart
function fill45(x0, y0, x1, y1, W, sgn) {
  const lines = [];
  if (x1 <= x0 || y1 <= y0) return lines;
  const step = W * Math.SQRT2;
  // line: y = sgn*x + c
  const cs = [y0 - sgn * x0, y0 - sgn * x1, y1 - sgn * x0, y1 - sgn * x1];
  const cmin = Math.min(...cs), cmax = Math.max(...cs);
  for (let c = cmin + step / 2; c < cmax; c += step) {
    const pts = [];
    for (const x of [x0, x1]) { const y = sgn * x + c; if (y >= y0 - 1e-9 && y <= y1 + 1e-9) pts.push([x, y]); }
    for (const y of [y0, y1]) { const x = (y - c) * sgn; if (x >= x0 - 1e-9 && x <= x1 + 1e-9) pts.push([x, y]); }
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length >= 2 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) > W * 0.5)
      lines.push([pts[0], pts[pts.length - 1]]);
  }
  lines.forEach((l, i) => { if (i % 2) l.reverse(); });
  return lines;
}

export function generate(v, cfgVars) {
  const place = placement(v), L = place.L, D = derived(v);
  const W = v.line_width, dx = place.dx, dy = place.dy;
  const at = (x, y) => [x + dx, y + dy];
  const w = new Writer(v);
  const vars = makeVars(v, cfgVars, place);
  const start = fill(v.start_gcode || '', vars), end = fill(v.end_gcode || '', vars);

  w.out('; pa_line_test: push / pull pressure advance line test');
  w.out(`; PA ${L.ks[0]} to ${L.ks[L.ks.length - 1]}, step ${v.pa_step}, ${L.ks.length} bars`);
  w.out(`; fast ${f3(D.fast)} mm/s, slow ${f3(D.slow)} mm/s, accel ${Math.round(D.accel)} mm/s²`);
  w.out('; left end of each bar (speed-up) = push, right end (slow-down) = pull');
  w.out(`; size ${f3(L.x1 - L.x0)} x ${f3(L.y1 - L.y0)} mm, center ${f3(v.center_x)}, ${f3(v.center_y)}`);
  w.out('');

  // one object around the whole test, so Klipper's adaptive mesh (ADAPTIVE=1, KAMP)
  // probes only this area. Written before the start G-code, like Orca does
  const OBJ = 'pa_line_test';
  if (v.label_object) {
    const [ax, ay] = place.min, [bx, by] = place.max;
    const poly = [[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]].map(([x, y]) => `[${f3(x)},${f3(y)}]`).join(',');
    w.out(`EXCLUDE_OBJECT_DEFINE NAME=${OBJ} CENTER=${f3((ax + bx) / 2)},${f3((ay + by) / 2)} POLYGON=[${poly}]`);
  }

  // temperatures, if the start G-code doesn't set them (like the slicers do)
  const sg = v.start_gcode || '';
  const nozzleDone = /\bM10[49]\b/i.test(start.text) || /first_layer_temperature|nozzle_temperature/.test(sg);
  const bedDone = /\bM1(40|90)\b/i.test(start.text) || /bed_temperature|plate_temp/.test(sg);
  if (!bedDone) w.out(`M140 S${v.bed_temp_first}`);
  if (!nozzleDone) w.out(`M104 S${v.nozzle_temp_first}`);
  if (!bedDone) w.out(`M190 S${v.bed_temp_first}`);
  if (!nozzleDone) w.out(`M109 S${v.nozzle_temp_first}`);
  w.out('; start G-code');
  w.out(start.text.replace(/\s+$/, ''));
  w.out('; end of start G-code');
  w.out('G90');
  w.out('M83');
  w.out('G92 E0');
  w.out(`SET_PRINT_STATS_INFO TOTAL_LAYER=${LAYERS}`);
  w.out(`SET_PRESSURE_ADVANCE ADVANCE=${v.base_pa}`);
  w.out('M107');

  const tabs = [[L.ox0 - L.tabW, L.ox0, true], [L.ox1, L.ox1 + L.tabW, false]];
  const ov = L.rim - (v.overlap / 100) * W;
  let z = 0;
  for (let layer = 1; layer <= LAYERS; layer++) {
    const first = layer === 1;
    const h = first ? v.first_layer_height : v.layer_height;
    z = first ? v.first_layer_height : z + v.layer_height;
    if (!first) w.retract();
    w.out(';LAYER_CHANGE');
    w.out(`;Z:${f3(z)}`);
    w.out(`;HEIGHT:${f3(h)}`);
    w.out(`SET_PRINT_STATS_INFO CURRENT_LAYER=${layer}`);
    w.z = z;
    w.out(`G1 Z${f3(z + (w.hopped ? v.z_hop : 0))} F600`);
    if (layer === 2) {
      if (v.nozzle_temp !== v.nozzle_temp_first) w.out(`M104 S${v.nozzle_temp}`);
      if (v.bed_temp !== v.bed_temp_first) w.out(`M140 S${v.bed_temp}`);
    }
    if (layer === Math.max(1, Math.round(v.fan_off_layers) + 1))
      w.out(v.fan_speed > 0 ? `M106 S${Math.round(Math.min(100, v.fan_speed) * 2.55)}` : 'M107');
    w.setAccel(first ? v.first_layer_accel : v.print_accel);
    if (v.label_object) w.out(`EXCLUDE_OBJECT_START NAME=${OBJ}`);

    if (layer <= 3) {
      const wallSpeed = first ? v.first_layer_speed : v.wall_speed;
      // rim around the bars, inner wall first
      for (let j = WALLS - 1; j >= 0; j--) {
        const o = W / 2 + j * W;
        const a = L.ox0 + o, b = L.oy0 + o, c = L.ox1 - o, d = L.oy1 - o;
        w.setType(j ? 'Inner wall' : 'Outer wall');
        w.path([at(a, b), at(c, b), at(c, d), at(a, d), at(a, b)], wallSpeed, h);
      }
      // tabs: walls on three sides, the rim is the fourth
      for (const [tx0, tx1, left] of tabs) {
        const xOut = left ? tx0 : tx1, xOpen = left ? tx1 : tx0, s = left ? 1 : -1;
        for (let j = WALLS - 1; j >= 0; j--) {
          const o = W / 2 + j * W, xo = xOut + s * o, ya = L.oy0 + o, yb = L.oy1 - o;
          w.setType(j ? 'Inner wall' : 'Outer wall');
          w.path([at(xOpen, ya), at(xo, ya), at(xo, yb), at(xOpen, yb)], wallSpeed, h);
        }
        const role = layer === 1 ? ['Bottom surface', 1, v.first_layer_speed]
          : layer === 2 ? ['Internal solid infill', -1, v.solid_speed] : ['Top surface', 1, v.top_speed];
        const fx0 = left ? tx0 + ov : tx0 - (v.overlap / 100) * W;
        const fx1 = left ? tx1 + (v.overlap / 100) * W : tx1 - ov;
        w.setType(role[0]);
        for (const [p, q] of fill45(fx0, L.oy0 + ov, fx1, L.oy1 - ov, W, role[1])) w.path([at(...p), at(...q)], role[2], h);
      }
      // bars
      if (layer < 3) {
        w.setType(first ? 'Bottom surface' : 'Internal solid infill');
        const sp = first ? v.first_layer_speed : v.solid_speed;
        let flip = false;
        L.ks.forEach((k, i) => {
          for (const j of [-1, 0, 1]) {
            const y = i * L.pitch + j * W;
            const xs = flip ? [L.ix1, L.ix0] : [L.ix0, L.ix1];
            w.path([at(xs[0], y), at(xs[1], y)], sp, h);
            flip = !flip;
          }
        });
      } else {
        // the test: every line left to right, slow / fast / slow
        w.setAccel(D.accel);
        const s1 = L.ix0 + v.slow_length, s2 = L.ix1 - v.slow_length;
        L.ks.forEach((k, i) => {
          w.out(`; bar ${i + 1}: PA ${k}`);
          w.out(`SET_PRESSURE_ADVANCE ADVANCE=${k}`);
          for (const j of [-1, 0, 1]) {
            const y = i * L.pitch + j * W;
            w.setType('Test slow');
            w.travel(...at(L.ix0, y));
            w.extrude(...at(s1, y), D.slow, h);
            w.setType('Test fast');
            w.extrude(...at(s2, y), D.fast, h);
            w.setType('Test slow');
            w.extrude(...at(L.ix1, y), D.slow, h);
          }
        });
        w.out(`SET_PRESSURE_ADVANCE ADVANCE=${v.base_pa}`);
        w.setAccel(v.print_accel);
      }
    } else {
      // numbers on top of both tabs
      w.setType('Numbers');
      for (const [tx0, tx1, left] of tabs) {
        const xStart = left ? tx0 + L.rim + 2 : tx0 + 2;
        L.labels.forEach((t, i) => {
          const yb = i * L.pitch - DIGIT_H / 2;
          let x = xStart;
          for (const c of t) {
            if (c === '.') {
              w.path([at(x, yb + 0.2), at(x + 0.25, yb + 0.2)], v.slow_speed, h);
              x += charWidth(c) + DIGIT_GAP; continue;
            }
            for (const stroke of DIGITS[c] || []) {
              w.path(stroke.map((n) => at(x + P[n][0] * DIGIT_W, yb + P[n][1] * DIGIT_H)), v.slow_speed, h);
            }
            x += charWidth(c) + DIGIT_GAP;
          }
        });
      }
    }
    if (v.label_object) w.out(`EXCLUDE_OBJECT_END NAME=${OBJ}`);
  }
  w.retract();
  w.out(`G1 Z${f3(z + 5)} F600`);
  w.out('; end G-code');
  w.out(end.text.replace(/\s+$/, ''));
  w.out(`; filament used [mm] = ${(w.e).toFixed(2)}`);
  w.out(`; estimated printing time = ${Math.round(w.time / 60)} min`);
  const gcode = w.lines.join('\n') + '\n';
  return {
    gcode, place, derived: D, start, end,
    stats: { filament: w.e, time: w.time, maxFlow: w.maxFlow, lines: w.lines.length },
  };
}
