// Homepage hero: an interactive sequence strand. Each bead is one amino acid of
// a real catalog peptide, coloured by side-chain class; the strand rebuilds one
// residue at a time when a peptide is chosen (peptides are synthesised residue
// by residue). It is a stylised helix, not a structural model, and the page
// says so. The readout beside it is the accessible version of the canvas.
(() => {
  'use strict';
  const canvas = document.getElementById('strandCanvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const $ = (id) => document.getElementById(id);

  // One-letter code → [three-letter code, name, side-chain class]
  const AMINO = {
    A: ['Ala', 'Alanine', 'nonpolar'], R: ['Arg', 'Arginine', 'positive'], N: ['Asn', 'Asparagine', 'polar'],
    D: ['Asp', 'Aspartic acid', 'negative'], C: ['Cys', 'Cysteine', 'polar'], E: ['Glu', 'Glutamic acid', 'negative'],
    Q: ['Gln', 'Glutamine', 'polar'], G: ['Gly', 'Glycine', 'nonpolar'], H: ['His', 'Histidine', 'positive'],
    I: ['Ile', 'Isoleucine', 'nonpolar'], L: ['Leu', 'Leucine', 'nonpolar'], K: ['Lys', 'Lysine', 'positive'],
    M: ['Met', 'Methionine', 'nonpolar'], F: ['Phe', 'Phenylalanine', 'nonpolar'], P: ['Pro', 'Proline', 'nonpolar'],
    S: ['Ser', 'Serine', 'polar'], T: ['Thr', 'Threonine', 'polar'], W: ['Trp', 'Tryptophan', 'nonpolar'],
    Y: ['Tyr', 'Tyrosine', 'polar'], V: ['Val', 'Valine', 'nonpolar'],
  };
  const KIND = { nonpolar: 'Nonpolar side chain', polar: 'Polar side chain', positive: 'Positively charged side chain', negative: 'Negatively charged side chain' };
  const PEPTIDES = {
    bpc: { name: 'BPC-157', sequence: 'GEPPPGKPADDAGLV', meta: '15 amino acids' },
    ser: { name: 'Sermorelin', sequence: 'YADAIFTNSYRKVLGQLSARKLLQDIMSR', meta: '29 amino acids · GHRH (1–29)' },
    ghk: { name: 'GHK-Cu', sequence: 'GHK', meta: '3 amino acids bound to a copper ion', ion: true },
  };

  const styles = getComputedStyle(document.body);
  const hex = (name, fallback) => {
    const value = (styles.getPropertyValue(name) || fallback).trim().replace('#', '');
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  };
  const COLORS = {
    nonpolar: hex('--aa-nonpolar', '#dcc6a3'), polar: hex('--aa-polar', '#eee7db'),
    positive: hex('--aa-positive', '#d48c6c'), negative: hex('--aa-negative', '#86b5ae'), ion: [184, 115, 51],
  };
  const rgba = (c, a = 1, lift = 0) => `rgba(${c.map((v) => Math.round(v + (255 - v) * lift)).join(',')},${a})`;
  const shade = (c, k) => `rgb(${c.map((v) => Math.round(v * k)).join(',')})`;

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reducedQuery.matches || document.documentElement.classList.contains('motion-off');

  let width = 0, height = 0, dpr = 1, frame = 0, last = 0, visible = true;
  let theta = .55, time = 0, assembledAt = 0, hover = -1, focus = -1;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, inside: false, px: 0, py: 0 };
  let current = 'bpc', beads = [];
  const dust = Array.from({ length: 46 }, () => ({ a: Math.random() * Math.PI * 2, r: .6 + Math.random() * 1.6, y: Math.random() * 2 - 1, s: .5 + Math.random() }));

  function build(key) {
    const peptide = PEPTIDES[key];
    beads = [...peptide.sequence].map((code, i) => ({ code, i, kind: AMINO[code][2] }));
    if (peptide.ion) beads.push({ code: 'Cu', i: beads.length, kind: 'ion' });
    assembledAt = time;
  }

  // Path in model space: an α-helix (~3.6 residues per turn) for chains, or a
  // ring around the copper ion for GHK-Cu. t is a fractional residue index.
  function pathPoint(t, n, R, rise) {
    if (PEPTIDES[current].ion) {
      const a = t * (Math.PI * 2 / 3) - Math.PI / 2;
      return [R * .95 * Math.cos(a), (t - 1) * rise * .2, R * .95 * Math.sin(a)];
    }
    const a = t * (100 * Math.PI / 180);
    return [R * Math.cos(a), (t - (n - 1) / 2) * rise, R * Math.sin(a)];
  }

  function project([x, y, z], cx, cy) {
    const spin = theta + pointer.x * .6;
    const x1 = x * Math.cos(spin) - z * Math.sin(spin);
    const z1 = x * Math.sin(spin) + z * Math.cos(spin);
    // Tip toward the viewer (so the copper ring reads as a ring), then lean the axis.
    const tx = PEPTIDES[current].ion ? .95 : .26;
    const y1 = y * Math.cos(tx) - z1 * Math.sin(tx);
    const z2 = y * Math.sin(tx) + z1 * Math.cos(tx);
    const tz = -.2 + pointer.y * .1;
    const x2 = x1 * Math.cos(tz) - y1 * Math.sin(tz);
    const y2 = x1 * Math.sin(tz) + y1 * Math.cos(tz);
    const s = 900 / (900 - z2);
    return { x: cx + x2 * s, y: cy + y2 * s, z: z2, s };
  }

  function draw() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const narrow = width < 520;
    const ionMode = Boolean(PEPTIDES[current].ion);
    const cx = width * (narrow ? .5 : .66), cy = height * (narrow ? .5 : .54);
    const n = beads.filter((b) => b.kind !== 'ion').length;
    const R = Math.min(width, height) * (ionMode ? .2 : narrow ? .2 : .14);
    const rise = Math.min((height * (narrow ? .7 : .44)) / Math.max(1, n - 1), 30);
    const base = ionMode ? 24 : Math.max(8, Math.min(17, rise * .62, R * .26));
    const step = Math.min(.09, 1.5 / Math.max(n, 1)); // seconds per residue while assembling
    const grown = still() ? n - 1 : Math.min(n - 1, (time - assembledAt) / step);

    // Drifting dust gives the stage depth; it turns with the strand.
    for (const d of dust) {
      const p = project([Math.cos(d.a) * R * d.r * 1.7, d.y * height * .42, Math.sin(d.a) * R * d.r * 1.7], cx, cy);
      ctx.fillStyle = `rgba(220,198,163,${Math.max(0, .08 + .2 * (p.z / (R * 3) + .5)) * d.s})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 * p.s, 0, Math.PI * 2); ctx.fill();
    }

    // Backbone: a smooth coil traced as far as the strand has grown.
    ctx.lineCap = 'round';
    let previous = null;
    for (let t = 0; t <= grown + 1e-6; t += .08) {
      const p = project(pathPoint(Math.min(t, grown), n, R, rise), cx, cy);
      if (previous) {
        const depth = Math.max(0, Math.min(1, (p.z + previous.z) / (4 * R) + .5));
        ctx.strokeStyle = `rgba(220,198,163,${.12 + .5 * depth})`;
        ctx.lineWidth = (1.2 + 2.2 * depth) * p.s;
        ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      previous = p;
    }

    // Beads appear as the coil reaches them; the copper ion settles in last.
    const placed = beads.map((bead) => {
      const reached = bead.kind === 'ion' ? (still() ? 1 : (time - assembledAt - n * step) / .5) : grown - bead.i + 1;
      const ease = Math.max(0, Math.min(1, reached));
      const point = bead.kind === 'ion' ? [0, 0, 0] : pathPoint(bead.i, n, R, rise);
      return { bead, ease: 1 - Math.pow(1 - ease, 3), ...project(point, cx, cy) };
    });
    const ion = placed.find((p) => p.bead.kind === 'ion');
    if (ion && ion.ease) {
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = `rgba(214,140,90,${.6 * ion.ease})`;
      ctx.lineWidth = 1.5;
      placed.filter((p) => p !== ion).forEach((p) => { ctx.beginPath(); ctx.moveTo(ion.x, ion.y); ctx.lineTo(p.x, p.y); ctx.stroke(); });
      ctx.setLineDash([]);
    }

    // Beads, far to near.
    const active = hover >= 0 ? hover : focus;
    [...placed].sort((a, b) => a.z - b.z).forEach((p) => {
      if (!p.ease) return;
      const color = COLORS[p.bead.kind];
      const r = base * p.s * (p.bead.kind === 'ion' ? 1.2 : 1) * (.3 + .7 * p.ease) * (p.bead.i === active ? 1.25 : 1);
      const depth = Math.max(0, Math.min(1, p.z / (2 * R) + .5));
      ctx.globalAlpha = (.5 + .5 * depth) * p.ease;
      if (p.bead.i === active) { ctx.shadowColor = rgba(color, .9); ctx.shadowBlur = 26; }
      const g = ctx.createRadialGradient(p.x - r * .35, p.y - r * .4, r * .1, p.x, p.y, r);
      g.addColorStop(0, rgba(color, 1, .7));
      g.addColorStop(.45, rgba(color, 1));
      g.addColorStop(1, shade(color, .4));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (p.bead.i === active) {
        ctx.strokeStyle = 'rgba(244,238,228,.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
      if (r > 9 && depth > .3) {
        ctx.fillStyle = `rgba(23,20,15,${.85 * p.ease})`;
        ctx.font = `500 ${Math.round(Math.min(14, r * .8))}px "DM Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.bead.code, p.x, p.y + .5);
      }
      ctx.globalAlpha = 1;
      p.r = r;
    });
    lastPlaced = placed;
  }
  let lastPlaced = [];

  // ─── Readout (the accessible version of the canvas) ───
  function describe(index) {
    const peptide = PEPTIDES[current];
    const bead = beads[index];
    if (!bead) { $('strandFocus').textContent = 'Point at a bead or tab through the sequence.'; return; }
    if (bead.kind === 'ion') {
      $('strandFocus').replaceChildren('Cu²⁺ · Copper(II) ion', Object.assign(document.createElement('span'), { textContent: 'Held by the GHK tripeptide' }));
    } else {
      const [three, name, kind] = AMINO[bead.code];
      const n = peptide.sequence.length;
      $('strandFocus').replaceChildren(`${String(index + 1).padStart(2, '0')} / ${n} · ${three} · ${name}`, Object.assign(document.createElement('span'), { textContent: KIND[kind] }));
    }
    $('strandSeq').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', String(i === index)));
  }
  function setActive(index, source) {
    if (source === 'hover') hover = index; else focus = index;
    describe(hover >= 0 ? hover : focus);
    if (!frame) draw();
  }

  function select(key) {
    current = key;
    const peptide = PEPTIDES[key];
    build(key);
    hover = focus = -1;
    document.querySelectorAll('[data-seq]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.seq === key)));
    $('strandName').textContent = peptide.name;
    $('strandMeta').textContent = peptide.meta;
    const details = $('strandDetails');
    details.dataset.details = key;
    details.firstChild.textContent = `View ${peptide.name} `;
    $('strandSeq').setAttribute('aria-label', `${peptide.name} sequence`);
    $('strandSeq').replaceChildren(...beads.map((bead, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = bead.code;
      button.style.setProperty('--seq-color', rgba(COLORS[bead.kind]));
      button.setAttribute('aria-label', bead.kind === 'ion' ? 'Copper(II) ion' : `Residue ${i + 1} of ${peptide.sequence.length}: ${AMINO[bead.code][1]}`);
      button.addEventListener('mouseenter', () => setActive(i, 'focus'));
      button.addEventListener('mouseleave', () => setActive(-1, 'focus'));
      button.addEventListener('focus', () => setActive(i, 'focus'));
      button.addEventListener('blur', () => setActive(-1, 'focus'));
      return button;
    }));
    describe(-1);
    start();
  }
  document.querySelectorAll('[data-seq]').forEach((button) => button.addEventListener('click', () => select(button.dataset.seq)));

  // ─── Pointer ───
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.px = event.clientX - rect.left; pointer.py = event.clientY - rect.top;
    pointer.tx = (pointer.px / rect.width - .5) * 2;
    pointer.ty = (pointer.py / rect.height - .5) * 2;
    let best = -1, bestDistance = Infinity;
    for (const p of lastPlaced) {
      const distance = Math.hypot(p.x - pointer.px, p.y - pointer.py);
      if (p.r && distance < p.r + 6 && distance < bestDistance) { best = p.bead.i; bestDistance = distance; }
    }
    if (best !== hover) setActive(best, 'hover');
    canvas.style.cursor = best >= 0 ? 'pointer' : 'crosshair';
  });
  canvas.addEventListener('pointerleave', () => { pointer.tx = pointer.ty = 0; if (hover >= 0) setActive(-1, 'hover'); });

  // ─── Loop ───
  function tick(now) {
    frame = 0;
    if (!visible || document.hidden || still()) { draw(); return; }
    const dt = Math.min(.05, (now - (last || now)) / 1000);
    last = now;
    time += dt;
    theta += dt * (hover >= 0 || focus >= 0 ? .06 : .32);
    pointer.x += (pointer.tx - pointer.x) * .05;
    pointer.y += (pointer.ty - pointer.y) * .05;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (frame) return;
    if (still() || document.hidden || !visible) { draw(); return; }
    last = 0;
    frame = requestAnimationFrame(tick);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  new ResizeObserver(resize).observe(canvas);
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  reducedQuery.addEventListener('change', start);
  new MutationObserver(start).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // Fonts load after first paint; redraw so bead letters use DM Mono.
  document.fonts?.ready.then(draw);
  resize();
  select('bpc');
})();
