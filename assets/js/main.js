/*
 * Shared interactions for every page:
 *   theme toggle · header scroll state · mobile menu · scroll reveal ·
 *   card spotlight · copy-to-clipboard + toast · table-of-contents scrollspy ·
 *   the scroll-driven career timeline (home page).
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

  /* Small shared API for page-specific scripts (e.g. ai.js). */
  window.AM = Object.freeze({ toast: toast, svgIcon: svgIcon, copyText: copyText });
})();
