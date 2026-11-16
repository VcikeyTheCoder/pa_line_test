// Run with: node tests/test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { readProjectConfig, readGcodeConfig, fromConfig, configVars, defaults } from '../js/settings.js';
import { fill } from '../js/macro.js';
import { generate, paValues, derived, lineArea } from '../js/generate.js';
import { check } from '../js/checks.js';

const dir = new URL('./fixtures/', import.meta.url);
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }

const project = readProjectConfig(fs.readFileSync(new URL('project_settings.config', dir), 'utf8'));
const tail = readGcodeConfig(fs.readFileSync(new URL('orca_tail.gcode', dir), 'utf8'));

t('3mf settings', () => {
  const { values: v, source } = fromConfig(project);
  assert.equal(v.fast_speed, 120); assert.equal(v.test_accel, 3000);
  assert.equal(v.flow_ratio, 0.94); assert.equal(v.max_flow, 11);
  assert.equal(v.line_width, 0.42);            // 105% of 0.4
  assert.equal(v.bed_temp_first, 65);           // Textured PEI Plate
  assert.equal(v.bed_x1, 250); assert.equal(v.center_x, 125);
  assert.equal(v.max_accel, 8000);
  assert.equal(source.fast_speed, 'file'); assert.equal(source.slow_speed, 'default');
  assert.equal(v.filament_type, 'PLA');
});

t('G-code settings match the 3mf', () => {
  const a = fromConfig(project).values, b = fromConfig(tail).values;
  for (const k of ['fast_speed', 'test_accel', 'flow_ratio', 'max_flow', 'line_width', 'bed_temp_first', 'bed_x1', 'retract_length', 'nozzle_temp_first'])
    assert.equal(b[k], a[k], k);
  assert.equal(b.start_gcode, a.start_gcode);
});

t('placeholders', () => {
  const vars = { first_layer_temperature: [215], bed_temperature_initial_layer_single: 65, filament_type: ['PLA'] };
  const r = fill('M190 S[bed_temperature_initial_layer_single]\n{if filament_type[0]=="PLA"}M109 S{first_layer_temperature[0]-5}{else}x{endif}\nM104 S[first_layer_temperature]', vars);
  assert.equal(r.text, 'M190 S65\nM109 S210\nM104 S215');
  const u = fill('A {nope} [also_nope] {if nope}x{endif}', vars);
  assert.deepEqual(u.unknown.sort(), ['also_nope', 'nope']);
  assert.equal(u.text, 'A {nope} [also_nope] {if nope}x{endif}');
});

t('start G-code from the 3mf is filled', () => {
  const v = fromConfig(project).values;
  const r = generate(v, configVars(project));
  assert.deepEqual(r.start.unknown, []);
  assert.match(r.start.text, /PRINT_START BED=65 HOTEND=215/);
  assert.ok(!/M109/.test(r.gcode.split('; start G-code')[0]), 'no extra heating when the start G-code does it');
});

t('PA values', () => {
  assert.equal(paValues({ pa_start: 0, pa_end: 0.08, pa_step: 0.005 }).length, 17);
  assert.equal(paValues({ pa_start: 0.02, pa_end: 0.06, pa_step: 0.01 }).at(-1), 0.06);
  assert.equal(paValues({ pa_start: 0, pa_end: 0.08, pa_step: 0 }).length, 0);
});

t('generated G-code', () => {
  const v = defaults().values;
  const r = generate(v, null);
  const g = r.gcode;
  assert.equal((g.match(/^SET_PRESSURE_ADVANCE ADVANCE=/gm) || []).length, 17 + 2);
  assert.equal((g.match(/^;LAYER_CHANGE/gm) || []).length, 4);
  assert.match(g, /^M190 S60$/m); assert.match(g, /^M109 S215$/m);
  // stays on the bed, extrusion matches the line size, flow under the limit
  const filArea = Math.PI * (v.filament_diameter / 2) ** 2;
  let x = 0, y = 0, z = 0, h = v.first_layer_height;
  for (const line of g.split('\n')) {
    if (line.startsWith(';HEIGHT:')) h = +line.slice(8);
    const m = /^G1 (.*)/.exec(line);
    if (!m) continue;
    const w = Object.fromEntries(m[1].split(' ').map((p) => [p[0], +p.slice(1)]));
    const nx = w.X ?? x, ny = w.Y ?? y;
    if (w.Z !== undefined) z = w.Z;
    if (w.E > 0 && (nx !== x || ny !== y)) {
      const d = Math.hypot(nx - x, ny - y);
      const want = d * lineArea(v.line_width, h) / filArea * v.flow_ratio;
      assert.ok(Math.abs(w.E - want) < 1e-4, 'E per mm');
      assert.ok(w.F / 60 * lineArea(v.line_width, h) <= v.max_flow + 1e-6, 'flow');
      assert.ok(nx >= v.bed_x0 && nx <= v.bed_x1 && ny >= v.bed_y0 && ny <= v.bed_y1, 'on bed');
    }
    x = nx; y = ny;
  }
  assert.ok(r.stats.filament > 100);
});

t('fast speed is capped by max flow', () => {
  const v = { ...defaults().values, fast_speed: 400, max_flow: 12 };
  const d = derived(v);
  assert.ok(Math.abs(d.fast * d.area - 12) < 1e-9);
  assert.ok(check(v, generate(v, null)).some((c) => /limited to .* by max volumetric speed/.test(c.text)));
});

t('checks', () => {
  const base = defaults().values;
  const has = (v, re) => check(v, generate(v, null)).some((c) => re.test(c.text));
  assert.ok(has({ ...base, center_x: 20 }, /outside the printable area/));
  assert.ok(has({ ...base, flavor: 'marlin' }, /requires Klipper/));
  assert.ok(has({ ...base, test_accel: 300 }, /Fast speed not reached/));
  assert.ok(has({ ...base, start_gcode: 'M117 hi' }, /no G28 or start macro/));
  assert.ok(has({ ...base, start_gcode: 'PRINT_START T={unknown_thing}' }, /unknown placeholder: unknown_thing/));
  assert.ok(has({ ...base, filament_type: 'PLA', nozzle_temp_first: 260 }, /outside the typical/));
  assert.ok(!has({ ...base, start_gcode: 'PRINT_START' }, /no G28 or start macro/));
});

console.log(`\n${n} tests passed`);
