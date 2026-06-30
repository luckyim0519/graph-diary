// A small mood-over-time chart on a canvas: one dot per diary entry
// (x = date, y = mood -5..+5), colored by category, connected chronologically.

class MoodChart {
  constructor(canvas, tooltip, onPointClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.onPointClick = onPointClick;
    this.points = [];     // {id,title,date,ts,mood,category,color,emotions}
    this.placed = [];     // screen coords, filled on draw
    this.pad = { l: 44, r: 20, t: 18, b: 30 };
    this._bind();
  }

  setData(points) {
    this.points = points
      .filter((p) => typeof p.mood === 'number' && !Number.isNaN(p.mood))
      .map((p) => ({ ...p, ts: new Date(p.date).getTime() }))
      .sort((a, b) => a.ts - b.ts);
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  _x(ts) {
    const { l, r } = this.pad;
    const w = this.canvas.clientWidth;
    if (this.tsMin === this.tsMax) return (l + w - r) / 2;
    return l + ((ts - this.tsMin) / (this.tsMax - this.tsMin)) * (w - l - r);
  }
  _y(mood) {
    const { t, b } = this.pad;
    const h = this.canvas.clientHeight;
    return t + ((5 - mood) / 10) * (h - t - b);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!this.points.length) {
      ctx.fillStyle = '#7a82a8';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No mood data yet — write some entries, then Re-analyze.', w / 2, h / 2);
      return;
    }
    this.tsMin = this.points[0].ts;
    this.tsMax = this.points[this.points.length - 1].ts;

    // gridlines + y labels at +5, 0, -5
    ctx.strokeStyle = 'rgba(122,130,168,0.18)';
    ctx.fillStyle = '#7a82a8';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (const [val, label] of [[5, '+5 great'], [0, '0'], [-5, '-5 low']]) {
      const y = this._y(val);
      ctx.beginPath();
      ctx.moveTo(this.pad.l, y);
      ctx.lineTo(w - this.pad.r, y);
      ctx.lineWidth = val === 0 ? 1.2 : 1;
      ctx.strokeStyle = val === 0 ? 'rgba(122,130,168,0.4)' : 'rgba(122,130,168,0.15)';
      ctx.stroke();
      ctx.fillText(label, this.pad.l - 6, y + 3);
    }

    // x labels (first / last date)
    ctx.textAlign = 'center';
    const fmt = (ts) => new Date(ts).toISOString().slice(0, 10);
    ctx.fillText(fmt(this.tsMin), this.pad.l + 18, h - 10);
    if (this.tsMax !== this.tsMin) ctx.fillText(fmt(this.tsMax), w - this.pad.r - 24, h - 10);

    // connecting line
    ctx.beginPath();
    this.points.forEach((p, i) => {
      const x = this._x(p.ts), y = this._y(p.mood);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = 'rgba(192,202,245,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // points
    this.placed = [];
    for (const p of this.points) {
      const x = this._x(p.ts), y = this._y(p.mood);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.color || '#7aa2f7';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(26,27,38,0.8)';
      ctx.stroke();
      this.placed.push({ ...p, sx: x, sy: y });
    }
  }

  _hit(mx, my) {
    let best = null, bestD = 14 * 14;
    for (const p of this.placed) {
      const d = (mx - p.sx) ** 2 + (my - p.sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = this._hit(mx, my);
      if (hit) {
        c.style.cursor = 'pointer';
        const emo = hit.emotions && hit.emotions.length ? ' · ' + hit.emotions.join(', ') : '';
        this.tooltip.innerHTML =
          `<div class="mt-title">${hit.title}</div>` +
          `<div class="mt-meta">${hit.date} · mood ${hit.mood > 0 ? '+' : ''}${hit.mood}${emo}</div>`;
        this.tooltip.style.left = Math.min(mx + 12, c.clientWidth - 200) + 'px';
        this.tooltip.style.top = (my + 12) + 'px';
        this.tooltip.classList.remove('hidden');
      } else {
        c.style.cursor = 'default';
        this.tooltip.classList.add('hidden');
      }
    });
    c.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const hit = this._hit(e.clientX - r.left, e.clientY - r.top);
      if (hit && this.onPointClick) this.onPointClick(hit.id);
    });
  }
}

window.MoodChart = MoodChart;
