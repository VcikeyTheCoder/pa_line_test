// Test settings: definitions, defaults, and reading them from Orca files

// Read Metadata/project_settings.config from an Orca / Bambu Studio 3mf
export function readProjectConfig(text) {
  const d = JSON.parse(text);
  const cfg = {};
  for (const [k, v] of Object.entries(d)) cfg[k] = v;
  return cfg;
}

// Read the settings Orca writes at the end of a G-code file
export function readGcodeConfig(text) {
  const start = text.lastIndexOf('; CONFIG_BLOCK_START');
  if (start < 0) return null;
  const end = text.indexOf('; CONFIG_BLOCK_END', start);
  const block = text.slice(start, end < 0 ? undefined : end);
  const cfg = {};
  for (const line of block.split('\n')) {
    const m = /^; ([a-zA-Z0-9_]+) = (.*)$/.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    cfg[m[1]] = { gcode: m[2] };       // split later, the type is not known here
  }
  return cfg;
}

// Raw value as a list of strings
function list(cfg, key) {
  const v = cfg[key];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'object' && 'gcode' in v) return v.gcode.split(',');
  return [String(v)];
}

// Text value (G-code and names). G-code files escape new lines as \n
export function text(cfg, key) {
  const v = cfg[key];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return String(v[0] ?? '');
  if (typeof v === 'object' && 'gcode' in v) return unescapeGcodeValue(v.gcode);
  return String(v);
}

export function unescapeGcodeValue(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const c = s[++i];
      out += c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
    } else out += s[i];
  }
  return out;
}

