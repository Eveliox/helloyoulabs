(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionAllowed = () => !reduced.matches && root.classList.contains('motion-active') && !document.hidden;
  const canvas = document.getElementById('materialCanvas');
  const context = canvas?.getContext('2d');
  let studyMode = 0;
  let redraw = () => {};

  document.querySelectorAll('[data-study]').forEach((button, index) => {
    button.addEventListener('click', () => {
      const product = PRODUCTS.find((item) => item.id === button.dataset.study);
      if (!product) return;
      document.querySelectorAll('[data-study]').forEach((choice) => choice.setAttribute('aria-pressed', String(choice === button)));
      const image = document.getElementById('studyImage');
      image.src = product.img;
      image.alt = `Hello You ${product.name} research vial`;
      document.getElementById('studyName').textContent = product.name;
      document.getElementById('studyPrice').textContent = `From $${Math.min(...product.variants.map((v) => v.price))} / vial`;
      const details = document.getElementById('studyDetails');
      details.dataset.details = product.id;
      details.setAttribute('aria-label', `View ${product.name} details`);
      studyMode = index;
      redraw();
    });
  });

  if (context) {
    let width = 0, height = 0, frame = 0, visible = false, time = 0, previous = 0;
    let pointerX = 0, pointerY = 0;
    const parent = canvas.parentElement;
    function project(x, y, z, angle) {
      const a = angle + pointerX * .18;
      const tilt = .62 + pointerY * .12;
      const xx = x * Math.cos(a) - z * Math.sin(a);
      const zz = x * Math.sin(a) + z * Math.cos(a);
      const yy = y * Math.cos(tilt) - zz * Math.sin(tilt);
      const depth = y * Math.sin(tilt) + zz * Math.cos(tilt);
      const perspective = 7 / (7 + depth);
      const scale = Math.min(width, height) * .126;
      return [width / 2 + xx * scale * perspective, height * .46 + yy * scale * perspective, depth];
    }
    function draw() {
      if (!width || !height) return;
      context.clearRect(0, 0, width, height);
      const angle = time * .11 + .45;
      // Braided parametric curves are abstract artwork, not molecular models.
      for (let strand = 0; strand < 38; strand++) {
        const phase = strand / 38 * Math.PI * 2;
        context.beginPath();
        for (let i = 0; i <= 220; i++) {
          const t = i / 220 * Math.PI * 2;
          const radius = 2.1 + .62 * Math.cos(t * (3 + studyMode) + phase * .27);
          const x = radius * Math.cos(t * 2) + .2 * Math.cos(phase);
          const y = radius * Math.sin(t * 2) + .2 * Math.sin(phase);
          const z = .8 * Math.sin(t * (3 + studyMode) + phase * .27);
          const point = project(x, y, z, angle);
          if (i === 0) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
        }
        context.strokeStyle = strand % 5 === 0 ? 'rgba(244,226,192,.7)' : `rgba(192,153,98,${.18 + strand / 180})`;
        context.lineWidth = strand % 5 === 0 ? .85 : .55;
        context.stroke();
      }
      // A quiet engraved orbit grounds the artwork in the composition.
      context.strokeStyle = 'rgba(200,175,135,.16)';
      context.lineWidth = .7;
      context.beginPath();
      context.ellipse(width / 2, height * .46, width * .44, height * .39, -.25, 0, Math.PI * 2);
      context.stroke();
      for (let i = 0; i < 34; i++) {
        const t = i * 2.39996;
        const radius = .29 + ((i * 17) % 13) / 100;
        const x = width / 2 + Math.cos(t + time * .015) * width * radius;
        const y = height * .46 + Math.sin(t + time * .015) * height * radius;
        context.fillStyle = i % 4 === 0 ? '#cbb18a' : '#8f7e6355';
        context.beginPath(); context.arc(x, y, i % 4 === 0 ? 1.4 : .6, 0, Math.PI * 2); context.fill();
      }
    }
    function tick(now) {
      frame = 0;
      if (!visible || !motionAllowed()) return;
      if (now - previous >= 32) {
        time += Math.min((now - previous) / 1000, .05);
        previous = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame); frame = 0; previous = performance.now();
      draw();
      if (visible && motionAllowed()) frame = requestAnimationFrame(tick);
    }
    redraw = sync;
    const resize = () => {
      width = parent.clientWidth; height = parent.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };
    new ResizeObserver(resize).observe(parent);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .05 }).observe(parent);
    } else { visible = true; sync(); }
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', sync);
    parent.addEventListener('pointermove', (event) => {
      if (!motionAllowed() || event.pointerType !== 'mouse') return;
      const rect = parent.getBoundingClientRect();
      pointerX = (event.clientX - rect.left) / rect.width - .5;
      pointerY = (event.clientY - rect.top) / rect.height - .5;
    });
    parent.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  }

  const figure = document.querySelector('.hero-editorial');
  const source = figure?.querySelector('img');
  const lens = figure?.querySelector('.inspection-lens');
  const toggle = figure?.querySelector('.inspect-toggle');
  const slider = document.getElementById('inspectionPosition');
  const tools = document.getElementById('inspectionTools');
  if (!figure || !source || !lens || !toggle || !slider) return;
  let active = false;
  function placeLens(xFraction = Number(slider.value) / 100, yFraction = .47) {
    const w = figure.clientWidth, h = figure.clientHeight;
    const radius = lens.offsetWidth / 2;
    const x = radius + 8 + xFraction * (w - 2 * radius - 16);
    const y = Math.max(radius + 110, Math.min(h - radius - 75, h * yFraction));
    const scale = Math.max(w / (source.naturalWidth || 1000), h / (source.naturalHeight || 1250));
    const iw = (source.naturalWidth || 1000) * scale;
    const ih = (source.naturalHeight || 1250) * scale;
    lens.style.left = `${x - radius}px`; lens.style.top = `${y - radius}px`;
    lens.style.backgroundSize = `${iw * 2}px ${ih * 2}px`;
    lens.style.backgroundPosition = `${radius - (x + (iw - w) / 2) * 2}px ${radius - (y + (ih - h) / 2) * 2}px`;
  }
  function setActive(value) {
    active = value;
    figure.classList.toggle('is-inspecting', active);
    toggle.setAttribute('aria-pressed', String(active));
    toggle.innerHTML = active ? 'Close detail <span>−</span>' : 'Inspect the detail <span>＋</span>';
    tools.hidden = !active;
    if (active) placeLens();
  }
  toggle.addEventListener('click', () => setActive(!active));
  slider.addEventListener('input', () => placeLens());
  figure.addEventListener('pointermove', (event) => {
    if (!active || event.pointerType !== 'mouse' || !motionAllowed() || event.target.closest('button, input')) return;
    const rect = figure.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    slider.value = Math.round(fraction * 100);
    placeLens(fraction, (event.clientY - rect.top) / rect.height);
  });
  figure.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) { setActive(false); toggle.focus(); }
  });
  source.addEventListener('load', () => { if (active) placeLens(); });
  new ResizeObserver(() => { if (active) placeLens(); }).observe(figure);
})();
