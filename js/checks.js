// Checks for settings that would give a bad test or do something odd on the printer.
// Each result: { level: 'error' | 'warn' | 'info', text }
import { paValues, derived, placement, lineArea } from './generate.js';

const TEMPS = {   // rough nozzle ranges by filament type
  PLA: [180, 240], PETG: [210, 270], ABS: [220, 280], ASA: [220, 285], TPU: [190, 250],
  PA: [240, 320], PC: [240, 320], HIPS: [210, 260], PVA: [180, 230], PET: [220, 280],
};

export function check(v, gen) {
  const out = [];
  const err = (t) => out.push({ level: 'error', text: t });
  const warn = (t) => out.push({ level: 'warn', text: t });
  const info = (t) => out.push({ level: 'info', text: t });
  const r1 = (x) => +x.toFixed(1);

  // firmware
  if (v.flavor && v.flavor !== 'klipper')
    err(`G-code flavor is ${v.flavor}. This test requires Klipper (SET_PRESSURE_ADVANCE, SET_VELOCITY_LIMIT).`);

  // PA range
  const ks = paValues(v);
  if (!(v.pa_step > 0)) err('PA step must be greater than 0.');
  else if (v.pa_end < v.pa_start) err('PA end must be greater than PA start.');
  else if (ks.length < 3) warn('Fewer than 3 bars. Increase the PA range or reduce the step.');
  else if (ks.length > 30) warn(`${ks.length} bars. Increase the PA step to reduce print size and time.`);
  if (v.pa_end > 0.2) warn('PA end above 0.2. Typical for bowden extruders only.');
  if (v.pa_start < 0) err('PA must not be negative.');

  // bars and layers
  const nl = Math.round(v.lines_per_bar);
  if (!(nl >= 1)) err('Lines per bar must be at least 1.');
  else if (nl > 10) warn(`${nl} lines per bar. Bars get wide and the print gets slow.`);
  if (!(Math.round(v.test_layers) >= 1)) err('PA test layers must be at least 1.');
  if (Math.round(v.base_layers) < 0) err('Base layers must not be negative.');
  if (Math.round(v.base_layers) === 0) info('No base layers. The PA test starts on the first layer, so first layer squish affects the result.');
  if (v.bar_overlap < 0 || v.bar_overlap > 200) warn('Bar / rim overlap outside 0–200%.');

  // speed and flow
  const D = derived(v);
  if (D.fastCapped) {
    const byFlow = v.max_flow > 0 && D.flowCap <= (v.max_speed > 0 ? v.max_speed : Infinity);
    warn(byFlow
      ? `Fast speed limited to ${r1(D.fast)} mm/s by max volumetric speed (${v.max_flow} mm³/s). Outer wall flow is ${r1(D.wallFlow)} mm³/s.`
      : `Fast speed limited to ${r1(D.fast)} mm/s by max speed.`);
  }
  if (D.fast < D.slow * 2) warn(`Fast speed (${r1(D.fast)} mm/s) is less than twice the slow speed (${r1(D.slow)} mm/s). PA effects may not be visible.`);
  if (!(v.max_flow > 0)) warn('Max volumetric speed not set. Speeds are not limited by flow.');
  if (D.accelCapped) warn(`Test acceleration limited to ${Math.round(D.accel)} mm/s² by max acceleration.`);
  if (!D.reached)
    warn(`Fast speed not reached: ${r1(D.peak)} of ${r1(D.fast)} mm/s over ${r1(D.fastLen)} mm at ${Math.round(D.accel)} mm/s². Increase acceleration or bar length.`);
  else if (D.rampDist > D.fastLen * 0.35)
    info(`Acceleration distance ${r1(D.rampDist)} mm of the ${r1(D.fastLen)} mm fast section.`);
  if (D.accel > 0 && D.accel < 1000) warn('Test acceleration below 1000 mm/s². PA effects may be small.');
  if (v.slow_length < 5) warn('Slow section shorter than 5 mm.');
  if (D.fastLen < 20) err('Fast section shorter than 20 mm. Increase bar length or reduce the slow section.');
  if (v.travel_accel > v.max_accel && v.max_accel > 0) info('Travel acceleration limited by max acceleration.');

  // bed
  const p = placement(v);
  const [x0, y0] = p.min, [x1, y1] = p.max;
  if (x0 < v.bed_x0 || y0 < v.bed_y0 || x1 > v.bed_x1 || y1 > v.bed_y1)
    err(`Test is outside the printable area: X ${r1(x0)} to ${r1(x1)}, Y ${r1(y0)} to ${r1(y1)} (bed X ${v.bed_x0} to ${v.bed_x1}, Y ${v.bed_y0} to ${v.bed_y1}).`);

  // lines and layers
  const n = v.nozzle_diameter;
  if (v.line_width < n * 0.6 || v.line_width > n * 2) warn(`Test line width ${v.line_width} mm is outside 60–200% of the ${n} mm nozzle.`);
  if (v.wall_width < n * 0.6 || v.wall_width > n * 1.6) warn(`Outer wall line width ${v.wall_width} mm is outside 60–160% of the ${n} mm nozzle.`);
  if (v.layer_height > n * 0.75) warn(`Layer height ${v.layer_height} mm exceeds 75% of the nozzle diameter.`);
  if (v.layer_height > Math.min(v.line_width, v.wall_width) * 0.9) err('Layer height must be less than 90% of the line width.');
  if (v.first_layer_height < 0.1) warn('First layer height below 0.1 mm.');
  if (v.overlap < 0 || v.overlap > 60) warn('Infill / wall overlap outside 0–60%.');
  if (v.flow_ratio < 0.8 || v.flow_ratio > 1.2) warn(`Flow ratio ${v.flow_ratio} is outside 0.8–1.2.`);
  if (v.filament_diameter !== 1.75 && v.filament_diameter !== 2.85 && v.filament_diameter !== 3)
    warn(`Filament diameter ${v.filament_diameter} mm is not a standard size.`);

  // temperatures
  const ft = (v.filament_type || '').toUpperCase().replace(/[-+ ].*$/, '');
  const range = TEMPS[ft] || TEMPS[Object.keys(TEMPS).find((k) => ft.startsWith(k))];
  if (!(v.nozzle_temp_first > 0)) err('First layer nozzle temperature not set.');
  else if (range && (v.nozzle_temp_first < range[0] || v.nozzle_temp_first > range[1]))
    warn(`Nozzle temperature ${v.nozzle_temp_first} °C is outside the typical ${range[0]}–${range[1]} °C range for ${ft}.`);
  else if (v.nozzle_temp_first < 170 || v.nozzle_temp_first > 320) warn(`Nozzle temperature ${v.nozzle_temp_first} °C is outside 170–320 °C.`);
  if (Math.abs(v.nozzle_temp - v.nozzle_temp_first) > 30) warn('First layer and other layers nozzle temperatures differ by more than 30 °C.');
  if (v.bed_temp_first > 120) warn(`Bed temperature ${v.bed_temp_first} °C is above 120 °C.`);

  // retraction
  if (!(v.retract_length > 0)) warn('Retraction disabled. Travel moves may cause stringing.');
  else if (v.retract_length > 3) info(`Retraction length ${v.retract_length} mm. Typical for bowden extruders only.`);
  if (v.retract_speed > 150) warn(`Retraction speed ${v.retract_speed} mm/s is above 150 mm/s.`);
  if (v.deretract_speed > v.retract_speed * 2 && v.retract_length > 0) warn('Deretraction speed is more than twice the retraction speed.');
  if (v.z_hop > 1) warn(`Z hop ${v.z_hop} mm is above 1 mm.`);

  // start / end G-code
  if (gen) {
    const s = gen.start, e = gen.end;
    if (s.unknown.length) err(`Start G-code: unknown placeholder: ${s.unknown.join(', ')}`);
    if (s.errors.length) err('Start G-code: ' + s.errors.join('; '));
    if (e.unknown.length) warn(`End G-code: unknown placeholder: ${e.unknown.join(', ')}`);
    if (e.errors.length) warn('End G-code: ' + e.errors.join('; '));
    const st = s.text;
    const macro = st.split('\n').some((l) => /^\s*[A-Z][A-Z0-9_]{2,}\b/.test(l) && !/^\s*[GMT]\d/.test(l));
    if (!/^\s*G28\b/mi.test(st) && !macro) warn('Start G-code contains no G28 or start macro. Printer may not be homed.');
    if (/^\s*M82\b/mi.test(st)) info('Start G-code sets absolute extrusion (M82). Relative extrusion (M83) is set after it.');
    if (!st.trim()) warn('Start G-code is empty.');
    if (!e.text.trim()) warn('End G-code is empty. Heaters will remain on after the print.');
    if (gen.stats.maxFlow > v.max_flow + 1e-6 && v.max_flow > 0) err('Generated G-code exceeds max volumetric speed.');
  }

  if (!out.some((c) => c.level !== 'info')) info('No issues found.');
  return out;
}

export { lineArea };