// First number of a value. Percent values are returned as {pct}
function num(cfg, key) {
  const l = list(cfg, key);
  if (!l || !l.length) return null;
  const s = l[0].trim().replace(/^"|"$/g, '');
  if (s.endsWith('%')) {
    const p = parseFloat(s);
    return isFinite(p) ? { pct: p } : null;
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function plain(v) { return typeof v === 'number' ? v : null; }

// Value for every config key, as numbers where possible (for the start G-code)
export function configVars(cfg) {
  const out = {};
  for (const k of Object.keys(cfg)) {
    const v = cfg[k];
    let items;
    if (Array.isArray(v)) items = v.map(String);
    else if (typeof v === 'object' && v && 'gcode' in v) {
      const t = unescapeGcodeValue(v.gcode);
      // only split plain number lists, leave G-code and text alone
      items = /^[-0-9.,%x ]*$/.test(t) && t.includes(',') ? t.split(',') : [t];
      if (items.length === 1) { out[k] = toValue(items[0]); continue; }
    } else { out[k] = toValue(String(v)); continue; }
    out[k] = items.map(toValue);
  }
  return out;
}

function toValue(s) {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return parseFloat(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return s.replace(/^"(.*)"$/, '$1');
}

const PLATE_KEYS = {
  'Cool Plate': 'cool_plate_temp',
  'Engineering Plate': 'eng_plate_temp',
  'High Temp Plate': 'hot_plate_temp',
  'Textured PEI Plate': 'textured_plate_temp',
  'Textured Cool Plate': 'textured_cool_plate_temp',
  'Supertack Plate': 'supertack_plate_temp',
  'SuperTack Plate': 'supertack_plate_temp',
};

export function plateKey(cfg) {
  const t = text(cfg, 'curr_bed_type');
  return PLATE_KEYS[t] || 'hot_plate_temp';
}

// The settings shown on the page. `read` gets the value from an Orca config
export const GROUPS = [
  ['test', 'Test'],
  ['speed', 'Speed and acceleration'],
  ['lines', 'Lines and layers'],
  ['filament', 'Filament and temperature'],
  ['retract', 'Retraction'],
  ['printer', 'Printer'],
];

const nozzleOf = (cfg) => plain(num(cfg, 'nozzle_diameter')) || 0.4;
function width(cfg, key) {
  const v = num(cfg, key) ?? num(cfg, 'line_width');
  if (v && typeof v === 'object') return +(nozzleOf(cfg) * v.pct / 100).toFixed(3);
  return v || null;
}
function accel(cfg, key) {
  const v = plain(num(cfg, key));
  return v ? v : plain(num(cfg, 'default_acceleration'));
}

export const FIELDS = [
  // test
  { id: 'pa_start', g: 'test', label: 'PA start', def: 0, step: 0.001 },
  { id: 'pa_end', g: 'test', label: 'PA end', def: 0.08, step: 0.001 },
  { id: 'pa_step', g: 'test', label: 'PA step', def: 0.005, step: 0.001 },
  { id: 'base_pa', g: 'test', label: 'PA for rim, tabs and numbers', def: 0.04, step: 0.001,
    read: (c) => plain(num(c, 'pressure_advance')) },
  { id: 'line_length', g: 'test', label: 'Bar length', unit: 'mm', def: 90, step: 1 },
  { id: 'slow_length', g: 'test', label: 'Slow part at each end', unit: 'mm', def: 20, step: 1 },
  { id: 'center_x', g: 'test', label: 'Center X', unit: 'mm', def: null, step: 1,
    read: (c) => bedOf(c) && (bedOf(c).x0 + bedOf(c).x1) / 2 },
  { id: 'center_y', g: 'test', label: 'Center Y', unit: 'mm', def: null, step: 1,
    read: (c) => bedOf(c) && (bedOf(c).y0 + bedOf(c).y1) / 2 },
  // speed and acceleration
  { id: 'fast_speed', g: 'speed', label: 'Fast speed (outer wall)', unit: 'mm/s', def: 150, step: 1,
    read: (c) => plain(num(c, 'outer_wall_speed')) },
  { id: 'test_accel', g: 'speed', label: 'Test acceleration (outer wall)', unit: 'mm/s²', def: 3000, step: 100,
    read: (c) => accel(c, 'outer_wall_acceleration') },
  { id: 'slow_speed', g: 'speed', label: 'Slow speed', unit: 'mm/s', def: 20, step: 1 },
  { id: 'first_layer_speed', g: 'speed', label: 'First layer speed', unit: 'mm/s', def: 40, step: 1,
    read: (c) => plain(num(c, 'initial_layer_speed')) },
  { id: 'first_layer_accel', g: 'speed', label: 'First layer acceleration', unit: 'mm/s²', def: 1000, step: 100,
    read: (c) => accel(c, 'initial_layer_acceleration') },
  { id: 'wall_speed', g: 'speed', label: 'Rim speed', unit: 'mm/s', def: 100, step: 1,
    read: (c) => plain(num(c, 'inner_wall_speed')) },
  { id: 'solid_speed', g: 'speed', label: 'Solid infill speed', unit: 'mm/s', def: 100, step: 1,
    read: (c) => plain(num(c, 'internal_solid_infill_speed')) },
  { id: 'top_speed', g: 'speed', label: 'Top surface speed', unit: 'mm/s', def: 80, step: 1,
    read: (c) => plain(num(c, 'top_surface_speed')) },
  { id: 'print_accel', g: 'speed', label: 'Other acceleration', unit: 'mm/s²', def: 3000, step: 100,
    read: (c) => plain(num(c, 'default_acceleration')) },
  { id: 'travel_speed', g: 'speed', label: 'Travel speed', unit: 'mm/s', def: 200, step: 1,
    read: (c) => plain(num(c, 'travel_speed')) },
  { id: 'travel_accel', g: 'speed', label: 'Travel acceleration', unit: 'mm/s²', def: 5000, step: 100,
    read: (c) => accel(c, 'travel_acceleration') },
  // lines and layers
  { id: 'line_width', g: 'lines', label: 'Line width', unit: 'mm', def: 0.45, step: 0.01,
    read: (c) => width(c, 'outer_wall_line_width') },
  { id: 'layer_height', g: 'lines', label: 'Layer height', unit: 'mm', def: 0.2, step: 0.01,
    read: (c) => plain(num(c, 'layer_height')) },
  { id: 'first_layer_height', g: 'lines', label: 'First layer height', unit: 'mm', def: 0.2, step: 0.01,
    read: (c) => plain(num(c, 'initial_layer_print_height')) },
  { id: 'overlap', g: 'lines', label: 'Infill / wall overlap', unit: '%', def: 30, step: 1 },
  // filament
  { id: 'flow_ratio', g: 'filament', label: 'Flow ratio', def: 1, step: 0.01,
    read: (c) => plain(num(c, 'filament_flow_ratio')) },
  { id: 'max_flow', g: 'filament', label: 'Max volumetric speed', unit: 'mm³/s', def: 15, step: 0.5,
    read: (c) => plain(num(c, 'filament_max_volumetric_speed')) },
  { id: 'filament_diameter', g: 'filament', label: 'Filament diameter', unit: 'mm', def: 1.75, step: 0.01,
    read: (c) => plain(num(c, 'filament_diameter')) },
  { id: 'nozzle_temp_first', g: 'filament', label: 'Nozzle, first layer', unit: '°C', def: 215, step: 1,
    read: (c) => plain(num(c, 'nozzle_temperature_initial_layer')) },
  { id: 'nozzle_temp', g: 'filament', label: 'Nozzle', unit: '°C', def: 215, step: 1,
    read: (c) => plain(num(c, 'nozzle_temperature')) },
  { id: 'bed_temp_first', g: 'filament', label: 'Bed, first layer', unit: '°C', def: 60, step: 1,
    read: (c) => plain(num(c, plateKey(c) + '_initial_layer')) },
  { id: 'bed_temp', g: 'filament', label: 'Bed', unit: '°C', def: 60, step: 1,
    read: (c) => plain(num(c, plateKey(c))) },
  { id: 'fan_speed', g: 'filament', label: 'Fan', unit: '%', def: 100, step: 1,
    read: (c) => plain(num(c, 'fan_min_speed')) },
  { id: 'fan_off_layers', g: 'filament', label: 'Fan off for first layers', def: 1, step: 1,
    read: (c) => plain(num(c, 'close_fan_the_first_x_layers')) },
  // retraction
  { id: 'retract_length', g: 'retract', label: 'Length', unit: 'mm', def: 0.8, step: 0.05,
    read: (c) => plain(num(c, 'retraction_length')) },
  { id: 'retract_speed', g: 'retract', label: 'Speed', unit: 'mm/s', def: 35, step: 1,
    read: (c) => plain(num(c, 'retraction_speed')) },
  { id: 'deretract_speed', g: 'retract', label: 'Deretraction speed', unit: 'mm/s', def: 35, step: 1,
    read: (c) => { const v = plain(num(c, 'deretraction_speed')); return v || plain(num(c, 'retraction_speed')); } },
  { id: 'z_hop', g: 'retract', label: 'Z hop', unit: 'mm', def: 0.2, step: 0.05,
    read: (c) => plain(num(c, 'z_hop')) },
  { id: 'retract_min_travel', g: 'retract', label: 'Only retract above travel of', unit: 'mm', def: 1, step: 0.5,
    read: (c) => plain(num(c, 'retraction_minimum_travel')) },
  // printer
  { id: 'bed_x0', g: 'printer', label: 'Bed X min', unit: 'mm', def: 0, step: 1, read: (c) => bedOf(c) && bedOf(c).x0 },
  { id: 'bed_y0', g: 'printer', label: 'Bed Y min', unit: 'mm', def: 0, step: 1, read: (c) => bedOf(c) && bedOf(c).y0 },
  { id: 'bed_x1', g: 'printer', label: 'Bed X max', unit: 'mm', def: 235, step: 1, read: (c) => bedOf(c) && bedOf(c).x1 },
  { id: 'bed_y1', g: 'printer', label: 'Bed Y max', unit: 'mm', def: 235, step: 1, read: (c) => bedOf(c) && bedOf(c).y1 },
  { id: 'nozzle_diameter', g: 'printer', label: 'Nozzle diameter', unit: 'mm', def: 0.4, step: 0.05,
    read: (c) => plain(num(c, 'nozzle_diameter')) },
  { id: 'max_accel', g: 'printer', label: 'Max acceleration', unit: 'mm/s²', def: 10000, step: 100,
    read: (c) => {
      const x = plain(num(c, 'machine_max_acceleration_x')), y = plain(num(c, 'machine_max_acceleration_y'));
      return x && y ? Math.min(x, y) : (x || y);
    } },
  { id: 'max_speed', g: 'printer', label: 'Max speed', unit: 'mm/s', def: 500, step: 10,
    read: (c) => {
      const x = plain(num(c, 'machine_max_speed_x')), y = plain(num(c, 'machine_max_speed_y'));
      return x && y ? Math.min(x, y) : (x || y);
    } },
];

const bedCache = new WeakMap();
function bedOf(cfg) {
  if (bedCache.has(cfg)) return bedCache.get(cfg);
  const l = list(cfg, 'printable_area');
  let r = null;
  if (l && l.length >= 3) {
    const pts = l.map((p) => p.trim().replace(/"/g, '').split('x').map(Number)).filter((p) => p.length === 2 && p.every(isFinite));
    if (pts.length >= 3) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
  bedCache.set(cfg, r);
  return r;
}

// Default settings, then everything the file has
export function defaults() {
  const v = {}, src = {};
  for (const f of FIELDS) { v[f.id] = f.def; src[f.id] = 'default'; }
  v.center_x = (v.bed_x0 + v.bed_x1) / 2; v.center_y = (v.bed_y0 + v.bed_y1) / 2;
  v.start_gcode = 'G28\n'; v.end_gcode = 'M104 S0\nM140 S0\nM107\nG91\nG1 Z10 F600\nG90\nM84\n';
  v.flavor = 'klipper';
  src.start_gcode = src.end_gcode = 'default';
  return { values: v, source: src };
}

export function fromConfig(cfg) {
  const { values, source } = defaults();
  for (const f of FIELDS) {
    if (!f.read) continue;
    let v = f.read(cfg);
    if (typeof v === 'number' && isFinite(v)) {
      values[f.id] = +v.toFixed(4); source[f.id] = 'file';
    }
  }
  // keep the bed center if the bed came from the file but the center did not
  if (source.bed_x1 === 'file' && source.center_x !== 'file') values.center_x = (values.bed_x0 + values.bed_x1) / 2;
  if (source.bed_y1 === 'file' && source.center_y !== 'file') values.center_y = (values.bed_y0 + values.bed_y1) / 2;
  const sg = text(cfg, 'machine_start_gcode'), eg = text(cfg, 'machine_end_gcode');
  if (sg !== null) { values.start_gcode = sg; source.start_gcode = 'file'; }
  if (eg !== null) { values.end_gcode = eg; source.end_gcode = 'file'; }
  values.flavor = (text(cfg, 'gcode_flavor') || 'klipper').toLowerCase();
  values.filament_type = (text(cfg, 'filament_type') || '').split(/[;,]/)[0].replace(/"/g, '').trim();
  return { values, source };
}

// Names shown after loading a file
export function profileNames(cfg) {
  const t = (k) => { const v = text(cfg, k); return v ? v.replace(/^"|"$/g, '').split('";"')[0] : null; };
  return {
    printer: t('printer_settings_id'),
    filament: t('filament_settings_id'),
    process: t('print_settings_id'),
    version: t('version'),
  };
}
