// Fills placeholders in start / end G-code the way Orca does:
//   {expression}  {if ...}...{elsif ...}...{else}...{endif}  [name]  [name_0]
// Anything it can't work out is left as it is and reported.

class Unknown extends Error {
  constructor(name) { super('unknown ' + name); this.name_ = name; }
}

export function fill(template, vars) {
  const unknown = new Set(), errors = [];
  const nodes = build(scan(template));
  const out = run(nodes, vars, unknown, errors);
  return { text: out, unknown: [...unknown], errors };
}

// ---- split the template into text and {...} / [...] parts
function scan(s) {
  const parts = [];
  let i = 0, text = '';
  const flush = () => { if (text) parts.push({ t: 'text', s: text }); text = ''; };
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      let j = i + 1, depth = 1, q = null;
      for (; j < s.length && depth; j++) {
        const d = s[j];
        if (q) { if (d === '\\') j++; else if (d === q) q = null; continue; }
        if (d === '"' || d === "'") q = d;
        else if (d === '{') depth++;
        else if (d === '}') depth--;
      }
      if (depth) { text += s.slice(i); break; }
      const raw = s.slice(i, j), body = raw.slice(1, -1).trim();
      flush();
      let m;
      if ((m = /^if\b([\s\S]*)$/.exec(body))) parts.push({ t: 'if', e: m[1], raw });
      else if ((m = /^elsif\b([\s\S]*)$/.exec(body))) parts.push({ t: 'elsif', e: m[1], raw });
      else if (body === 'else') parts.push({ t: 'else', raw });
      else if (body === 'endif') parts.push({ t: 'endif', raw });
      else parts.push({ t: 'expr', e: body, raw });
      i = j;
    } else if (c === '[') {
      const m = /^\[([a-zA-Z_][a-zA-Z0-9_]*)\]/.exec(s.slice(i));
      if (m) { flush(); parts.push({ t: 'legacy', name: m[1], raw: m[0] }); i += m[0].length; }
      else { text += c; i++; }
    } else { text += c; i++; }
  }
  flush();
  return parts;
}

// ---- if / elsif / else / endif into a tree
function build(parts) {
  let pos = 0;
  function block(stop) {
    const out = [];
    while (pos < parts.length) {
      const p = parts[pos];
      if (stop.includes(p.t)) return out;
      pos++;
      if (p.t === 'if') {
        const node = { t: 'ifchain', branches: [], raw: p.raw };
        let cond = p.e;
        for (;;) {
          const body = block(['elsif', 'else', 'endif']);
          node.branches.push({ cond, body });
          const q = parts[pos];
          if (!q) { node.broken = true; break; }
          pos++;
          node.raw += '';
          if (q.t === 'endif') break;
          if (q.t === 'else') { cond = null; continue; }
          cond = q.e;
        }
        out.push(node);
      } else if (p.t === 'elsif' || p.t === 'else' || p.t === 'endif') {
        out.push({ t: 'text', s: p.raw });      // stray, keep it
      } else out.push(p);
    }
    return out;
  }
  return block([]);
}

function raw(node) {
  if (node.t === 'text') return node.s;
  if (node.t !== 'ifchain') return node.raw;
  let s = '';
  node.branches.forEach((b, i) => {
    s += b.cond === null ? '{else}' : (i ? '{elsif' : '{if') + b.cond + '}';
    s += b.body.map(raw).join('');
  });
  return s + (node.broken ? '' : '{endif}');
}

function run(nodes, vars, unknown, errors) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') { out += n.s; continue; }
    try {
      if (n.t === 'expr') out += format(evaluate(n.e, vars));
      else if (n.t === 'legacy') out += format(legacy(n.name, vars));
      else if (n.t === 'ifchain') {
        if (n.broken) throw new Error('missing {endif}');
        for (const b of n.branches) {
          if (b.cond === null || truthy(evaluate(b.cond, vars))) { out += run(b.body, vars, unknown, errors); break; }
        }
      }
    } catch (e) {
      if (e instanceof Unknown) unknown.add(e.name_);
      else errors.push(e.message + ' in ' + raw(n).slice(0, 60));
      out += raw(n);
    }
  }
  return out;
}

// [temperature] or [temperature_1]
function legacy(name, vars) {
  if (name in vars) return vars[name];
  const m = /^(.*)_(\d+)$/.exec(name);
  if (m && m[1] in vars) {
    const v = vars[m[1]];
    return Array.isArray(v) ? at(v, +m[2], m[1]) : v;
  }
  throw new Unknown(name);
}

function at(arr, i, name) {
  if (i < 0 || i >= arr.length) {
    if (arr.length) return arr[arr.length - 1];     // one extruder: use the last value
    throw new Error('empty list ' + name);
  }
  return arr[i];
}

export function format(v) {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(+v.toFixed(6));
  }
  return v === undefined || v === null ? '' : String(v);
}

