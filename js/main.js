/**
 * DeFi Analysis — Interactions
 * Subtle, restrained animations for a consulting-report aesthetic.
 */
(function () {
  'use strict';

  /* ============================================================
     SCROLL REVEAL — Intersection Observer
     ============================================================ */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal--visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -20px 0px' });

  document.querySelectorAll('.section, .figures, .eco-item, .pathway__step').forEach(function (el) {
    el.classList.add('reveal');
    revealObserver.observe(el);
  });

  /* ============================================================
     FIGURE COUNTERS — Animate on scroll
     ============================================================ */
  function animateFigure(el) {
    var target = parseFloat(el.getAttribute('data-target'));
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var isInteger = target >= 10 || Number.isInteger(target);
    var duration = 1800;
    var startTime = null;

    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var value = target * eased;

      if (isInteger) {
        el.textContent = prefix + Math.floor(value).toLocaleString() + suffix;
      } else {
        el.textContent = prefix + value.toFixed(1) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = prefix + (isInteger ? target.toLocaleString() : target.toFixed(1)) + suffix;
      }
    }
    requestAnimationFrame(step);
  }

  var figureObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var valueEl = entry.target.querySelector('.figure__value');
        if (valueEl) animateFigure(valueEl);
        figureObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('.figure').forEach(function (fig) {
    figureObserver.observe(fig);
  });

  /* ============================================================
     MOBILE NAVIGATION
     ============================================================ */
  var toggle = document.querySelector('.masthead__toggle');
  var nav = document.querySelector('.masthead__nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('masthead__nav--open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    nav.querySelectorAll('.masthead__link').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('masthead__nav--open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ============================================================
     MASTHEAD SCROLL STATE
     ============================================================ */
  var masthead = document.querySelector('.masthead');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 10) {
      masthead.classList.add('masthead--scrolled');
    } else {
      masthead.classList.remove('masthead--scrolled');
    }
  });

})();
