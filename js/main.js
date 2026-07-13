/**
 * DEFI EXPLORER — Main JavaScript
 * Network visualization, scroll animations, and interactivity
 */
(function () {
  'use strict';

  /* ============================================================
     NETWORK VISUALIZATION (Hero Canvas)
     ============================================================ */
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let nodes = [];
  let animationId;
  let mouseX = 0;
  let mouseY = 0;

  const NODE_COUNT = 80;
  const CONNECTION_DIST = 140;
  const NODE_RADIUS = 2.5;
  const MOUSE_RADIUS = 180;

  function resize() {
    width = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    height = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    width = canvas.offsetWidth;
    height = canvas.offsetHeight;
  }

  function createNodes() {
    nodes = Array.from({ length: NODE_COUNT }, function () {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 1.5 + NODE_RADIUS,
        pulse: Math.random() * Math.PI * 2
      };
    });
  }

  function drawNode(node, alpha) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 245, 160, ' + alpha + ')';
    ctx.fill();

    // Glow
    var glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 4);
    glow.addColorStop(0, 'rgba(0, 245, 160, ' + (alpha * 0.6) + ')');
    glow.addColorStop(1, 'rgba(0, 245, 160, 0)');
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius * 4, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  function drawConnection(a, b, alpha) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(0, 245, 160, ' + alpha + ')';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      // Move
      node.x += node.vx;
      node.y += node.vy;

      // Bounce off edges
      if (node.x < 0) { node.x = 0; node.vx *= -1; }
      if (node.x > width) { node.x = width; node.vx *= -1; }
      if (node.y < 0) { node.y = 0; node.vy *= -1; }
      if (node.y > height) { node.y = height; node.vy *= -1; }

      // Mouse interaction
      var dx = mouseX - node.x;
      var dy = mouseY - node.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        var force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
        node.vx -= (dx / dist) * force * 0.3;
        node.vy -= (dy / dist) * force * 0.3;
      }

      // Damping
      node.vx *= 0.995;
      node.vy *= 0.995;

      // Pulse
      node.pulse += 0.02;
      var alpha = 0.4 + Math.sin(node.pulse) * 0.3;
      drawNode(node, alpha);

      // Connections
      for (var j = i + 1; j < nodes.length; j++) {
        var other = nodes[j];
        var cdx = node.x - other.x;
        var cdy = node.y - other.y;
        var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (cdist < CONNECTION_DIST) {
          var calpha = (1 - cdist / CONNECTION_DIST) * 0.15;
          drawConnection(node, other, calpha);
        }
      }
    }

    animationId = requestAnimationFrame(animate);
  }

  function handleMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  }

  resize();
  createNodes();
  animate();

  window.addEventListener('resize', function () {
    resize();
    createNodes();
  });
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('touchmove', function (e) {
    var touch = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    mouseX = touch.clientX - rect.left;
    mouseY = touch.clientY - rect.top;
  }, { passive: true });

  /* ============================================================
     SCROLL ANIMATIONS (Intersection Observer)
     ============================================================ */
  var observerOptions = {
    threshold: 0.15,
    rootMargin: '0px 0px -40px 0px'
  };

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in--visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe section headers
  document.querySelectorAll('.section__header').forEach(function (el) {
    el.classList.add('animate-in');
    observer.observe(el);
  });

  // Observe cards with stagger
  var staggerObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry, index) {
      if (entry.isIntersecting) {
        setTimeout(function () {
          entry.target.classList.add('stagger-child--visible');
        }, index * 80);
        staggerObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -20px 0px' });

  document.querySelectorAll('.eco-card, .step, .card--bordered, .card--success, .card--danger').forEach(function (el) {
    el.classList.add('stagger-child');
    staggerObserver.observe(el);
  });

  /* ============================================================
     STAT COUNTER ANIMATION
     ============================================================ */
  function animateValue(el, target, suffix) {
    var start = 0;
    var duration = 2000;
    var startTime = null;

    function update(currentTime) {
      if (!startTime) startTime = currentTime;
      var elapsed = currentTime - startTime;
      var progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = target * eased;

      if (target >= 10) {
        el.textContent = (suffix || '') + Math.floor(current).toLocaleString();
      } else {
        el.textContent = (suffix || '') + current.toFixed(1);
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = (suffix || '') + (target >= 10 ? target.toLocaleString() : target.toFixed(1));
      }
    }

    requestAnimationFrame(update);
  }

  var statObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var statValues = entry.target.querySelectorAll('.hero__stat-value');
        statValues.forEach(function (el) {
          var target = parseFloat(el.getAttribute('data-count'));
          var prefix = '';
          if (target > 10) prefix = '$';
          animateValue(el, target, prefix);
        });
        statObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  var statsEl = document.querySelector('.hero__stats');
  if (statsEl) statObserver.observe(statsEl);

  /* ============================================================
     MOBILE NAVIGATION
     ============================================================ */
  var mobileToggle = document.querySelector('.nav__mobile-toggle');
  var navLinks = document.querySelector('.nav__links');
  var navLinkItems = document.querySelectorAll('.nav__link');

  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('nav__links--open');
      mobileToggle.setAttribute('aria-expanded', isOpen);
    });

    navLinkItems.forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('nav__links--open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ============================================================
     NAV SCROLL STATE
     ============================================================ */
  var nav = document.querySelector('.nav');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 20) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
  });

  /* ============================================================
     ECOSYSTEM CARD MOUSE TRACKING
     ============================================================ */
  document.querySelectorAll('.eco-card').forEach(function (card) {
    card.addEventListener('mousemove', function (e) {
      var rect = card.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--mouse-x', x + '%');
      card.style.setProperty('--mouse-y', y + '%');
    });
  });

})();