function truthy(v) {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'string') return v !== '' && v !== '0' && v !== 'false';
  return !!v;
}
function scalar(v) { return Array.isArray(v) ? v[0] : v; }

// ---- expressions
const OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '=~', '<', '>', '+', '-', '*', '/', '%', '!', '(', ')', '[', ']', ',', '?', ':'];

function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    if ((m = /^\d+(\.\d*)?([eE][-+]?\d+)?|^\.\d+/.exec(src.slice(i)))) { out.push({ k: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; s += src[j++]; }
      out.push({ k: 's', v: s }); i = j + 1; continue;
    }
    if ((m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i)))) { out.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error('invalid character at "' + src.slice(i, i + 10) + '"');
    out.push({ k: 'op', v: op }); i += op.length;
  }
  return out;
}

const FUNCS = {
  min: (a, b) => Math.min(num(a), num(b)),
  max: (a, b) => Math.max(num(a), num(b)),
  int: (a) => Math.trunc(num(a)),
  round: (a) => Math.round(num(a)),
  abs: (a) => Math.abs(num(a)),
  ceil: (a) => Math.ceil(num(a)),
  floor: (a) => Math.floor(num(a)),
  is_nil: (a) => a === undefined || a === null,
};
function num(v) {
  v = scalar(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) throw new Error('not a number: ' + v);
  return n;
}

export function evaluate(src, vars) {
  const t = tokens(src);
  let p = 0;
  const peek = (v) => t[p] && (t[p].v === v) && (t[p].k === 'op' || t[p].k === 'id');
  const take = (v) => { if (peek(v)) { p++; return true; } return false; };
  const need = (v) => { if (!take(v)) throw new Error('expected "' + v + '"'); };

  function ternary() {
    const c = or();
    if (take('?')) { const a = ternary(); need(':'); const b = ternary(); return truthy(c) ? a : b; }
    return c;
  }
  function or() { let a = and(); while (take('or') || take('||')) { const b = and(); a = truthy(a) || truthy(b); } return a; }
  function and() { let a = not(); while (take('and') || take('&&')) { const b = not(); a = truthy(a) && truthy(b); } return a; }
  function not() { if (take('not') || take('!')) return !truthy(not()); return cmp(); }
  function cmp() {
    let a = add();
    for (;;) {
      const op = ['==', '!=', '<>', '<=', '>=', '<', '>', '=~'].find((o) => peek(o));
      if (!op) return a;
      p++;
      const b = add(), x = scalar(a), y = scalar(b);
      const both = typeof x === 'number' || typeof y === 'number';
      if (op === '==') a = both ? num(x) === num(y) : String(x) === String(y);
      else if (op === '!=' || op === '<>') a = both ? num(x) !== num(y) : String(x) !== String(y);
      else if (op === '=~') a = new RegExp(String(y).replace(/^\/|\/$/g, '')).test(String(x));
      else { const u = num(x), v = num(y); a = op === '<' ? u < v : op === '>' ? u > v : op === '<=' ? u <= v : u >= v; }
    }
  }
  function add() {
    let a = mul();
    for (;;) {
      if (take('+')) {
        const b = mul(), x = scalar(a), y = scalar(b);
        a = typeof x === 'string' || typeof y === 'string' ? format(x) + format(y) : num(x) + num(y);
      } else if (take('-')) a = num(a) - num(mul());
      else return a;
    }
  }
  function mul() {
    let a = unary();
    for (;;) {
      if (take('*')) a = num(a) * num(unary());
      else if (take('/')) a = num(a) / num(unary());
      else if (take('%')) a = num(a) % num(unary());
      else return a;
    }
  }
  function unary() { if (take('-')) return -num(unary()); if (take('+')) return num(unary()); return postfix(); }
  function postfix() {
    let v = primary();
    while (take('[')) {
      const i = num(ternary()); need(']');
      v = Array.isArray(v) ? at(v, Math.trunc(i), '') : v;
    }
    return v;
  }
  function primary() {
    const k = t[p];
    if (!k) throw new Error('unexpected end of expression');
    p++;
    if (k.k === 'n' || k.k === 's') return k.v;
    if (k.k === 'op' && k.v === '(') { const v = ternary(); need(')'); return v; }
    if (k.k === 'id') {
      if (k.v === 'true') return true;
      if (k.v === 'false') return false;
      if (k.v in FUNCS && peek('(')) {
        p++;
        const args = [];
        if (!take(')')) { do args.push(ternary()); while (take(',')); need(')'); }
        return FUNCS[k.v](...args);
      }
      if (k.v in vars) return vars[k.v];
      throw new Unknown(k.v);
    }
    throw new Error('unexpected "' + k.v + '"');
  }
  const v = ternary();
  if (p < t.length) throw new Error('unexpected "' + t[p].v + '"');
  return v;
}
