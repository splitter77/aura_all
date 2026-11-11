(() => {
  'use strict';

  // ---------- État ----------
  const STORAGE_KEY = 'aura-all-notes:v1';
  const TOOL_DEFS = {
    pen:       { widths: [1.5, 2.5, 4, 6.5, 10],  width: 2.5, color: '#FFFFFF', opacity: 1 },
    fineliner: { widths: [1, 1.5, 2.2, 3.2, 4.5], width: 1.5, color: '#FFFFFF', opacity: 1 },
    marker:    { widths: [8, 12, 17, 24, 32],     width: 17,  color: '#D6A71B', opacity: 0.8 },
    eraser:    { widths: [8, 14, 22, 34, 50],     width: 22,  mode: 'pixel' },
    lasso:     {},
  };
  const tools = JSON.parse(JSON.stringify(TOOL_DEFS));
  let current = 'pen';
  let lastInkTool = 'pen';
  let strokes = [];          // éléments immuables : { kind:'stroke'|'text'|'image', ... }
  let undoStack = [];
  let redoStack = [];
  let viewMode = false;
  let morph = null;          // transformation en cours (cœur / smiley / logo)

  // ---------- Canvas ----------
  const base = document.getElementById('base');
  const live = document.getElementById('live');
  const bctx = base.getContext('2d');
  const lctx = live.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    if (typeof cancelMorph === 'function') cancelMorph();
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [base, live]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    }
    renderAll();
    renderLive();
  }

  // ---------- Rendu ----------
  const imgCache = new Map();
  function getImage(src) {
    let img = imgCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => renderAll();
      img.src = src;
      imgCache.set(src, img);
    }
    return img;
  }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function tracePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length < 3) {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l.x, l.y);
  }

  function drawItem(ctx, s) {
    ctx.save();
    if (s.kind === 'text') {
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.fillStyle = s.color;
      ctx.font = `600 ${s.size}px -apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      s.text.split('\n').forEach((line, i) => ctx.fillText(line, s.x, s.y + i * s.size * 1.2));
    } else if (s.kind === 'image') {
      const img = getImage(s.src);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, s.x, s.y, s.w, s.h);
    } else {
      const pts = s.points;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = s.width;
        tracePath(ctx, pts);
        ctx.stroke();
      } else if (s.tool === 'pen' && pts.length > 2) {
        // Stylo : épaisseur variable segment par segment.
        // Rendu hors-écran si opacité < 1 pour éviter les chevauchements plus foncés.
        const target = s.opacity < 1 ? offscreen(ctx) : ctx;
        target.strokeStyle = s.color;
        target.lineCap = 'round';
        target.lineJoin = 'round';
        let prev = pts[0];
        for (let i = 1; i < pts.length - 1; i++) {
          const m = mid(pts[i], pts[i + 1]);
          target.beginPath();
          target.moveTo(prev.x, prev.y);
          target.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
          target.lineWidth = pts[i].w;
          target.stroke();
          prev = m;
        }
        const l = pts[pts.length - 1];
        target.beginPath(); target.moveTo(prev.x, prev.y); target.lineTo(l.x, l.y);
        target.lineWidth = l.w; target.stroke();
        if (target !== ctx) flushOffscreen(ctx, s.opacity);
      } else {
        ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.tool === 'pen' ? (pts[0].w || s.width) : s.width;
        if (s.tool === 'marker') ctx.lineCap = 'butt', ctx.lineJoin = 'round';
        if (s.tool === 'marker' && pts.length === 1) ctx.lineCap = 'square';
        tracePath(ctx, pts);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  let off = null, offctx = null;
  function offscreen(ctx) {
    const c = ctx.canvas;
    if (!off) { off = document.createElement('canvas'); offctx = off.getContext('2d'); }
    if (off.width !== c.width || off.height !== c.height) { off.width = c.width; off.height = c.height; }
    offctx.setTransform(1, 0, 0, 1, 0, 0);
    offctx.clearRect(0, 0, off.width, off.height);
    offctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return offctx;
  }
  function flushOffscreen(ctx, alpha) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  function renderAll() {
    syncOut();   // aura_all : envoie à l'autre iPhone ce qui a changé depuis le dernier rendu
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, base.width, base.height);
    bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (morph) return; // la transformation occupe l'écran
    for (const s of strokes) drawItem(bctx, s);
  }

  // ---------- Historique ----------
  function commit(next) {
    cancelMorph();
    undoStack.push(strokes);
    if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    strokes = next;
    renderAll();
    save();
  }
  function undo() {
    if (morph) { cancelMorph(); return; }
    if (!undoStack.length) return;
    redoStack.push(strokes);
    strokes = undoStack.pop();
    clearSelection();
    renderAll(); save();
  }
  function redo() {
    if (morph) { cancelMorph(); return; }
    if (!redoStack.length) return;
    undoStack.push(strokes);
    strokes = redoStack.pop();
    clearSelection();
    renderAll(); save();
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ strokes, tools, current }));
      } catch (e) { /* quota dépassé (images) : on ignore */ }
    }, 250);
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!d) return;
      if (Array.isArray(d.strokes)) strokes = d.strokes;
      if (d.tools) for (const k in tools) Object.assign(tools[k], d.tools[k] || {}, { widths: TOOL_DEFS[k].widths });
      if (d.current && tools[d.current]) current = d.current;
    } catch (e) { /* données corrompues */ }
  }

  // ---------- Saisie ----------
  let active = null; // { id, type, ... }

  function pointFromEvent(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function penWidth(e, p, prev, baseW) {
    if (e.pointerType === 'pen' && e.pressure > 0) {
      return baseW * (0.35 + e.pressure * 1.3);
    }
    if (!prev) return baseW;
    const dt = Math.max(1, e.timeStamp - prev.t);
    const v = Math.hypot(p.x - prev.x, p.y - prev.y) / dt; // px/ms
    const target = baseW * Math.max(0.55, Math.min(1.25, 1.25 - v * 0.28));
    return prev.w + (target - prev.w) * 0.35;
  }

  base.addEventListener('pointerdown', (e) => {
    closePopovers();
    if (morph) { morphTapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }; return; }
    if (!active) {
      tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp,
        strokesBefore: strokes, undoLen: undoStack.length, redoBefore: redoStack };
    }
    if (viewMode || active) return;
    if (e.button !== undefined && e.button > 0) return;
    try { base.setPointerCapture(e.pointerId); } catch (_) {}
    const p = pointFromEvent(e);
    const t = tools[current];

    if (current === 'lasso') {
      if (selection && pointInPolygon(p, selection.poly)) {
        active = { id: e.pointerId, type: 'move', start: p, dx: 0, dy: 0 };
      } else {
        clearSelection();
        active = { id: e.pointerId, type: 'lasso', poly: [p] };
      }
      renderLive();
      return;
    }

    if (current === 'eraser' && t.mode === 'object') {
      active = { id: e.pointerId, type: 'objerase', removed: new Set(), last: p };
      objectErase(p, p);
      return;
    }

    const stroke = {
      kind: 'stroke',
      tool: current,
      color: t.color || '#000',
      opacity: t.opacity ?? 1,
      width: t.width,
      points: [{ x: p.x, y: p.y, w: current === 'pen' ? t.width : undefined, t: e.timeStamp }],
    };
    active = { id: e.pointerId, type: 'draw', stroke };
    setId(stroke, newId());
    if (current !== 'eraser') liveStart(stroke);
    if (current === 'eraser') eraseSegment(p, p, t.width);
    scheduleLive();
  });

  base.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) handleMove(ev);
  });

  function handleMove(e) {
    const p = pointFromEvent(e);
    if (active.type === 'draw') {
      const s = active.stroke;
      const pts = s.points;
      const prev = pts[pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.8) return;
      const pt = { x: p.x, y: p.y, t: e.timeStamp };
      if (s.tool === 'pen') pt.w = penWidth(e, p, prev, s.width);
      pts.push(pt);
      liveAdd(s, pt);
      if (s.tool === 'eraser') eraseSegment(prev, p, s.width);
      else scheduleLive();
    } else if (active.type === 'lasso') {
      active.poly.push(p);
      scheduleLive();
    } else if (active.type === 'move') {
      active.dx = p.x - active.start.x;
      active.dy = p.y - active.start.y;
      scheduleLive();
    } else if (active.type === 'objerase') {
      objectErase(active.last, p);
      active.last = p;
    }
  }

  function endPointer(e) {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    active = null;
    if (a.type === 'draw') {
      liveFlush();
      const s = a.stroke;
      s.points = s.points.map(({ x, y, w }) => (w !== undefined ? { x: r1(x), y: r1(y), w: r1(w) } : { x: r1(x), y: r1(y) }));
      commit([...strokes, s]);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, live.width, live.height);
    } else if (a.type === 'lasso') {
      finishLasso(a.poly);
    } else if (a.type === 'move') {
      applyMove(a.dx, a.dy);
    } else if (a.type === 'objerase') {
      if (a.removed.size) {
        undoStack.push(a.before);
        redoStack = [];
        save();
      }
    }
    renderLive();
  }
  base.addEventListener('pointerup', endPointer);
  base.addEventListener('pointercancel', endPointer);
  base.addEventListener('pointerup', handleTapUp);
  base.addEventListener('pointercancel', () => { tapStart = null; morphTapStart = null; });

  // ---------- Double tap ----------
  let tapStart = null, lastTap = null, morphTapStart = null;
  const isTap = (s, e) => s && s.id === e.pointerId && e.timeStamp - s.t < 300 &&
    Math.hypot(e.clientX - s.x, e.clientY - s.y) < 12;

  function handleTapUp(e) {
    if (morph) {
      if (isTap(morphTapStart, e)) advanceMorph();
      morphTapStart = null;
      return;
    }
    const s = tapStart;
    tapStart = null;
    if (!isTap(s, e)) { lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      // Annule les deux points laissés par les taps, puis lance la transformation.
      strokes = lastTap.strokesBefore;
      undoStack.length = Math.min(undoStack.length, lastTap.undoLen);
      redoStack = lastTap.redoBefore;
      lastTap = null;
      clearSelection();
      renderAll(); save();
      startMorph();
    } else {
      lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY,
        strokesBefore: s.strokesBefore, undoLen: s.undoLen, redoBefore: s.redoBefore };
    }
  }

  const r1 = (n) => Math.round(n * 10) / 10;

  // Gomme pixel : on efface directement sur la couche de base pendant le tracé.
  function eraseSegment(a, b, w) {
    bctx.save();
    bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bctx.globalCompositeOperation = 'destination-out';
    bctx.lineCap = 'round';
    bctx.lineWidth = w;
    bctx.beginPath();
    bctx.moveTo(a.x, a.y);
    bctx.lineTo(b.x + (a === b ? 0.01 : 0), b.y);
    bctx.stroke();
    bctx.restore();
  }

  // Gomme objet : supprime les éléments touchés.
  function objectErase(a, b) {
    const r = tools.eraser.width / 2;
    const hit = (s) => {
      if (s.kind !== 'stroke') return segRectHit(a, b, itemBounds(s), r);
      if (s.tool === 'eraser') return false;
      const pts = s.points;
      const rr = r + (s.width || 2) / 2;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (distToSeg(q, a, b) <= rr) return true;
        if (i > 0 && segSegDist(pts[i - 1], q, a, b) <= rr) return true;
      }
      return false;
    };
    const keep = strokes.filter((s) => !hit(s));
    if (keep.length !== strokes.length) {
      if (!active.before) active.before = strokes;
      strokes.filter((s) => !keep.includes(s)).forEach((s) => active.removed.add(s));
      strokes = keep;
      renderAll();
    }
  }

  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function segSegDist(p1, p2, q1, q2) {
    return Math.min(distToSeg(p1, q1, q2), distToSeg(p2, q1, q2), distToSeg(q1, p1, p2), distToSeg(q2, p1, p2));
  }
  function segRectHit(a, b, bb, r) {
    const inside = (p) => p.x >= bb.x - r && p.x <= bb.x + bb.w + r && p.y >= bb.y - r && p.y <= bb.y + bb.h + r;
    return inside(a) || inside(b);
  }

  // ---------- Lasso ----------
  let selection = null; // { items:Set, poly }

  function itemBounds(s) {
    if (s.kind === 'image') return { x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.kind === 'text') {
      lctx.save();
      lctx.font = `600 ${s.size}px -apple-system, Helvetica, Arial, sans-serif`;
      const lines = s.text.split('\n');
      const w = Math.max(...lines.map((l) => lctx.measureText(l).width));
      lctx.restore();
      return { x: s.x, y: s.y, w, h: lines.length * s.size * 1.2 };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function finishLasso(poly) {
    if (poly.length < 3) return;
    const items = new Set();
    for (const s of strokes) {
      if (s.kind === 'stroke') {
        if (s.tool === 'eraser') continue;
        const n = s.points.length;
        let c = 0;
        for (const p of s.points) if (pointInPolygon(p, poly)) c++;
        if (c / n >= 0.5) items.add(s);
      } else {
        const b = itemBounds(s);
        if (pointInPolygon({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly)) items.add(s);
      }
    }
    if (items.size) selection = { items, poly };
  }

  function clearSelection() { selection = null; }

  function translateItem(s, dx, dy) {
    if (s.kind === 'stroke') return { ...s, points: s.points.map((p) => ({ ...p, x: r1(p.x + dx), y: r1(p.y + dy) })) };
    return { ...s, x: s.x + dx, y: s.y + dy };
  }

  function applyMove(dx, dy) {
    if (!selection || (!dx && !dy)) return;
    const moved = new Set();
    const next = strokes.map((s) => {
      if (!selection.items.has(s)) return s;
      const t = translateItem(s, dx, dy);
      moved.add(t);
      return t;
    });
    selection = { items: moved, poly: selection.poly.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    commit(next);
  }

  // ---------- Couche « live » ----------
  let liveQueued = false;
  function scheduleLive() {
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => { liveQueued = false; renderLive(); });
  }

  let dashOffset = 0;
  function renderLive() {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (active && active.type === 'draw' && active.stroke.tool !== 'eraser') {
      drawItem(lctx, active.stroke);
    }
    // aura_all : traits en cours sur l'autre iPhone
    for (const rs of remoteLive.values()) drawItem(lctx, rs);

    const drawPoly = (poly, closed) => {
      lctx.save();
      lctx.beginPath();
      poly.forEach((p, i) => (i ? lctx.lineTo(p.x, p.y) : lctx.moveTo(p.x, p.y)));
      if (closed) lctx.closePath();
      lctx.lineWidth = 1.6;
      lctx.setLineDash([6, 5]);
      lctx.lineDashOffset = dashOffset;
      lctx.strokeStyle = 'rgba(0,0,0,.6)';
      lctx.lineWidth = 3; lctx.stroke();
      lctx.strokeStyle = '#fff';
      lctx.lineWidth = 1.5; lctx.stroke();
      lctx.restore();
    };

    if (morph) { drawMorph(lctx); return; }

    if (active && active.type === 'lasso') drawPoly(active.poly, false);

    if (selection) {
      const dx = active && active.type === 'move' ? active.dx : 0;
      const dy = active && active.type === 'move' ? active.dy : 0;
      if (dx || dy) {
        // aperçu du déplacement : on masque les originaux en re-rendant la base sans eux
        if (!active.hidden) {
          active.hidden = true;
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.clearRect(0, 0, base.width, base.height);
          bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          for (const s of strokes) if (!selection.items.has(s)) drawItem(bctx, s);
        }
        lctx.save();
        lctx.translate(dx, dy);
        for (const s of strokes) if (selection.items.has(s)) drawItem(lctx, s);
        lctx.restore();
      }
      drawPoly(selection.poly.map((p) => ({ x: p.x + dx, y: p.y + dy })), true);
    }
  }

  // ---------- Palette ----------
  const toolEls = [...document.querySelectorAll('.tool')];
  const swatch = document.querySelector('#btn-color .swatch');

  function updateToolbar() {
    toolEls.forEach((g) => {
      const name = g.dataset.tool;
      g.classList.toggle('selected', name === current);
      const t = tools[name];
      if (t.color) g.querySelectorAll('.tint').forEach((el) => el.setAttribute('fill', t.color));
      const lbl = g.querySelector('.op-label');
      if (lbl) lbl.textContent = Math.round((t.opacity ?? 1) * 100);
    });
    swatch.style.background = tools[lastInkTool].color;
  }

  function selectTool(name) {
    if (name === current) {
      if (name === 'lasso') return;
      togglePopover(popTool, openToolPopover);
      return;
    }
    closePopovers();
    if (current === 'lasso') { clearSelection(); renderLive(); }
    current = name;
    if (tools[name].color) lastInkTool = name;
    updateToolbar();
    save();
  }

  toolEls.forEach((g) => g.addEventListener('click', (e) => { e.stopPropagation(); selectTool(g.dataset.tool); }));

  // Popover réglages
  const popTool = document.getElementById('pop-tool');
  const widthsEl = popTool.querySelector('.widths');
  const opacityEl = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacity-val');

  function openToolPopover() {
    const t = tools[current];
    popTool.classList.toggle('is-eraser', current === 'eraser');
    widthsEl.innerHTML = '';
    const max = Math.max(...t.widths);
    t.widths.forEach((w) => {
      const b = document.createElement('button');
      const d = 5 + (w / max) * 21;
      b.innerHTML = `<i style="width:${d}px;height:${d}px;background:${current === 'eraser' ? '#fff' : t.color}"></i>`;
      b.classList.toggle('on', w === t.width);
      b.addEventListener('click', () => { t.width = w; openToolPopover(); save(); });
      widthsEl.appendChild(b);
    });
    if (current !== 'eraser') {
      opacityEl.value = Math.round(t.opacity * 100);
      opacityEl.style.setProperty('--c', t.color);
      opacityVal.textContent = `${opacityEl.value} %`;
    } else {
      popTool.querySelectorAll('.eraser-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === t.mode));
    }
  }
  opacityEl.addEventListener('input', () => {
    tools[current].opacity = opacityEl.value / 100;
    opacityVal.textContent = `${opacityEl.value} %`;
    updateToolbar(); save();
  });
  popTool.querySelectorAll('.eraser-mode button').forEach((b) =>
    b.addEventListener('click', () => { tools.eraser.mode = b.dataset.mode; openToolPopover(); save(); })
  );

  // Popover couleurs (grille façon iOS)
  const popColor = document.getElementById('pop-color');
  const grid = popColor.querySelector('.grid');
  const swatchesEl = popColor.querySelector('.swatches');
  const QUICK = ['#FFFFFF', '#000000', '#0A84FF', '#30D158', '#FFD60A', '#FF453A', '#BF5AF2'];

  function hsl(h, s, l) { return `hsl(${h} ${s}% ${l}%)`; }
  function toHex(css) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = css; return c.fillStyle.toUpperCase();
  }
  const GRID_COLORS = (() => {
    const out = [];
    for (let i = 0; i < 12; i++) out.push(toHex(hsl(0, 0, 100 - (i / 11) * 100)));
    const hues = [200, 215, 250, 275, 320, 350, 8, 25, 40, 52, 62, 90];
    const rows = [[95, 20], [90, 30], [85, 40], [85, 50], [90, 58], [95, 68], [90, 78], [80, 86], [70, 92]];
    for (const [s, l] of rows.reverse()) for (const h of hues) out.push(toHex(hsl(h, s, 100 - l)));
    return out;
  })();

  function openColorPopover() {
    const t = tools[lastInkTool];
    const cur = t.color.toUpperCase();
    grid.innerHTML = '';
    GRID_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.style.background = c;
      b.classList.toggle('on', c === cur);
      b.addEventListener('click', () => setColor(c));
      grid.appendChild(b);
    });
    swatchesEl.innerHTML = '';
    QUICK.forEach((c) => {
      const b = document.createElement('button');
      b.style.background = c;
      if (c === '#000000') b.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,.25)';
      b.classList.toggle('on', c === cur);
      b.addEventListener('click', () => setColor(c));
      swatchesEl.appendChild(b);
    });
  }
  function setColor(c) {
    const target = tools[current].color ? current : lastInkTool;
    tools[target].color = c;
    updateToolbar(); openColorPopover(); save();
  }
  popColor.querySelector('.close').addEventListener('click', closePopovers);
  document.getElementById('btn-color').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!tools[current].color) { /* gomme/lasso : on agit sur le dernier outil d'encre */ }
    togglePopover(popColor, openColorPopover);
  });

  // Menus
  const menuMore = document.getElementById('menu-more');
  const menuPlus = document.getElementById('menu-plus');
  document.getElementById('btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopover(menuMore, () => {
      menuMore.querySelector('[data-act=undo]').disabled = !undoStack.length;
      menuMore.querySelector('[data-act=redo]').disabled = !redoStack.length;
    });
  });
  document.getElementById('btn-plus').addEventListener('click', (e) => { e.stopPropagation(); togglePopover(menuPlus); });

  function togglePopover(el, onOpen) {
    const wasOpen = !el.classList.contains('hidden');
    closePopovers();
    if (!wasOpen) { onOpen && onOpen(); el.classList.remove('hidden'); }
  }
  function closePopovers() {
    [popTool, popColor, menuMore, menuPlus].forEach((el) => el.classList.add('hidden'));
  }
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.popover, .menu, #toolbar, .round-btn') && e.target !== base) closePopovers();
  });

  const fileInput = document.getElementById('file');
  document.querySelectorAll('.menu button').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    closePopovers();
    if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'clear') { if (strokes.length && confirm(window.tr ? window.tr('Effacer tout le dessin ?', 'Clear the whole drawing?') : 'Effacer tout le dessin ?')) { clearSelection(); commit([]); renderLive(); } }
    else if (act === 'export') exportPNG();
    else if (act === 'text') addText();
    else if (act === 'image') fileInput.click();
  }));

  function addText() {
    const text = prompt(window.tr ? window.tr('Texte', 'Text') : 'Texte');
    if (!text) return;
    const t = tools[lastInkTool];
    const size = 28;
    commit([...strokes, { kind: 'text', text, color: t.color, opacity: 1, size, x: W / 2 - 80, y: H / 2 - size }]);
    selectTool('lasso');
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      // réduit l'image pour l'enregistrement local
      const max = 1200;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const src = c.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      const w = Math.min(W * 0.7, c.width), h = (w * c.height) / c.width;
      commit([...strokes, { kind: 'image', src, x: (W - w) / 2, y: (H - h) / 2, w, h }]);
      selectTool('lasso');
    };
    img.src = url;
  });

  function exportPNG() {
    const c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(base, 0, 0);
    c.toBlob(async (blob) => {
      const file = new File([blob], 'note.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'note.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  // Boutons du haut
  document.getElementById('btn-back').addEventListener('click', () => {
    if (hub) hub.back();                 // aura_all : retour à l'accueil des démos
    else if (history.length > 1) history.back();
  });
  document.getElementById('btn-done').addEventListener('click', () => {
    viewMode = !viewMode;
    document.body.classList.toggle('view-mode', viewMode);
    closePopovers();
    clearSelection(); renderLive();
  });

  // Raccourcis clavier
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && selection) {
      const sel = selection.items; clearSelection(); commit(strokes.filter((s) => !sel.has(s))); renderLive();
    } else if (e.key === 'Escape') { closePopovers(); clearSelection(); renderLive(); }
  });

  // Empêche le zoom/défilement iOS
  ['gesturestart', 'gesturechange', 'dblclick'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.popover input')) e.preventDefault(); }, { passive: false });

  // Animation des pointillés du lasso
  setInterval(() => { if (selection && !active) { dashOffset = (dashOffset - 1) % 11; renderLive(); } }, 60);

  // ---------- Transformation : dessin → cœur → smiley → logo → dessin ----------
  // Chaque forme est ré-échantillonnée en N points ; on interpole point à point.
  const MORPH_MS = 950;
  const SIGNATURE_SPACE = 44;
  const LOGO_STOPS = [[0, [62, 230, 168]], [0.5, [76, 195, 240]], [1, [163, 92, 255]]];

  // Logo en mode trait, dessiné dans une boîte de 256 × 256.
  const LOGO_PATHS = [
    // cadre de l'icône
    'M56 10 H200 Q246 10 246 56 V200 Q246 246 200 246 H56 Q10 246 10 200 V56 Q10 10 56 10 Z',
    // le « A »
    'M62 206 C82 150 101 92 117 60 Q128 40 141 58 C157 92 178 150 196 206 L170 206 C156 166 143 128 130 98 C117 128 104 166 92 206 Z',
    'M117 60 C122 72 126 85 130 98',
    // la vague qui traverse le A
    'M64 168 C100 142 140 122 176 113 C198 108 214 99 230 86 C218 108 197 123 173 131 C140 141 106 160 80 180 Z',
  ];
  // aurores boréales : traits plus fins et plus discrets, sur les côtés
  const LOGO_AURORA = [
    'M34 140 C42 112 30 84 40 52',
    'M54 120 C60 96 50 74 60 44',
    'M200 84 C196 66 206 52 200 32',
    'M220 92 C214 72 226 56 218 36',
  ];
  const LOGO_STARS = [[84, 32, 5], [150, 26, 4], [40, 200, 4], [226, 186, 5], [130, 228, 3]];

  const svgNS = 'http://www.w3.org/2000/svg';
  const sampler = document.createElementNS(svgNS, 'svg');
  sampler.setAttribute('width', '0'); sampler.setAttribute('height', '0');
  sampler.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const samplerPath = document.createElementNS(svgNS, 'path');
  sampler.appendChild(samplerPath);
  document.body.appendChild(sampler);

  function svgPolyline(d) {
    samplerPath.setAttribute('d', d);
    const L = samplerPath.getTotalLength();
    const k = Math.max(8, Math.ceil(L / 1.5));
    const pts = [];
    for (let i = 0; i <= k; i++) { const p = samplerPath.getPointAtLength((L * i) / k); pts.push({ x: p.x, y: p.y }); }
    return pts;
  }
  function ellipse(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 120) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }); }
    return pts;
  }

  const hexRgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  function logoColor(x) {
    const t = Math.max(0, Math.min(1, (x - 20) / 216));
    for (let i = 1; i < LOGO_STOPS.length; i++) {
      const [t1, c1] = LOGO_STOPS[i];
      const [t0, c0] = LOGO_STOPS[i - 1];
      if (t <= t1) { const k = (t - t0) / (t1 - t0); return c0.map((v, j) => v + (c1[j] - v) * k); }
    }
    return LOGO_STOPS[LOGO_STOPS.length - 1][1];
  }

  // Formes cibles dans la boîte 256 : [{ pts, color: [r,g,b] | (x)=>[r,g,b], w, a }]
  function heartShape(color) {
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const t = (Math.PI * 2 * i) / 240;
      const X = 16 * Math.sin(t) ** 3;
      const Y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push({ x: 128 + X * 6.8, y: 128 - (Y + 2.5) * 6.8 });
    }
    return [{ pts, color, w: 5, a: 1 }];
  }
  function smileyShape(c) {
    return [
      { pts: ellipse(128, 128, 108, 108, -Math.PI / 2, Math.PI * 1.5, 200), color: c, w: 5, a: 1 },
      { pts: ellipse(90, 100, 11, 17), color: c, w: 5, a: 1 },
      { pts: ellipse(166, 100, 11, 17), color: c, w: 5, a: 1 },
      { pts: ellipse(128, 124, 64, 60, Math.PI * 0.14, Math.PI * 0.86, 100), color: c, w: 5, a: 1 },
    ];
  }
  function logoShape() {
    const paths = LOGO_PATHS.map((d, i) => ({ pts: svgPolyline(d), color: logoColor, w: i === 0 ? 3 : 3.6, a: 1 }));
    for (const d of LOGO_AURORA) paths.push({ pts: svgPolyline(d), color: logoColor, w: 2.2, a: 0.6 });
    for (const [x, y, r] of LOGO_STARS) {
      paths.push({ pts: [{ x: x - r, y }, { x: x + r, y }], color: [255, 255, 255], w: 2, a: 0.9 });
      paths.push({ pts: [{ x, y: y - r }, { x, y: y + r }], color: [255, 255, 255], w: 2, a: 0.9 });
    }
    return paths;
  }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }
  function resamplePolyline(pts, n) {
    if (pts.length === 1 || n === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
    const L = polyLength(pts);
    if (L === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
    const out = [];
    let seg = 1, acc = 0;
    let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    for (let i = 0; i < n; i++) {
      const d = (L * i) / (n - 1);
      while (acc + segLen < d && seg < pts.length - 1) {
        acc += segLen; seg++;
        segLen = Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y);
      }
      const k = segLen ? Math.min(1, (d - acc) / segLen) : 0;
      const a = pts[seg - 1], b = pts[seg];
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
    return out;
  }

  // Répartit N points entre les tracés (2 minimum chacun, le reste au prorata de la longueur).
  function sampleShape(paths, N, map) {
    const lens = paths.map((p) => polyLength(p.pts));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const spare = N - paths.length * 2;
    const counts = lens.map((l) => 2 + Math.floor((spare * l) / total));
    let rest = N - counts.reduce((a, b) => a + b, 0);
    const longest = lens.indexOf(Math.max(...lens));
    counts[longest] += rest;
    const out = [];
    paths.forEach((p, pi) => {
      for (const q of resamplePolyline(p.pts, counts[pi])) {
        const m = map ? map(q) : q;
        const c = typeof p.color === 'function' ? p.color(q.x) : p.color;
        out.push({ x: m.x, y: m.y, p: pi, c, w: p.w, a: p.a });
      }
    });
    return out;
  }

  function startMorph() {
    const ink = strokes.filter((s) => s.kind === 'stroke' && s.tool !== 'eraser');
    if (!ink.length) return;

    // Position et taille : centrées sur le dessin, contenues dans la zone libre de l'écran.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of ink) for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const topLimit = document.getElementById('btn-back').getBoundingClientRect().bottom + 16;
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    // on garde de la place sous la figure pour la signature du logo
    const bottomLimit = (viewMode ? H : tb.top) - 16 - SIGNATURE_SPACE;
    const availH = Math.max(120, bottomLimit - topLimit);
    const S = Math.max(Math.min(200, W - 32, availH), Math.min(Math.max(x1 - x0, y1 - y0) * 1.05, W - 32, availH));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const cx = clamp((x0 + x1) / 2, S / 2 + 16, W - S / 2 - 16);
    const cy = clamp((y0 + y1) / 2, topLimit + S / 2, Math.max(topLimit + S / 2, bottomLimit - S / 2));
    const map = (q) => ({ x: cx + ((q.x - 128) * S) / 256, y: cy + ((q.y - 128) * S) / 256 });

    const origPaths = ink.map((s) => ({ pts: s.points, color: hexRgb(s.color), w: s.width, a: s.opacity ?? 1 }));
    // cœur et smiley reprennent la couleur du dernier trait dessiné
    const inkColor = hexRgb(ink[ink.length - 1].color);
    const logo = logoShape();
    const N = Math.max(1100, 2 * Math.max(origPaths.length, logo.length) + 300);
    const shapes = [
      sampleShape(origPaths, N),
      sampleShape(heartShape(inkColor), N, map),
      sampleShape(smileyShape(inkColor), N, map),
      sampleShape(logo, N, map),
    ];
    morph = { shapes, cx, cy, S, from: 0, to: 0, t0: 0, animating: false, raf: 0 };
    renderAll();
    animateMorph(1);
  }

  function animateMorph(to) {
    morph.from = morph.to;
    morph.to = to;
    morph.t0 = performance.now();
    morph.animating = true;
    const tick = () => {
      if (!morph) return;
      renderLive();
      if (performance.now() - morph.t0 >= MORPH_MS) {
        morph.animating = false;
        if (morph.to === 0) { finishMorph(); return; }
      } else morph.raf = requestAnimationFrame(tick);
    };
    morph.raf = requestAnimationFrame(tick);
  }

  function advanceMorph() {
    if (!morph || morph.animating) return;
    animateMorph((morph.to + 1) % 4);
  }

  function finishMorph() {
    morph = null;
    renderAll();
    renderLive();
  }
  function cancelMorph() {
    if (!morph) return;
    cancelAnimationFrame(morph.raf);
    finishMorph();
  }

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function drawMorph(ctx) {
    const raw = Math.min(1, (performance.now() - morph.t0) / MORPH_MS);
    const e = easeInOut(raw);
    const A = morph.shapes[morph.from];
    const B = morph.shapes[morph.to];
    // Petit « rebond » de taille au milieu de la transition.
    const swell = 1 + Math.sin(Math.PI * e) * 0.06;
    let gx = 0, gy = 0;
    for (const p of B) { gx += p.x; gy += p.y; }
    gx /= B.length; gy /= B.length;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < A.length - 1; i++) {
      const a0 = A[i], a1 = A[i + 1], b0 = B[i], b1 = B[i + 1];
      const alpha = (a0.p === a1.p ? (1 - e) * a0.a : 0) + (b0.p === b1.p ? e * b0.a : 0);
      if (alpha < 0.02) continue;
      const x0 = a0.x + (b0.x - a0.x) * e, y0 = a0.y + (b0.y - a0.y) * e;
      const x1 = a1.x + (b1.x - a1.x) * e, y1 = a1.y + (b1.y - a1.y) * e;
      const c = [0, 1, 2].map((j) => Math.round(a0.c[j] + (b0.c[j] - a0.c[j]) * e));
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.lineWidth = a0.w + (b0.w - a0.w) * e;
      ctx.beginPath();
      ctx.moveTo(gx + (x0 - gx) * swell, gy + (y0 - gy) * swell);
      ctx.lineTo(gx + (x1 - gx) * swell, gy + (y1 - gy) * swell);
      ctx.stroke();
    }
    ctx.restore();

    // Signature sous le logo : apparaît avec lui, disparaît quand on le quitte.
    const LOGO = 3;
    const k = morph.to === LOGO ? e : morph.from === LOGO ? 1 - e : 0;
    if (k > 0.01) drawSignature(ctx, k);
  }

  function drawSignature(ctx, k) {
    const { cx, cy, S } = morph;
    const size = Math.max(11, Math.min(16, S * 0.062));
    const y = cy + (118 / 256) * S + size * 1.9 + (1 - k) * 10;
    const spacing = size * 0.28;
    const parts = [
      { text: 'POWERED BY ', weight: 500, fill: 'rgba(255,255,255,0.62)' },
      { text: 'AURACLIP', weight: 800, fill: null },
    ];
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textBaseline = 'middle';
    const font = (w) => `${w} ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Helvetica, Arial, sans-serif`;
    // largeur totale (lettre par lettre, pour l'espacement)
    let total = 0;
    for (const part of parts) {
      ctx.font = font(part.weight);
      for (const ch of part.text) total += ctx.measureText(ch).width + spacing;
    }
    total -= spacing;
    let x = cx - total / 2;
    const grad = ctx.createLinearGradient(x, 0, x + total, 0);
    LOGO_STOPS.forEach(([t, c]) => grad.addColorStop(t, `rgb(${c.map(Math.round).join(',')})`));
    for (const part of parts) {
      ctx.font = font(part.weight);
      ctx.fillStyle = part.fill || grad;
      for (const ch of part.text) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + spacing;
      }
    }
    ctx.restore();
  }


  // ---------- aura_all : synchronisation avec l'autre iPhone (via la page parente) ----------
  // Chaque élément reçoit un identifiant. Après chaque rendu, on compare la liste des éléments
  // avec la précédente : les éléments ajoutés partent avec leurs données, les retirés par identifiant.
  // Les coordonnées voyagent en fraction de la largeur de l'écran (0–10000) : même dessin, mêmes
  // proportions sur deux iPhones de tailles différentes.
  const hub = (() => { try { return window.parent !== window ? window.parent.AuraAll : null; } catch (_) { return null; } })();
  const NET = 10000;
  const MAX_BATCH = 40000;           // Aura.peer : 64 Ko max par message
  const ids = new WeakMap();
  const myTag = Math.random().toString(36).slice(2, 7);
  let idSeq = 0;
  let lastSynced = [];
  let applyingRemote = false;
  const remoteLive = new Map();      // id → trait en cours de l'autre côté

  function newId() { return myTag + '-' + (idSeq++).toString(36); }
  function setId(o, id) { ids.set(o, id); return o; }
  function idOf(o) { let id = ids.get(o); if (!id) { id = newId(); ids.set(o, id); } return id; }
  const q = (v) => Math.round((v * NET) / (W || 1));
  const uq = (v) => (v * (W || 1)) / NET;

  function toNet(o) {
    if (o.kind === 'stroke') {
      const hasW = o.points.some((p) => p.w !== undefined);
      const p = [];
      for (const pt of o.points) { p.push(q(pt.x), q(pt.y)); if (hasW) p.push(q(pt.w ?? o.width)); }
      return { kind: 'stroke', tool: o.tool, color: o.color, opacity: o.opacity, width: q(o.width), hasW, p };
    }
    if (o.kind === 'text') return { ...o, x: q(o.x), y: q(o.y), size: q(o.size) };
    if (o.kind === 'image') return o.src.length > MAX_BATCH ? null : { ...o, x: q(o.x), y: q(o.y), w: q(o.w), h: q(o.h) };
    return null;
  }
  function fromNet(n) {
    if (n.kind === 'stroke') {
      const step = n.hasW ? 3 : 2;
      const points = [];
      for (let i = 0; i + 1 < n.p.length; i += step) {
        const pt = { x: uq(n.p[i]), y: uq(n.p[i + 1]) };
        if (n.hasW) pt.w = uq(n.p[i + 2]);
        points.push(pt);
      }
      return { kind: 'stroke', tool: n.tool, color: n.color, opacity: n.opacity, width: uq(n.width), points };
    }
    if (n.kind === 'text') return { ...n, x: uq(n.x), y: uq(n.y), size: uq(n.size) };
    if (n.kind === 'image') return { ...n, x: uq(n.x), y: uq(n.y), w: uq(n.w), h: uq(n.h) };
    return null;
  }

  // Envoie des ajouts en plusieurs messages si besoin (limite de taille).
  function sendOps(rm, add) {
    if (!hub) return;
    let batch = [], size = 0;
    const flush = (first) => { hub.send({ t: 'n.ops', rm: first ? rm : [], add: batch }); batch = []; size = 0; };
    let first = true;
    for (const a of add) {
      const len = JSON.stringify(a).length;
      if (batch.length && size + len > MAX_BATCH) { flush(first); first = false; }
      batch.push(a); size += len;
    }
    if (batch.length || first) flush(first);
  }

  function syncOut() {
    if (applyingRemote) return;
    const cur = strokes;
    if (cur === lastSynced) return;
    const before = new Set(lastSynced);
    const now = new Set(cur);
    const rm = lastSynced.filter((o) => !now.has(o)).map(idOf);
    const add = [];
    cur.forEach((o, i) => {
      if (before.has(o)) return;
      const item = toNet(o);
      if (item) add.push({ id: idOf(o), after: i ? idOf(cur[i - 1]) : null, item });
    });
    lastSynced = cur;
    if (rm.length || add.length) sendOps(rm, add);
  }

  // Applique les changements de l'autre iPhone à une liste d'éléments.
  function applyTo(list, rmSet, adds) {
    const next = list.filter((o) => !rmSet.has(idOf(o)));
    for (const { id, obj, after } of adds) {
      if (next.some((o) => idOf(o) === id)) continue;
      const at = after ? next.findIndex((o) => idOf(o) === after) : -1;
      if (at >= 0) next.splice(at + 1, 0, obj); else next.push(obj);
    }
    return next;
  }

  // Trait en direct : début, points (envoyés toutes les 50 ms), fin.
  let liveOut = null, liveTimer = 0;
  function liveStart(stroke) {
    if (!hub || !hub.connected()) return;
    const p0 = stroke.points[0];
    liveOut = { id: idOf(stroke), hasW: stroke.tool === 'pen', pts: [] };
    hub.send({ t: 'n.live', id: liveOut.id,
      h: { tool: stroke.tool, color: stroke.color, opacity: stroke.opacity, width: q(stroke.width), hasW: liveOut.hasW },
      p: liveOut.hasW ? [q(p0.x), q(p0.y), q(p0.w ?? stroke.width)] : [q(p0.x), q(p0.y)] });
  }
  function liveAdd(stroke, pt) {
    if (!liveOut || liveOut.id !== idOf(stroke)) return;
    liveOut.pts.push(q(pt.x), q(pt.y));
    if (liveOut.hasW) liveOut.pts.push(q(pt.w ?? stroke.width));
    if (!liveTimer) liveTimer = setTimeout(liveFlush, 50);
  }
  function liveFlush() {
    clearTimeout(liveTimer); liveTimer = 0;
    if (!liveOut || !liveOut.pts.length) return;
    hub.send({ t: 'n.live', id: liveOut.id, p: liveOut.pts });
    liveOut.pts = [];
  }

  function onLive({ id, h, p }) {
    let s = remoteLive.get(id);
    if (!s) {
      if (!h) return;
      s = { kind: 'stroke', tool: h.tool, color: h.color, opacity: h.opacity, width: uq(h.width), hasW: h.hasW, points: [] };
      remoteLive.set(id, s);
    }
    const step = s.hasW ? 3 : 2;
    for (let i = 0; i + 1 < p.length; i += step) {
      const pt = { x: uq(p[i]), y: uq(p[i + 1]) };
      if (s.hasW) pt.w = uq(p[i + 2]);
      s.points.push(pt);
    }
    scheduleLive();
  }

  function onOps({ rm, add }) {
    const rmSet = new Set(rm);
    const adds = add.map(({ id, after, item }) => ({ id, after, obj: setId(fromNet(item), id) })).filter((a) => a.obj);
    adds.forEach(({ id }) => remoteLive.delete(id));
    applyingRemote = true;
    strokes = applyTo(strokes, rmSet, adds);
    // Les historiques reçoivent les mêmes changements : « Annuler » n'annule que mes propres actions.
    undoStack = undoStack.map((l) => applyTo(l, rmSet, adds));
    redoStack = redoStack.map((l) => applyTo(l, rmSet, adds));
    if (selection) selection = null;
    lastSynced = strokes;
    renderAll();
    renderLive();
    save();
    applyingRemote = false;
    if (adds.length && hub) hub.haptic('selection');
  }

  // Appelé par la page parente.
  window.auraIncoming = (msg) => {
    if (msg.t === 'n.live') onLive(msg);
    else if (msg.t === 'n.ops') onOps(msg);
  };
  // À la connexion : chacun envoie tout son dessin, l'autre fusionne (rien n'est perdu).
  window.auraSync = () => {
    const add = strokes.map((o, i) => ({ id: idOf(o), after: i ? idOf(strokes[i - 1]) : null, item: toNet(o) })).filter((a) => a.item);
    if (add.length) sendOps([], add);
  };
  window.auraRefresh = () => resize();

  // ---------- Démarrage ----------
  load();
  if (tools[current].color) lastInkTool = current;
  updateToolbar();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
})();
