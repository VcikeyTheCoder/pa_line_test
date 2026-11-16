// 3D preview of the generated G-code (read back from the G-code text itself)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const COLORS = {
  'Test slow': ['#4f8fc0', 'Slow'],
  'Test fast': ['#e07b39', 'Fast'],
  'Outer wall': ['#c9a227', 'Outer wall'],
  'Inner wall': ['#ddc77a', 'Inner wall'],
  'Bottom surface': ['#6b9e7f', 'Bottom'],
  'Internal solid infill': ['#8c80b8', 'Solid infill'],
  'Top surface': ['#c45e5e', 'Top'],
  'Numbers': ['#f2f2f2', 'Numbers'],
};

// Extrusion moves from G-code: [x0, y0, x1, y1, z, h, layer, type]
export function parseGcode(text) {
  const segs = [];
  let x = 0, y = 0, z = 0, h = 0.2, layer = 0, type = '', rel = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === ';') {
      if (line.startsWith(';TYPE:')) type = line.slice(6);
      else if (line === ';LAYER_CHANGE') layer++;
      else if (line.startsWith(';HEIGHT:')) h = parseFloat(line.slice(8)) || h;
      continue;
    }
    const code = line.split(';')[0].trim();
    if (code === 'M83') { rel = true; continue; }
    if (code === 'M82') { rel = false; continue; }
    if (!/^G[01]\b/.test(code)) continue;
    let nx = x, ny = y, e = null;
    for (const w of code.split(/\s+/).slice(1)) {
      const v = parseFloat(w.slice(1));
      if (w[0] === 'X') nx = v; else if (w[0] === 'Y') ny = v; else if (w[0] === 'Z') z = v; else if (w[0] === 'E') e = v;
    }
    if (e !== null && rel && e > 0 && (nx !== x || ny !== y)) segs.push([x, y, nx, ny, z, h, layer, type]);
    x = nx; y = ny;
  }
  return segs;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export class Preview {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50545a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-60, -90, 140); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(120, 80, 60); this.scene.add(fill);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.bedGroup = new THREE.Group(); this.scene.add(this.bedGroup);
    this.maxLayer = 99;
    new ResizeObserver(() => this.resize()).observe(el);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.theme(); this.render(); });
    this.theme();
    this.resize();
  }
  theme() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    this.dark = dark;
    this.scene.background = new THREE.Color(cssVar('--field') || (dark ? '#191c1f' : '#f8f9fa'));
    if (this.bed) this.setBed(this.bed);
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.render();
  }
  setBed(b) {
    this.bed = b;
    this.bedGroup.clear();
    const wx = b.x1 - b.x0, wy = b.y1 - b.y0;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(wx, wy),
      new THREE.MeshStandardMaterial({ color: this.dark ? 0x2a2e33 : 0xd9dde2, roughness: 0.95 }));
    plate.position.set(b.x0 + wx / 2, b.y0 + wy / 2, -0.02);
    this.bedGroup.add(plate);
    const step = 10, pts = [];
    for (let x = b.x0; x <= b.x1 + 1e-6; x += step) pts.push(x, b.y0, 0, x, b.y1, 0);
    for (let y = b.y0; y <= b.y1 + 1e-6; y += step) pts.push(b.x0, y, 0, b.x1, y, 0);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bedGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: this.dark ? 0x353a40 : 0xc6cbd1 })));
  }
  setGcode(text, width) {
    this.segs = parseGcode(text);
    this.width = width;
    this.build();
  }
  build() {
    this.group.clear();
    const segs = this.segs.filter((s) => s[6] <= this.maxLayer);
    if (!segs.length) { this.render(); return; }
    const W = this.width;
    const body = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1); body.rotateZ(Math.PI / 2);
    const cap = new THREE.SphereGeometry(0.5, 10, 6);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
    const n = segs.length;
    const bodies = new THREE.InstancedMesh(body, mat, n), ends = new THREE.InstancedMesh(cap, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const zAxis = new THREE.Vector3(0, 0, 1);
    segs.forEach(([x0, y0, x1, y1, z, h, , type], i) => {
      const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0), zc = z - h / 2;
      q.setFromAxisAngle(zAxis, ang);
      m.compose(p.set((x0 + x1) / 2, (y0 + y1) / 2, zc), q, s.set(len, W, h));
      bodies.setMatrixAt(i, m);
      c.set((COLORS[type] || ['#999999'])[0]);
      bodies.setColorAt(i, c);
      m.compose(p.set(x1, y1, zc), q, s.set(W, W, h));
      ends.setMatrixAt(i, m); ends.setColorAt(i, c);
    });
    this.group.add(bodies, ends);
    this.render();
  }
  setLayer(n) { this.maxLayer = n; if (this.segs) this.build(); }
  view(name, box) {
    if (box) this.box = box;
    const b = this.box; if (!b) return;
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], size = Math.max(sx, sy);
    const cam = this.camera;
    cam.up.set(0, 0, 1);
    if (name === 'top') {
      const d = size / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.75 / Math.min(1, cam.aspect * sy / sx || 1);
      cam.position.set(cx, cy - 0.01, d); cam.up.set(0, 1, 0); this.controls.target.set(cx, cy, 0);
    } else if (name === 'left' || name === 'right') {
      const tx = name === 'left' ? b.pushX : b.pullX, dir = name === 'left' ? 1 : -1;
      cam.position.set(tx - dir * 32, b.min[1] - 30, 34); this.controls.target.set(tx, cy - sy * 0.2, 0);
    } else {
      cam.position.set(cx, cy - size * 1.05, size * 0.95); this.controls.target.set(cx, cy, 0);
    }
    cam.lookAt(this.controls.target);
    this.controls.update();
    this.render();
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
