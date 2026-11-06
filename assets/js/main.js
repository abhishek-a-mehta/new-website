/*
 * Shared interactions for every page:
 *   theme toggle · header scroll state · mobile menu · scroll reveal ·
 *   card spotlight · copy-to-clipboard + toast · table-of-contents scrollspy ·
 *   the scroll-driven career timeline (home page) · cursor ripples on the
 *   hero dot grid.
 *
 * Security notes: no innerHTML / insertAdjacentHTML / document.write is used;
 * all DOM is built with createElement/textContent so the strict CSP
 * (script-src 'self', require-trusted-types-for 'script') holds.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- Helpers ---------- */
  function svgIcon(paths, extraClass) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /* ---------- Theme toggle ---------- */
  var THEME_COLORS = { dark: '#08080a', light: '#fafafa' };

  function currentTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function syncThemeUI() {
    var theme = currentTheme();
    var next = theme === 'light' ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      btn.setAttribute('title', 'Switch to ' + next + ' theme');
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', THEME_COLORS[theme]);
    }
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('theme', theme);
    } catch (e) {
      /* Storage unavailable — theme still applies for this page view. */
    }
    syncThemeUI();
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  });
  syncThemeUI();

  /* ---------- Header scroll state ---------- */
  var header = document.querySelector('[data-header]');

  function updateHeader() {
    if (header) {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    }
  }
  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();

  /* ---------- Mobile menu ---------- */
  var navToggle = document.querySelector('[data-nav-toggle]');
  var mobileMenu = document.getElementById('mobile-menu');

  function isMenuOpen() {
    return !!navToggle && navToggle.getAttribute('aria-expanded') === 'true';
  }

  function setMenu(open) {
    if (!navToggle || !mobileMenu) {
      return;
    }
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mobileMenu.hidden = !open;
  }

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', function () {
      setMenu(!isMenuOpen());
    });
    mobileMenu.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        setMenu(false);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isMenuOpen()) {
        setMenu(false);
        navToggle.focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (isMenuOpen() && !event.target.closest('[data-header]')) {
        setMenu(false);
      }
    });
    var desktopQuery = window.matchMedia('(min-width: 901px)');
    desktopQuery.addEventListener('change', function (mq) {
      if (mq.matches) {
        setMenu(false);
      }
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  /* ---------- Card spotlight (pointer devices only) ---------- */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.spotlight').forEach(function (card) {
      card.addEventListener('pointermove', function (event) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', (event.clientX - rect.left) + 'px');
        card.style.setProperty('--my', (event.clientY - rect.top) + 'px');
      });
    });
  }

  /* ---------- Toast ---------- */
  var toastRegion = null;

  function toast(message) {
    if (!toastRegion) {
      toastRegion = document.createElement('div');
      toastRegion.className = 'toast-region';
      toastRegion.setAttribute('role', 'status');
      toastRegion.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastRegion);
    }
    var item = document.createElement('div');
    item.className = 'toast';
    item.appendChild(svgIcon(['M20 6 9 17l-5-5']));
    var text = document.createElement('span');
    text.textContent = message;
    item.appendChild(text);
    toastRegion.appendChild(item);

    window.setTimeout(function () {
      item.classList.add('is-leaving');
      window.setTimeout(function () {
        item.remove();
      }, 300);
    }, 2400);
  }

  /* ---------- Copy to clipboard ---------- */
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.className = 'sr-only';
      document.body.appendChild(area);
      area.select();
      try {
        if (document.execCommand('copy')) {
          resolve();
        } else {
          reject(new Error('copy failed'));
        }
      } catch (err) {
        reject(err);
      } finally {
        area.remove();
      }
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var value = btn.getAttribute('data-copy') || '';
      copyText(value).then(function () {
        toast(btn.getAttribute('data-copy-message') || 'Copied to clipboard');
      }, function () {
        toast('Couldn’t copy — please copy it manually');
      });
    });
  });

  /* ---------- Table of contents scrollspy ---------- */
  var toc = document.querySelector('[data-toc]');
  if (toc && 'IntersectionObserver' in window) {
    var tocLinks = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var sectionToLink = new Map();
    tocLinks.forEach(function (link) {
      var section = document.getElementById(link.getAttribute('href').slice(1));
      if (section) {
        sectionToLink.set(section, link);
      }
    });
    var visibleSections = new Set();
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          visibleSections.add(entry.target);
        } else {
          visibleSections.delete(entry.target);
        }
      });
      var active = null;
      sectionToLink.forEach(function (link, section) {
        if (!active && visibleSections.has(section)) {
          active = link;
        }
      });
      if (active) {
        tocLinks.forEach(function (link) {
          link.classList.toggle('is-active', link === active);
        });
      }
    }, { rootMargin: '-15% 0px -55% 0px' });
    sectionToLink.forEach(function (link, section) {
      spy.observe(section);
    });
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---------- Career timeline (scroll-driven) ----------
   * Preserved from the original site: each card reveals when it enters the
   * viewport, its node lights up, and the gradient line fills from the first
   * node down to the viewport centre as you scroll.
   */
  var timelineContainer = document.getElementById('timeline-container');
  if (timelineContainer) {
    var staticLine = document.getElementById('static-line');
    var animatedLine = document.getElementById('animated-line');
    var items = timelineContainer.querySelectorAll('.timeline-item');
    var nodes = timelineContainer.querySelectorAll('.timeline-node');
    var currentWindowWidth = window.innerWidth;
    var bounds = { topOffset: 0, totalHeight: 0 };
    var ticking = false;

    if ('IntersectionObserver' in window) {
      var timelineObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('show');
          }
        });
      }, { root: null, rootMargin: '0px 0px -15% 0px', threshold: 0 });
      items.forEach(function (item) {
        timelineObserver.observe(item);
      });
    } else {
      items.forEach(function (item) {
        item.classList.add('show');
      });
    }

    var updateTimelineBounds = function () {
      if (nodes.length < 2) {
        return;
      }
      var firstNode = nodes[0];
      var lastNode = nodes[nodes.length - 1];
      var firstItem = firstNode.closest('.timeline-item');
      var lastItem = lastNode.closest('.timeline-item');

      var topOffset = firstItem.offsetTop + firstNode.offsetTop + (firstNode.offsetHeight / 2);
      var bottomOffset = lastItem.offsetTop + lastNode.offsetTop + (lastNode.offsetHeight / 2);
      var totalHeight = bottomOffset - topOffset;
      bounds = { topOffset: topOffset, totalHeight: totalHeight };

      staticLine.style.top = topOffset + 'px';
      staticLine.style.height = totalHeight + 'px';
      animatedLine.style.top = topOffset + 'px';
      // Pin the gradient to the full track so the line colour matches each company node.
      animatedLine.style.backgroundSize = '100% ' + totalHeight + 'px';
    };

    var handleTimelineScroll = function () {
      if (bounds.totalHeight === 0) {
        return;
      }
      var viewportCenter = window.innerHeight / 2;
      var containerRect = timelineContainer.getBoundingClientRect();
      var trackStartLocation = containerRect.top + bounds.topOffset;
      var scrolledPast = viewportCenter - trackStartLocation;
      var fillHeight = Math.max(0, Math.min(scrolledPast, bounds.totalHeight));
      animatedLine.style.height = fillHeight + 'px';
    };

    var refreshTimeline = function () {
      updateTimelineBounds();
      handleTimelineScroll();
    };

    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          handleTimelineScroll();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    // Only recompute on width changes (mobile URL-bar show/hide changes height).
    window.addEventListener('resize', function () {
      if (window.innerWidth !== currentWindowWidth) {
        currentWindowWidth = window.innerWidth;
        refreshTimeline();
      }
    });

    // Web fonts and images can shift layout after first paint.
    window.addEventListener('load', refreshTimeline);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refreshTimeline);
    }
    refreshTimeline();
  }

  /* ---------- Hero dot grid: cursor water ripples ----------
   * Progressive enhancement for every .dot-grid. The CSS dot pattern is redrawn
   * on a <canvas> (same 28px grid, same --dot colour, same CSS mask) so the
   * dots can react to the pointer: moving the mouse sends out water-like
   * ripples, and as a wave front passes the dots are pushed outward, stretch
   * into short radial dashes and pick up the Google colours (in the spirit of
   * antigravity.google). Clicks and taps send a single, stronger ripple.
   * The frame loop only runs while ripples are alive and the grid is on screen;
   * reduced-motion users keep the static CSS pattern. Pointer coordinates are
   * the only input, and nothing is written to the DOM except the canvas.
   */
  var DOT_GAP = 28;            // keep in sync with .dot-grid background-size
  var DOT_R = 1.15;            // px; matches the 1px radial-gradient dot
  var TAU = Math.PI * 2;
  var RIPPLE_SPEED = 0.36;     // px per ms
  var RIPPLE_LIFE = 2000;      // ms
  var RIPPLE_MAX = 18;
  var RIPPLE_GAP_PX = 42;      // a new ripple every ~42px of pointer travel…
  var RIPPLE_GAP_MS = 70;      // …but never more often than this
  var WAVE_K = TAU / 64;       // crest/trough spacing of each ring (64px)
  var PUSH = 7;                // px of outward displacement at full strength
  var LENS_R = 90;             // px; soft glow that follows the pointer
  var GOOGLE_RGB = [[66, 133, 244], [234, 67, 53], [251, 188, 5], [52, 168, 83]];

  function parseRgba(value, fallback) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)/.exec(value || '');
    if (!m) {
      return fallback;
    }
    var alpha = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), Math.min(1, alpha)];
  }

  function googleColorAt(turn) {
    var n = GOOGLE_RGB.length;
    var x = (turn - Math.floor(turn)) * n;
    var i = Math.floor(x);
    var f = x - i;
    var a = GOOGLE_RGB[i % n];
    var b = GOOGLE_RGB[(i + 1) % n];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function initDotRipples(host) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    canvas.className = 'dot-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    host.classList.add('is-live');

    var width = 1;
    var height = 1;
    var dpr = 1;
    var cols = 0;
    var rows = 0;
    var dotColor = [255, 255, 255, 0.075];
    var ripples = [];
    var rafId = 0;
    var onScreen = true;
    var pointer = { x: 0, y: 0, t: -1e9 };
    var lastMove = { x: 0, y: 0, t: -1e9 };
    var lastEmit = { x: -1e9, y: -1e9, t: -1e9 };

    function readColor() {
      dotColor = parseRgba(window.getComputedStyle(host).getPropertyValue('--dot'), dotColor);
    }

    function render(now, lens) {
      var count = ripples.length;
      var rx = [];
      var ry = [];
      var front = [];
      var amp = [];
      var reach = [];
      var inv = [];
      var k;
      for (k = 0; k < count; k++) {
        var rp = ripples[k];
        var age = now - rp.t;
        var life = 1 - age / RIPPLE_LIFE;
        var sigma = 22 + age * 0.012; // each ring softens as it spreads
        rx.push(rp.x);
        ry.push(rp.y);
        front.push(age * RIPPLE_SPEED);
        amp.push(rp.s * life * Math.sqrt(life) * Math.min(1, age / 90));
        reach.push(sigma * 3);
        inv.push(1 / (2 * sigma * sigma));
      }
      var lensOn = lens > 0.02;
      var lensCut = LENS_R * LENS_R * 6.25;
      var lensInv = 1 / (2 * LENS_R * LENS_R);
      var half = DOT_GAP / 2;
      var excited = [];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (var j = 0; j < rows; j++) {
        var y0 = j * DOT_GAP + half;
        for (var i = 0; i < cols; i++) {
          var x0 = i * DOT_GAP + half;
          var dx = 0;
          var dy = 0;
          var energy = 0;
          var cx = 0;
          var cy = 0;
          for (k = 0; k < count; k++) {
            var ex = x0 - rx[k];
            var ey = y0 - ry[k];
            var dist = Math.sqrt(ex * ex + ey * ey) + 0.001;
            var off = dist - front[k];
            if (off > reach[k] || off < -reach[k]) {
              continue;
            }
            var wave = Math.cos(off * WAVE_K) * Math.exp(-off * off * inv[k]) * amp[k];
            var nx = ex / dist;
            var ny = ey / dist;
            dx += nx * wave;
            dy += ny * wave;
            if (wave > 0) {
              energy += wave;
              cx += nx * wave;
              cy += ny * wave;
            }
          }
          if (lensOn) {
            var lx = x0 - pointer.x;
            var ly = y0 - pointer.y;
            var l2 = lx * lx + ly * ly;
            if (l2 < lensCut) {
              var glow = lens * 0.5 * Math.exp(-l2 * lensInv);
              var lm = Math.sqrt(l2) + 0.001;
              energy += glow;
              cx += (lx / lm) * glow;
              cy += (ly / lm) * glow;
            }
          }
          var px = x0 + dx * PUSH;
          var py = y0 + dy * PUSH;
          if (energy < 0.04) {
            ctx.moveTo(px + DOT_R, py);
            ctx.arc(px, py, DOT_R, 0, TAU);
          } else {
            excited.push(px, py, cx, cy, energy > 1 ? 1 : energy);
          }
        }
      }
      ctx.fillStyle = 'rgba(' + dotColor[0] + ',' + dotColor[1] + ',' + dotColor[2] + ',' + dotColor[3] + ')';
      ctx.fill();

      if (!excited.length) {
        return;
      }
      var spin = now * 0.00004; // colours drift slowly around each ring
      ctx.lineCap = 'round';
      for (var e = 0; e < excited.length; e += 5) {
        var vx = excited[e + 2];
        var vy = excited[e + 3];
        var en = excited[e + 4];
        var vm = Math.sqrt(vx * vx + vy * vy) || 1;
        vx /= vm;
        vy /= vm;
        var tint = googleColorAt(Math.atan2(vy, vx) / TAU + 0.5 + spin);
        var mix = Math.min(1, en * 1.6);
        var reachLen = (1.5 + en * 9) / 2;
        ctx.strokeStyle = 'rgba(' +
          Math.round(dotColor[0] + (tint[0] - dotColor[0]) * mix) + ',' +
          Math.round(dotColor[1] + (tint[1] - dotColor[1]) * mix) + ',' +
          Math.round(dotColor[2] + (tint[2] - dotColor[2]) * mix) + ',' +
          (dotColor[3] + (0.95 - dotColor[3]) * en).toFixed(3) + ')';
        ctx.lineWidth = 1.7 + en * 1.3;
        ctx.beginPath();
        ctx.moveTo(excited[e] - vx * reachLen, excited[e + 1] - vy * reachLen);
        ctx.lineTo(excited[e] + vx * reachLen, excited[e + 1] + vy * reachLen);
        ctx.stroke();
      }
    }

    function frame(now) {
      rafId = 0;
      while (ripples.length && now - ripples[0].t > RIPPLE_LIFE) {
        ripples.shift();
      }
      var lens = Math.exp(-(now - pointer.t) / 450);
      if (!ripples.length && lens < 0.02) {
        render(now, 0); // settle back to the plain grid and stop
        return;
      }
      render(now, lens);
      rafId = window.requestAnimationFrame(frame);
    }

    function start() {
      if (!rafId && onScreen) {
        rafId = window.requestAnimationFrame(frame);
      }
    }

    function stop() {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function resize() {
      var rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      cols = Math.ceil(width / DOT_GAP);
      rows = Math.ceil(height / DOT_GAP);
      render(window.performance.now(), 0);
      if (ripples.length) {
        start();
      }
    }

    function localPoint(e) {
      var rect = host.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return null;
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function emit(x, y, strength, now) {
      ripples.push({ x: x, y: y, t: now, s: strength });
      if (ripples.length > RIPPLE_MAX) {
        ripples.shift();
      }
      lastEmit.x = x;
      lastEmit.y = y;
      lastEmit.t = now;
    }

    window.addEventListener('pointermove', function (e) {
      if (!onScreen || reduceMotion.matches || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) {
        return;
      }
      var p = localPoint(e);
      if (!p) {
        return;
      }
      var now = window.performance.now();
      var step = Math.sqrt((p.x - lastMove.x) * (p.x - lastMove.x) + (p.y - lastMove.y) * (p.y - lastMove.y));
      var speed = step / Math.max(8, now - lastMove.t); // px per ms
      lastMove.x = p.x;
      lastMove.y = p.y;
      lastMove.t = now;
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.t = now;
      var ex = p.x - lastEmit.x;
      var ey = p.y - lastEmit.y;
      if (ex * ex + ey * ey >= RIPPLE_GAP_PX * RIPPLE_GAP_PX && now - lastEmit.t >= RIPPLE_GAP_MS) {
        emit(p.x, p.y, Math.min(1, 0.3 + speed * 0.5), now);
      }
      start();
    }, { passive: true });

    window.addEventListener('pointerdown', function (e) {
      if (!onScreen || reduceMotion.matches || !e.isPrimary) {
        return;
      }
      var p = localPoint(e);
      if (p) {
        emit(p.x, p.y, 1, window.performance.now());
        start();
      }
    }, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (!onScreen) {
          stop();
          ripples.length = 0;
          render(window.performance.now(), 0);
        }
      }).observe(host);
    }

    // Re-read the dot colour when the theme toggle flips data-theme.
    new MutationObserver(function () {
      readColor();
      if (!rafId) {
        render(window.performance.now(), 0);
      }
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    readColor();
    resize();
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(host);
    } else {
      window.addEventListener('resize', resize);
    }
  }

  if (!reduceMotion.matches) {
    Array.prototype.forEach.call(document.querySelectorAll('.dot-grid'), initDotRipples);
  }

  /* Small shared API for page-specific scripts (e.g. ai.js). */
  window.AM = Object.freeze({ toast: toast, svgIcon: svgIcon, copyText: copyText });
})();
