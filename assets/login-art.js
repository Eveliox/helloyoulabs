// Generative "silk study" for the sign-in page: an iridescent ribbon and a
// glass orb, drawn on a 2D canvas with film grain. It leans toward the pointer,
// renders a single still frame for reduced motion, and pauses when hidden.
(() => {
  'use strict';
  const canvas = document.getElementById('ribbon');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const SEGMENTS = 150;
  // Thin-film palette: pearl → champagne → bronze → umber → smoke teal → steel → lilac.
  const PALETTE = [
    [250, 246, 240], [238, 208, 162], [216, 140, 80], [104, 56, 34],
    [36, 108, 124], [72, 134, 206], [198, 172, 222], [250, 246, 240],
  ];

  let width = 0, height = 0, dpr = 1, time = 0, last = 0, frame = 0, visible = true;
  const pointer = { x: 0, y: .5, tx: 0, ty: .5 };

  const grain = document.createElement('canvas');
  grain.width = grain.height = 220;
  (() => {
    const g = grain.getContext('2d');
    const data = g.createImageData(220, 220);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.random();
      const light = v > .5;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = light ? 255 : 0;
      data.data[i + 3] = Math.pow(Math.abs(v - .5) * 2, 3) * 80;
    }
    g.putImageData(data, 0, 0);
  })();
  const grainPattern = ctx.createPattern(grain, 'repeat');

  function paletteAt(phase) {
    const p = ((phase % 1) + 1) % 1 * (PALETTE.length - 1);
    const i = Math.floor(p), f = p - i;
    const a = PALETTE[i], b = PALETTE[i + 1];
    const k = f * f * (3 - 2 * f);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  // Shade a palette colour, then lift it toward white for specular highlights.
  const rgb = (c, light, white = 0) => {
    const ch = (v) => Math.min(255, v * light + (255 - Math.min(255, v * light)) * white) | 0;
    return `rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})`;
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 1.75);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function centre(s, t) {
    const narrow = width < 520;
    const y = height * (-.12 + 1.24 * s);
    let x = width * ((narrow ? .5 : .42) + (narrow ? .17 : .13) * Math.sin(s * Math.PI * 2.1 - .9 + t * .23) + .04 * Math.sin(s * 5.3 + t * .41));
    const pull = Math.exp(-Math.pow((y / height - pointer.y) / .26, 2));
    x += pointer.x * width * .06 * pull;
    return [x, y];
  }

  function draw() {
    if (!width || !height) return;
    const t = time;
    ctx.clearRect(0, 0, width, height);

    // Faint contour field behind the ribbon.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(width * (.1 + i * .3), height * (.18 + i * .22), width * (.55 + i * .12), height * .32, -.35 + i * .2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ribbon geometry: centreline, normal, and a slow twist that narrows and widens the band.
    const left = [], right = [], meta = [];
    const baseWidth = Math.min(width * .15, 150);
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = i / SEGMENTS;
      const [x, y] = centre(s, t);
      const [x2, y2] = centre(s + .002, t);
      let nx = -(y2 - y), ny = x2 - x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      const twist = s * Math.PI * 1.7 + t * .32;
      const turn = .5 + .5 * Math.cos(twist);
      const half = baseWidth * (.72 + .3 * Math.sin(s * 3.1 + 1.2 + t * .19)) * (.38 + .62 * turn);
      left.push([x - nx * half, y - ny * half]);
      right.push([x + nx * half, y + ny * half]);
      meta.push({ s, twist, turn });
    }

    for (let i = 0; i < SEGMENTS; i++) {
      const { s, twist, turn } = meta[i];
      const L = left[i], R = right[i];
      const gradient = ctx.createLinearGradient(L[0], L[1], R[0], R[1]);
      const phase = s * 1.25 + t * .035 + Math.sin(twist) * .18;
      const shade = .5 + .62 * Math.pow(turn, .7) * (1 - .5 * Math.max(0, s - .66) / .34);
      const spec = .3 + .22 * Math.sin(twist + .8);
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        const body = .3 + .78 * Math.pow(Math.sin(Math.PI * u), .8);
        const glint = Math.exp(-Math.pow((u - spec) / .13, 2)) * .62 * turn;
        gradient.addColorStop(u, rgb(paletteAt(phase + u * .38), shade * body, glint));
      }
      ctx.fillStyle = gradient;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(L[0], L[1]);
      ctx.lineTo(R[0], R[1]);
      ctx.lineTo(right[i + 1][0], right[i + 1][1]);
      ctx.lineTo(left[i + 1][0], left[i + 1][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Glass orb resting against the ribbon.
    const anchor = Math.round(SEGMENTS * .5);
    const a = left[anchor], b = right[anchor];
    const ox = (a[0] + b[0]) / 2 + Math.sin(t * .6) * 4;
    const oy = (a[1] + b[1]) / 2 + Math.cos(t * .5) * 6;
    const r = Math.min(width, height) * .095;
    const orb = ctx.createRadialGradient(ox - r * .4, oy - r * .45, r * .05, ox, oy, r);
    const tint = paletteAt(.62 + t * .02);
    orb.addColorStop(0, 'rgba(248,244,236,.95)');
    orb.addColorStop(.18, rgb(paletteAt(.75 + t * .02), 1));
    orb.addColorStop(.55, rgb(tint, .62));
    orb.addColorStop(.86, 'rgb(28,30,34)');
    orb.addColorStop(1, rgb(paletteAt(.18), .9));
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = r * .6;
    ctx.shadowOffsetY = r * .25;
    ctx.fillStyle = orb;
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const rim = ctx.createRadialGradient(ox + r * .35, oy + r * .45, r * .1, ox, oy, r);
    rim.addColorStop(.7, 'rgba(220,198,163,0)');
    rim.addColorStop(1, 'rgba(220,198,163,.35)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();

    // Film grain on everything drawn so far, then a soft fade into the page.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = grainPattern;
    ctx.translate((t * 37) % 220, (t * 23) % 220);
    ctx.fillRect(-220, -220, width + 440, height + 440);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,.35)');
    fade.addColorStop(.12, 'rgba(0,0,0,0)');
    fade.addColorStop(.8, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,.8)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  function tick(now) {
    frame = 0;
    if (!visible || document.hidden || reduced.matches) return;
    const dt = Math.min(.05, (now - (last || now)) / 1000);
    last = now;
    time += dt;
    pointer.x += (pointer.tx - pointer.x) * .06;
    pointer.y += (pointer.ty - pointer.y) * .06;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (frame || reduced.matches || document.hidden || !visible) { draw(); return; }
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
    pointer.ty = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  }, { passive: true });
  new ResizeObserver(resize).observe(canvas);
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  reduced.addEventListener('change', start);
  resize();
  start();
})();
