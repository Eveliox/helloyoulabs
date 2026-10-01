(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const preferenceKey = 'hyl_motion_enabled';
  let preference = true;
  try { preference = localStorage.getItem(preferenceKey) !== 'false'; } catch {}
  const enabled = () => preference && !reduced.matches;
  const running = new Set();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'motion-toggle';
  document.body.append(toggle);
  const progress = document.createElement('div');
  progress.className = 'reading-progress';
  progress.setAttribute('aria-hidden', 'true');
  document.body.append(progress);

  function syncMotion() {
    root.classList.toggle('motion-active', enabled());
    root.classList.toggle('motion-off', !enabled());
    toggle.setAttribute('aria-pressed', String(enabled()));
    toggle.textContent = reduced.matches ? 'Reduced motion' : enabled() ? 'Pause motion' : 'Enable motion';
    toggle.setAttribute('aria-label', reduced.matches ? 'Reduced motion follows your device setting' : enabled() ? 'Pause decorative animations' : 'Enable decorative animations');
    toggle.disabled = reduced.matches;
    if (!enabled()) {
      running.forEach((animation) => animation.cancel());
      running.clear();
    }
  }
  toggle.addEventListener('click', () => {
    preference = !preference;
    try { localStorage.setItem(preferenceKey, String(preference)); } catch {}
    syncMotion();
  });
  reduced.addEventListener('change', syncMotion);
  syncMotion();

  function animate(element, keyframes, options = {}) {
    if (!enabled() || !element.animate) return;
    const animation = element.animate(keyframes, {
      duration: 750,
      easing: 'cubic-bezier(.22,1,.36,1)',
      ...options,
    });
    running.add(animation);
    animation.finished.catch(() => {}).finally(() => running.delete(animation));
  }

  // Reveal on entry without hiding content or making navigation depend on JS.
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        animate(target, [
          { transform: 'translateY(32px)' },
          { transform: 'translateY(0)' },
        ]);
        reveal.unobserve(target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -25px 0px' });
    document.querySelectorAll('.section-heading, .center-heading, .approach-grid, .timeline-step, .portal .panel, .portal .stat, .standards-hero, .portal details, .footer-grid').forEach((element) => reveal.observe(element));
    const scenes = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => target.classList.toggle('scene-visible', isIntersecting));
    }, { threshold: 0.05 });
    document.querySelectorAll('.research-stage, .login-art, .hero-editorial').forEach((scene) => scenes.observe(scene));
  }

  document.querySelectorAll('.hero-copy > *, .login-form > *, .dashboard-hero > div:first-child > *').forEach((element, index) => {
    animate(element, [{ transform: 'translateY(22px)' }, { transform: 'translateY(0)' }], { delay: Math.min(index, 5) * 65, duration: 900 });
  });

  // A small pointer response gives the product composition depth without moving UI.
  document.querySelectorAll('.research-stage').forEach((stage) => {
    let frame = 0;
    stage.addEventListener('pointermove', (event) => {
      if (!enabled() || !finePointer.matches || frame) return;
      const rect = stage.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 5;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * -5;
      frame = requestAnimationFrame(() => {
        stage.style.setProperty('--tilt-x', `${y.toFixed(2)}deg`);
        stage.style.setProperty('--tilt-y', `${x.toFixed(2)}deg`);
        frame = 0;
      });
    });
    stage.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      frame = 0;
      stage.style.setProperty('--tilt-x', '0deg');
      stage.style.setProperty('--tilt-y', '0deg');
    });
  });

  const grid = document.getElementById('productGrid');
  if (grid) new MutationObserver(() => {
    [...grid.children].slice(0, 4).forEach((card, index) => {
      animate(card, [{ transform: 'translateY(14px)' }, { transform: 'translateY(0)' }], { duration: 450, delay: index * 45 });
    });
  }).observe(grid, { childList: true });

  document.querySelectorAll('dialog').forEach((dialog) => {
    new MutationObserver(() => {
      if (dialog.open) animate(dialog, [{ transform: 'translateY(14px) scale(.98)' }, { transform: 'translateY(0) scale(1)' }], { duration: 250 });
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });

  let scrollFrame = 0;
  function updateScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    root.style.setProperty('--reading-progress', max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0);
    root.classList.toggle('is-scrolled', scrollY > 20);
    scrollFrame = 0;
  }
  window.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  }, { passive: true });
  window.addEventListener('resize', updateScroll);
  updateScroll();
  document.addEventListener('visibilitychange', () => root.classList.toggle('motion-suspended', document.hidden));
})();
