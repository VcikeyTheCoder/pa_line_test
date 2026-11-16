import { unzipSync, strFromU8 } from 'fflate';
import { FIELDS, GROUPS, defaults, fromConfig, readProjectConfig, readGcodeConfig, configVars, profileNames } from './settings.js';
import { generate, derived, layers } from './generate.js';
import { check } from './checks.js';
import { Preview, COLORS } from './preview.js';

const $ = (id) => document.getElementById(id);
const state = { values: null, source: null, fileValues: null, cfgVars: null, gen: null, name: 'pa_line_test' };
let preview = null;

// ---------- form
function buildForm() {
  const form = $('form');
  form.innerHTML = '';
  for (const [g, title] of GROUPS) {
    const fs = document.createElement('fieldset');
    const det = document.createElement('details');
    det.open = g === 'test' || g === 'speed';
    det.innerHTML = `<summary>${title}</summary>`;
    const box = document.createElement('div');
    box.className = 'fields';
    for (const f of FIELDS.filter((x) => x.g === g)) {
      const row = document.createElement('div');
      if (f.type === 'bool') {
        row.className = 'field check';
        row.innerHTML = `<label for="f_${f.id}"><input type="checkbox" id="f_${f.id}"> ${f.label}</label>`;
        box.appendChild(row);
        row.querySelector('input').addEventListener('change', (e) => {
          state.values[f.id] = e.target.checked; state.source[f.id] = 'edited'; schedule();
        });
        continue;
      }
      row.className = 'field';
      row.innerHTML = `<label for="f_${f.id}">${f.label}</label>
        <span class="input" id="w_${f.id}"><input type="number" id="f_${f.id}" step="${f.step}" inputmode="decimal">${f.unit ? `<span class="unit">${f.unit}</span>` : ''}</span>`;
      box.appendChild(row);
      row.querySelector('input').addEventListener('input', (e) => {
        const n = parseFloat(e.target.value);
        if (!isFinite(n)) return;
        state.values[f.id] = n;
        state.source[f.id] = 'edited';
        tag(f.id);
        schedule();
      });
    }
    if (g === 'speed') box.insertAdjacentHTML('beforeend', '<p class="derived" id="derived"></p>');
    if (g === 'test') box.insertAdjacentHTML('beforeend', '<p class="hint">Left end of each bar: push. Right end: pull.</p>');
    det.appendChild(box); fs.appendChild(det); form.appendChild(fs);
  }
  // start / end G-code
  const fs = document.createElement('fieldset');
  fs.innerHTML = `<details><summary>Start and end G-code</summary><div class="fields">
    <div class="gc-label"><label for="f_start_gcode">Start G-code</label></div>
    <textarea id="f_start_gcode" spellcheck="false"></textarea>
    <details class="filled"><summary>Output</summary><pre id="startFilled"></pre></details>
    <div class="gc-label"><label for="f_end_gcode">End G-code</label></div>
    <textarea id="f_end_gcode" spellcheck="false"></textarea>
    <details class="filled"><summary>Output</summary><pre id="endFilled"></pre></details>
    <p class="hint">Placeholders such as {first_layer_temperature[0]} and [bed_temperature_initial_layer_single] are replaced with the values above.</p>
  </div></details>`;
  form.appendChild(fs);
  for (const k of ['start_gcode', 'end_gcode']) {
    $('f_' + k).addEventListener('input', (e) => {
      state.values[k] = e.target.value; state.source[k] = 'edited'; tag(k); schedule();
    });
  }
}

function tag(id) {
  const el = id.endsWith('gcode') ? $('f_' + id) : $('w_' + id);
  if (!el) return;
  el.classList.toggle('file', state.source[id] === 'file');
  el.classList.toggle('edited', state.source[id] === 'edited');
}

function fillForm() {
  for (const f of FIELDS) {
    const v = state.values[f.id];
    if (f.type === 'bool') { $('f_' + f.id).checked = !!v; continue; }
    $('f_' + f.id).value = v === null || v === undefined ? '' : +(+v).toFixed(4);
    tag(f.id);
  }
  for (const k of ['start_gcode', 'end_gcode']) { $('f_' + k).value = state.values[k]; tag(k); }
}

// ---------- loading
async function loadFile(file) {
  const box = $('loaded');
  box.hidden = false; box.className = 'loaded';
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let cfg = null, kind;
    if (/\.3mf$/i.test(file.name)) {
      kind = '3mf';
      const files = unzipSync(buf, { filter: (f) => /project_settings\.config$/i.test(f.name) });
      const key = Object.keys(files)[0];
      if (!key) throw new Error('No project settings found in 3mf. Use File > Save project in OrcaSlicer. Plain 3mf exports contain no settings.');
      cfg = readProjectConfig(strFromU8(files[key]));
    } else {
      kind = 'G-code';
      cfg = readGcodeConfig(strFromU8(buf));
      if (!cfg) throw new Error('No settings found in G-code. Only G-code exported from OrcaSlicer or Bambu Studio is supported.');
    }
    const s = fromConfig(cfg);
    state.values = s.values; state.source = s.source;
    state.fileValues = { values: { ...s.values }, source: { ...s.source } };
    state.cfgVars = configVars(cfg);
    const names = profileNames(cfg);
    const found = FIELDS.filter((f) => s.source[f.id] === 'file').length;
    box.innerHTML = `<b>${esc(file.name)}</b><br>` +
      [names.printer && `Printer: ${esc(names.printer)}`, names.filament && `Filament: ${esc(names.filament)}`, names.process && `Process: ${esc(names.process)}`]
        .filter(Boolean).join('<br>') +
      `<br>${found} settings loaded from ${kind}.`;
    state.name = 'pa_line_test_' + (s.values.filament_type || 'test').replace(/[^a-z0-9]+/gi, '_');
    $('reset').disabled = false;
    fillForm(); run();
  } catch (e) {
    box.className = 'loaded bad';
    box.textContent = e.message || String(e);
  }
}

