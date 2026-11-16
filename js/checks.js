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
    err(`The file says the firmware is ${v.flavor}. This test uses Klipper commands (SET_PRESSURE_ADVANCE, SET_VELOCITY_LIMIT).`);

  // PA range
  const ks = paValues(v);
  if (!(v.pa_step > 0)) err('PA step has to be more than 0.');
  else if (v.pa_end < v.pa_start) err('PA end is lower than PA start.');
  else if (ks.length < 3) warn('Less than 3 bars. Use a wider range or a smaller step.');
  else if (ks.length > 30) warn(`${ks.length} bars is a lot. The test gets tall and slow, use a bigger step.`);
  if (v.pa_end > 0.2) warn('PA above 0.2 is unusual for direct drive. Fine for a long bowden.');
  if (v.pa_start < 0) err('PA can\'t be negative.');

  // speed and flow
  const D = derived(v);
  if (D.fastCapped) {
    const byFlow = v.max_flow > 0 && D.flowCap <= (v.max_speed > 0 ? v.max_speed : Infinity);
    warn(byFlow
      ? `Fast speed ${v.fast_speed} mm/s needs ${r1(D.wantedFlow)} mm³/s, max volumetric speed is ${v.max_flow}. Using ${r1(D.fast)} mm/s.`
      : `Fast speed is above the printer's max speed. Using ${r1(D.fast)} mm/s.`);
  }
  if (D.fast < D.slow * 2) warn(`Fast speed (${r1(D.fast)}) is less than twice the slow speed (${r1(D.slow)}). The speed change may be too small to see anything.`);
  if (!(v.max_flow > 0)) warn('No max volumetric speed set, speeds are not limited by flow.');
  if (D.accelCapped) warn(`Test acceleration ${v.test_accel} is above the printer max ${v.max_accel}. Using ${Math.round(D.accel)}.`);
  if (!D.reached)
    warn(`At ${Math.round(D.accel)} mm/s² the line never gets to ${r1(D.fast)} mm/s in the ${r1(D.fastLen)} mm fast part (top speed ${r1(D.peak)}). Raise the acceleration or the bar length.`);
  else if (D.rampDist > D.fastLen * 0.35)
    info(`Speed-up takes ${r1(D.rampDist)} mm of the ${r1(D.fastLen)} mm fast part. Short full-speed part.`);
  if (D.accel > 0 && D.accel < 1000) warn('Test acceleration below 1000 mm/s² is unusual and gives a weak test.');
  if (v.slow_length < 5) warn('Slow part under 5 mm, the start of the line is hard to read.');
  if (D.fastLen < 20) err('Fast part is shorter than 20 mm. Make the bars longer or the slow part shorter.');
  if (v.travel_accel > v.max_accel && v.max_accel > 0) info('Travel acceleration is above the max, it is capped.');

  // bed
  const p = placement(v);
  const [x0, y0] = p.min, [x1, y1] = p.max;
  if (x0 < v.bed_x0 || y0 < v.bed_y0 || x1 > v.bed_x1 || y1 > v.bed_y1)
    err(`The test (${r1(x0)}, ${r1(y0)} to ${r1(x1)}, ${r1(y1)}) is off the bed (${v.bed_x0}, ${v.bed_y0} to ${v.bed_x1}, ${v.bed_y1}). Move the center or use fewer bars.`);

  // lines and layers
  const n = v.nozzle_diameter;
  if (v.line_width < n * 0.6 || v.line_width > n * 1.6) warn(`Line width ${v.line_width} is unusual for a ${n} mm nozzle.`);
  if (v.layer_height > n * 0.75) warn(`Layer height ${v.layer_height} is high for a ${n} mm nozzle.`);
  if (v.layer_height > v.line_width * 0.9) err('Layer height is close to the line width, the lines won\'t squish.');
  if (v.first_layer_height < 0.1) warn('First layer under 0.1 mm is easy to get wrong.');
  if (v.overlap < 0 || v.overlap > 60) warn('Infill / wall overlap outside 0–60 % looks wrong.');
  if (v.flow_ratio < 0.8 || v.flow_ratio > 1.2) warn(`Flow ratio ${v.flow_ratio} is far from 1. Check it.`);
  if (v.filament_diameter !== 1.75 && v.filament_diameter !== 2.85 && v.filament_diameter !== 3)
    warn(`Filament diameter ${v.filament_diameter} mm is not a usual size.`);

  // temperatures
  const ft = (v.filament_type || '').toUpperCase().replace(/[-+ ].*$/, '');
  const range = TEMPS[ft] || TEMPS[Object.keys(TEMPS).find((k) => ft.startsWith(k))];
  if (!(v.nozzle_temp_first > 0)) err('No first layer nozzle temperature.');
  else if (range && (v.nozzle_temp_first < range[0] || v.nozzle_temp_first > range[1]))
    warn(`${v.nozzle_temp_first} °C is outside the usual ${range[0]}–${range[1]} °C for ${ft}.`);
  else if (v.nozzle_temp_first < 170 || v.nozzle_temp_first > 320) warn(`Nozzle ${v.nozzle_temp_first} °C looks wrong.`);
  if (Math.abs(v.nozzle_temp - v.nozzle_temp_first) > 30) warn('First layer and other layer nozzle temperatures are more than 30 °C apart.');
  if (v.bed_temp_first > 120) warn(`Bed ${v.bed_temp_first} °C is very hot.`);

  // retraction
  if (!(v.retract_length > 0)) warn('No retraction. Travels between lines will string.');
  else if (v.retract_length > 3) info(`Retraction ${v.retract_length} mm is long for direct drive (fine for bowden).`);
  if (v.retract_speed > 150) warn(`Retraction speed ${v.retract_speed} mm/s is very fast.`);
  if (v.deretract_speed > v.retract_speed * 2 && v.retract_length > 0) warn('Deretraction is much faster than retraction.');
  if (v.z_hop > 1) warn(`Z hop ${v.z_hop} mm is high for a 4 layer print.`);

  // start / end G-code
  if (gen) {
    const s = gen.start, e = gen.end;
    if (s.unknown.length) err(`Start G-code has placeholders I can't fill: ${s.unknown.join(', ')}. Edit them by hand.`);
    if (s.errors.length) err('Start G-code: ' + s.errors.join('; '));
    if (e.unknown.length) warn(`End G-code has placeholders I can't fill: ${e.unknown.join(', ')}.`);
    if (e.errors.length) warn('End G-code: ' + e.errors.join('; '));
    const st = s.text;
    const macro = st.split('\n').some((l) => /^\s*[A-Z][A-Z0-9_]{2,}\b/.test(l) && !/^\s*[GMT]\d/.test(l));
    if (!/^\s*G28\b/mi.test(st) && !macro) warn('Start G-code has no G28 and no macro (like PRINT_START). The printer may not home.');
    if (/^\s*M82\b/mi.test(st)) info('Start G-code sets absolute extrusion (M82). The test switches to relative (M83) after it.');
    if (!st.trim()) warn('Start G-code is empty.');
    if (!e.text.trim()) warn('End G-code is empty. Heaters stay on after the test.');
    if (gen.stats.maxFlow > v.max_flow + 1e-6 && v.max_flow > 0) err('Generated G-code goes over the max volumetric speed.');
  }

  if (!out.some((c) => c.level !== 'info')) info('Nothing looks off.');
  return out;
}

export { lineArea };
