// Dependency-free force-directed graph. Supports 3D (orbit camera) and 2D (pan/zoom).
// Nodes: colored by category, size by degree, glow halo.
// Edges: thin low-alpha curves, brighter on hover. Keyword bridges dashed purple.
// Cluster anchors: year → category → theme → sub-theme.

class GraphView {
  constructor(canvas, onNodeClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.nodes = [];
    this.edges = [];
    this.colors = {};
    this.categories = [];
    this.years = [];
    this.activeId = null;

    // 3D camera
    this.yaw = 0.6;
    this.pitch = -0.35;
    this.zoom = 0.6;
    this.autoRotate = true;

    // 2D pan
    this.is2D = false;   // toggle per session
    this.panX = 0;
    this.panY = 0;

    this.dragging = false;
    this.downPos = null;
    this.lastMouse = { x: 0, y: 0 };
    this.hoverNode = null;

    this.running = false;
    this.alpha = 1;
    this._bind();
  }

  setData(nodes, edges, colors, categories) {
    const prev = new Map(this.nodes.map((n) => [n.id, n]));
    this.categories = categories || [...new Set(nodes.map((n) => n.category))];

    const SEP = '|';
    this.years = [...new Set(nodes.map((n) => n.year || 'undated'))].sort();
    const yc = {}, tt = {}, ss = {};
    for (const n of nodes) {
      const y = n.year || 'undated';
      (yc[y] = yc[y] || new Set()).add(n.category);
      if (n.theme) { const k = y + SEP + n.category; (tt[k] = tt[k] || new Set()).add(n.theme); }
      if (n.theme && n.subtheme) { const k = y + SEP + n.category + SEP + n.theme; (ss[k] = ss[k] || new Set()).add(n.subtheme); }
    }
    this.yearCats = {}; this.catThemes = {}; this.themeSubs = {};
    for (const y of Object.keys(yc)) this.yearCats[y] = [...yc[y]].sort();
    for (const k of Object.keys(tt)) this.catThemes[k] = [...tt[k]].sort();
    for (const k of Object.keys(ss)) this.themeSubs[k] = [...ss[k]].sort();
    this._SEP = SEP;

    this.nodes = nodes.map((n) => {
      const old = prev.get(n.id);
      return {
        ...n,
        x: old ? old.x : (Math.random() - 0.5) * 300,
        y: old ? old.y : (Math.random() - 0.5) * 300,
        z: old ? old.z : (Math.random() - 0.5) * 300,
        vx: 0, vy: 0, vz: 0, deg: 0,
      };
    });
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: byId.get(e.source), target: byId.get(e.target), type: e.type || 'link', shared: e.shared || [] }));
    for (const e of this.edges) { e.source.deg++; e.target.deg++; }
    this.colors = colors;
    this.alpha = 1;
  }

  setActive(id) { this.activeId = id; }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => { if (!this.running) return; this._tick(); this._draw(); requestAnimationFrame(loop); };
    loop();
  }
  stop() { this.running = false; }

  toggle2D(on) {
    this.is2D = on;
    if (on) { this.autoRotate = false; for (const n of this.nodes) { n.z = 0; n.vz = 0; } }
    else { this.autoRotate = true; }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- cluster anchors (shared between 2D and 3D) ----
  _yearCenter(year) {
    const i = this.years.indexOf(year), N = this.years.length;
    if (N <= 1 || i < 0) return { x: 0, y: 0, z: 0 };
    const R = 760, a = (i / N) * Math.PI * 2;
    return { x: R * Math.cos(a), y: 0, z: R * Math.sin(a) };
  }

  _layoutCenter(node) {
    const y = node.year || 'undated', c = this._yearCenter(y);
    let x = c.x, yy = c.y, z = c.z;
    const cats = this.yearCats[y] || [];
    if (cats.length > 1) { const i = cats.indexOf(node.category); if (i >= 0) { const a = (i / cats.length) * Math.PI * 2; x += 360 * Math.cos(a); z += 360 * Math.sin(a); } }
    const themes = this.catThemes[y + this._SEP + node.category] || [];
    if (node.theme && themes.length > 1) { const j = themes.indexOf(node.theme); if (j >= 0) { const a = (j / themes.length) * Math.PI * 2; x += 150 * Math.cos(a); yy += 150 * Math.sin(a); } }
    const subs = this.themeSubs[y + this._SEP + node.category + this._SEP + node.theme] || [];
    if (node.theme && node.subtheme && subs.length > 1) { const k = subs.indexOf(node.subtheme); if (k >= 0) { const a = (k / subs.length) * Math.PI * 2; x += 70 * Math.cos(a); z += 70 * Math.sin(a); } }
    return { x, y: yy, z };
  }

  // ---- physics ----
  _tick() {
    const nodes = this.nodes;
    if (!nodes.length) return;
    const k = 0.035, rest = 160, repulse = 18000, center = 0.004, clusterPull = 0.018;
    this.alpha = Math.max(0, this.alpha * 0.99);
    const energy = 0.3 + this.alpha;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = this.is2D ? 0 : (a.z - b.z);
        const d2 = dx*dx + dy*dy + dz*dz || 0.01, d = Math.sqrt(d2), f = repulse / d2;
        const fx = dx/d*f, fy = dy/d*f, fz = this.is2D ? 0 : dz/d*f;
        a.vx += fx; a.vy += fy; a.vz += fz;
        b.vx -= fx; b.vy -= fy; b.vz -= fz;
      }
    }
    for (const e of this.edges) {
      const a = e.source, b = e.target;
      const dx = b.x-a.x, dy = b.y-a.y, dz = this.is2D ? 0 : (b.z-a.z);
      const d = Math.sqrt(dx*dx+dy*dy+dz*dz) || 0.01;
      const isKeyword = e.type === 'keyword';
      const stiff = isKeyword ? k*0.08 : k, restLen = isKeyword ? rest*2.5 : rest;
      const f = (d - restLen) * stiff;
      const fx = dx/d*f, fy = dy/d*f, fz = this.is2D ? 0 : dz/d*f;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    }
    for (const n of nodes) {
      const c = this._layoutCenter(n);
      n.vx += (c.x - n.x) * clusterPull + (-n.x) * center;
      n.vy += (c.y - n.y) * clusterPull + (-n.y) * center;
      if (!this.is2D) n.vz += (c.z - n.z) * clusterPull + (-n.z) * center;
      n.vx *= 0.85; n.vy *= 0.85; n.vz *= 0.85;
      const s = 0.05 * Math.min(1, energy);
      n.x += n.vx * s; n.y += n.vy * s;
      if (this.is2D) { n.z = 0; n.vz = 0; } else n.z += n.vz * s;
    }
    if (!this.is2D && this.autoRotate && !this.dragging) this.yaw += 0.0016;
  }

  // ---- projection ----
  _project(p) {
    if (this.is2D) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      return { sx: w/2 + (p.x + this.panX) * this.zoom, sy: h/2 + (p.y + this.panY) * this.zoom, depth: 0, scale: this.zoom };
    }
    const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    const cosX = Math.cos(this.pitch), sinX = Math.sin(this.pitch);
    let x = p.x * cosY + p.z * sinY, z = -p.x * sinY + p.z * cosY, y = p.y;
    const y2 = y * cosX - z * sinX, z2 = y * sinX + z * cosX;
    const focal = 900, denom = focal - z2;
    const scale = (focal / Math.max(120, denom)) * this.zoom;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { sx: w/2 + x * scale, sy: h/2 - y2 * scale, depth: z2, scale };
  }

  _radius(n) { return 4 + Math.min(9, n.deg * 1.4); }

  // ---- draw helpers (Obsidian style) ----
  _drawNode(ctx, p, n, dim, active) {
    const r = Math.max(2, this._radius(n) * p.scale);
    const color = this.colors[n.category] || '#7aa2f7';
    const depthT = this.is2D ? 0.8 : Math.max(0, Math.min(1, (p.depth + 300) / 600));
    const baseAlpha = dim ? 0.12 : 0.7 + 0.3 * depthT;

    // glow halo
    const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 2.2);
    const hex = color.startsWith('#') ? color : color;
    glow.addColorStop(0, color + (dim ? '20' : 'cc'));
    glow.addColorStop(0.45, color + (dim ? '10' : '66'));
    glow.addColorStop(1, color + '00');
    ctx.globalAlpha = dim ? 0.15 : Math.min(1, baseAlpha);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // solid core
    ctx.globalAlpha = dim ? 0.15 : baseAlpha;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // active ring
    if (active) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawEdge(ctx, a, b, e, hot) {
    const isKw = e.type === 'keyword';
    const alpha = hot ? (isKw ? 0.85 : 0.7) : (isKw ? 0.25 : 0.18);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = hot ? 2 : 1;

    if (isKw) {
      ctx.strokeStyle = '#bb9af7';
      ctx.setLineDash([5, 5]);
    } else {
      ctx.strokeStyle = '#c0caf5';
      ctx.setLineDash([]);
    }

    // slight curve (Obsidian feel)
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    const dx = b.sx - a.sx, dy = b.sy - a.sy, len = Math.sqrt(dx*dx+dy*dy) || 1;
    const bend = Math.min(30, len * 0.08);
    const cpx = mx - (dy/len) * bend, cpy = my + (dx/len) * bend;
    ctx.quadraticCurveTo(cpx, cpy, b.sx, b.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (isKw && hot && e.shared.length) {
      ctx.fillStyle = '#bb9af7';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.9;
      ctx.fillText(e.shared.join(', '), mx, my - 4);
      ctx.globalAlpha = 1;
    }
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this.nodes.length) return;

    const proj = new Map();
    for (const n of this.nodes) proj.set(n, this._project(n));

    const neighbors = new Set();
    if (this.hoverNode) {
      neighbors.add(this.hoverNode.id);
      for (const e of this.edges) {
        if (e.source === this.hoverNode) neighbors.add(e.target.id);
        if (e.target === this.hoverNode) neighbors.add(e.source.id);
      }
    }

    // year labels
    const showYears = this.years.length > 1 || (this.years[0] && this.years[0] !== 'undated');
    if (showYears) {
      ctx.textAlign = 'center';
      for (const y of this.years) {
        const c = this._yearCenter(y);
        const p = this._project({ x: c.x, y: c.y + 230, z: c.z });
        ctx.font = `bold ${Math.max(13, 22 * (this.is2D ? this.zoom : p.scale))}px -apple-system, sans-serif`;
        ctx.fillStyle = 'rgba(122,162,247,0.7)';
        ctx.globalAlpha = 0.7;
        ctx.fillText('📅 ' + y, p.sx, p.sy);
        ctx.globalAlpha = 1;
      }
    }

    // edges
    for (const e of this.edges) {
      const a = proj.get(e.source), b = proj.get(e.target);
      const hot = !!this.hoverNode && (e.source === this.hoverNode || e.target === this.hoverNode);
      this._drawEdge(ctx, a, b, e, hot);
    }

    // nodes — painter's algorithm (far → near in 3D; insertion order in 2D)
    const order = this.is2D ? [...this.nodes] : [...this.nodes].sort((a, b) => proj.get(a).depth - proj.get(b).depth);
    for (const n of order) {
      const p = proj.get(n);
      const dim = !!(this.hoverNode && !neighbors.has(n.id));
      this._drawNode(ctx, p, n, dim, n.id === this.activeId);

      // label: show on hover or when zoomed in enough
      const showLabel = n === this.hoverNode || n.id === this.activeId || (!dim && p.scale > (this.is2D ? 0.8 : 0.55));
      if (showLabel) {
        const fadeAlpha = n === this.hoverNode ? 1 : Math.min(1, (p.scale - (this.is2D ? 0.6 : 0.4)) / 0.3);
        ctx.globalAlpha = Math.max(0, fadeAlpha) * (dim ? 0.2 : 1);
        ctx.fillStyle = '#c0caf5';
        ctx.font = `${Math.max(10, 11 * Math.min(1.4, p.scale))}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        const r = Math.max(2, this._radius(n) * p.scale);
        ctx.fillText(n.title, p.sx, p.sy + r + 12);
        ctx.globalAlpha = 1;
      }
    }

    // hint
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(122,130,168,1)';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    const hint = this.is2D
      ? 'drag to pan · scroll to zoom · click a node to open'
      : 'drag to rotate · scroll to zoom · click a node to open';
    ctx.fillText(hint, 14, h - 12);
    ctx.globalAlpha = 1;
  }

  // ---- interaction ----
  _nodeAt(sx, sy) {
    let best = null, bestDepth = -Infinity;
    for (const n of this.nodes) {
      const p = this._project(n);
      const r = Math.max(4, this._radius(n) * p.scale) + 4;
      if ((sx - p.sx) ** 2 + (sy - p.sy) ** 2 <= r * r && p.depth > bestDepth) {
        best = n; bestDepth = p.depth;
      }
    }
    return best;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      const r = c.getBoundingClientRect();
      this.downPos = { sx: e.clientX - r.left, sy: e.clientY - r.top };
      this.dragging = true;
      if (!this.is2D) this.autoRotate = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (this.dragging) {
        const dx = e.clientX - this.lastMouse.x, dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        if (this.is2D) {
          this.panX += dx / this.zoom;
          this.panY += dy / this.zoom;
        } else {
          this.yaw += dx * 0.01;
          this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.01));
        }
      } else {
        this.hoverNode = this._nodeAt(sx, sy);
        c.style.cursor = this.hoverNode ? 'pointer' : (this.is2D ? 'grab' : 'grab');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.downPos) {
        const r = c.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        if (Math.hypot(sx - this.downPos.sx, sy - this.downPos.sy) < 5) {
          const n = this._nodeAt(sx, sy);
          if (n && this.onNodeClick) this.onNodeClick(n.id);
        }
      }
      this.dragging = false;
      this.downPos = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.15, Math.min(5, this.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    }, { passive: false });
  }
}

window.GraphView = GraphView;