function startDefaults() {
  const s = defaults();
  state.values = s.values; state.source = s.source; state.cfgVars = null; state.fileValues = null;
  state.name = 'pa_line_test';
  $('loaded').hidden = false; $('loaded').className = 'loaded';
  $('loaded').innerHTML = 'Default settings loaded. Set printer and filament values below.';
  $('reset').disabled = true;
  fillForm(); run();
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- generate
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 250); }

function run() {
  if (!state.values) return;
  const v = state.values;
  let gen = null;
  try { gen = generate(v, state.cfgVars); } catch (e) { console.error(e); }
  state.gen = gen;
  const checks = check(v, gen);
  showChecks(checks);
  showDerived(v);
  const blocked = checks.some((c) => c.level === 'error');
  $('download').disabled = !gen;
  $('dlnote').textContent = blocked ? 'Resolve the errors before printing.' : '';
  if (!gen) return;
  $('startFilled').textContent = gen.start.text;
  $('endFilled').textContent = gen.end.text;
  const p = gen.place;
  $('summary').innerHTML = [
    ['Bars', `${p.L.ks.length} (PA ${p.L.ks[0]} to ${p.L.ks[p.L.ks.length - 1]})`],
    ['Size', `${(p.max[0] - p.min[0]).toFixed(0)} × ${(p.max[1] - p.min[1]).toFixed(0)} mm`],
    ['Fast / slow', `${+gen.derived.fast.toFixed(1)} / ${+gen.derived.slow.toFixed(1)} mm/s`],
    ['Acceleration', `${Math.round(gen.derived.accel)} mm/s²`],
    ['Filament', `${(gen.stats.filament / 1000).toFixed(2)} m`],
    ['Time', `about ${Math.max(1, Math.round(gen.stats.time / 60))} min`],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  // layer slider follows the layer count, stays at the top when it was there
  const total = layers(v).total, sl = $('layer');
  const atTop = +sl.value >= +sl.max;
  sl.max = total;
  if (atTop || +sl.value > total) sl.value = total;
  $('layerOut').textContent = `${sl.value} / ${total}`;
  showPreview(gen, v);
  if (preview) preview.setLayer(+sl.value);
}

function showDerived(v) {
  const d = derived(v), el = $('derived');
  if (!el) return;
  el.innerHTML = `Fast speed: <b>${+d.fast.toFixed(1)} mm/s</b> at ${v.line_width} mm (${+d.fastFlow.toFixed(1)} mm³/s${d.fastCapped ? ', limited' : ', same flow as outer wall'})<br>` +
    `Acceleration: <b>${Math.round(d.accel)} mm/s²</b>${d.accelCapped ? ' (limited)' : ''}<br>Acceleration distance: ${+d.rampDist.toFixed(1)} mm`;
}

function showChecks(list) {
  const word = { error: 'Error', warn: 'Warning', info: 'Info' };
  const order = { error: 0, warn: 1, info: 2 };
  $('checks').innerHTML = list.slice().sort((a, b) => order[a.level] - order[b.level])
    .map((c) => `<li class="${c.level}"><b>${word[c.level]}:</b>${esc(c.text)}</li>`).join('');
}

let lastView = 'angle';
function showPreview(gen, v) {
  if (!preview) {
    try { preview = new Preview($('view')); }
    catch (e) { $('empty').textContent = 'Preview requires WebGL, which is not available in this browser.'; return; }
  }
  $('empty').hidden = true;
  preview.setBed({ x0: v.bed_x0, y0: v.bed_y0, x1: v.bed_x1, y1: v.bed_y1 });
  preview.setGcode(gen.gcode);
  const p = gen.place;
  const box = { min: p.min, max: p.max,
    pushX: p.L.ix0 + p.dx + v.slow_length, pullX: p.L.ix1 + p.dx - v.slow_length };
  const changed = JSON.stringify(box) !== JSON.stringify(preview.box);
  if (changed) preview.view(lastView, box);
}

function download() {
  if (!state.gen) return;
  const blob = new Blob([state.gen.gcode], { type: 'text/plain' });
  const a = document.createElement('a');
  const v = state.values;
  a.href = URL.createObjectURL(blob);
  a.download = `${state.name}_${v.pa_start}-${v.pa_end}.gcode`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- light / dark switch (light by default)
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function showTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const b = $('theme');
  b.innerHTML = dark ? SUN + 'Light' : MOON + 'Dark';
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
  showTheme();
  if (preview) { preview.theme(); preview.render(); }
}

// ---------- wiring
function init() {
  showTheme();
  $('theme').addEventListener('click', toggleTheme);
  buildForm();
  const drop = $('drop'), input = $('file');
  input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  $('manual').addEventListener('click', startDefaults);
  $('reset').addEventListener('click', () => {
    if (!state.fileValues) return;
    state.values = { ...state.fileValues.values }; state.source = { ...state.fileValues.source };
    fillForm(); run();
  });
  $('download').addEventListener('click', download);
  $('layer').addEventListener('input', (e) => {
    $('layerOut').textContent = `${e.target.value} / ${e.target.max}`;
    if (preview) preview.setLayer(+e.target.value);
  });
  document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b));
    lastView = b.dataset.view;
    if (preview) preview.view(lastView);
  }));
  $('key').innerHTML = Object.values(COLORS).map(([c, n]) => `<li><i style="background:${c}"></i>${n}</li>`).join('');
}

init();
