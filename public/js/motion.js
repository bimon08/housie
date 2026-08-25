/**
 * Motion — GSAP-powered animations for Housie
 */
const Motion = (() => {

  /**
   * Animate the big number ball when a new number is drawn.
   * Uses a punch/bounce effect that keeps the ball visible at all times.
   */
  function animateNumberBall(el) {
    if (!el || !gsap) return;

    // Quick punch-out then bounce back — ball never fully disappears
    const tl = gsap.timeline();
    tl.to(el, { scale: 0.3, opacity: 0.4, rotation: -20, duration: 0.12, ease: 'power2.in' })
      .to(el, { scale: 1.15, opacity: 1, rotation: 5, duration: 0.3, ease: 'back.out(2.5)' })
      .to(el, { scale: 1, rotation: 0, duration: 0.2, ease: 'power2.out' });
  }

  /**
   * Animate a new recent ball popping in.
   */
  function animateRecentBall(el) {
    if (!el || !gsap) return;
    gsap.fromTo(el,
      { scale: 0, opacity: 0, y: -10 },
      { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' }
    );
  }

  /**
   * Animate all recent balls shifting — old ones fade/shrink, new one pops.
   */
  function animateRecentBallStrip(container) {
    if (!container || !gsap) return;
    const balls = container.querySelectorAll('.recent-ball');
    balls.forEach((ball, i) => {
      if (i === 0) {
        // Newest ball — pop in
        gsap.fromTo(ball,
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2.5)', delay: 0.05 }
        );
      } else {
        // Older balls — slide right
        gsap.fromTo(ball,
          { x: -24 },
          { x: 0, duration: 0.3, ease: 'power2.out' }
        );
      }
    });
  }

  /**
   * Animate a ticket cell being marked (stamped).
   */
  function animateMark(cell) {
    if (!cell || !gsap) return;
    gsap.fromTo(cell,
      { scale: 1.4, rotation: 10 },
      { scale: 1, rotation: 0, duration: 0.35, ease: 'elastic.out(1, 0.5)' }
    );
  }

  /**
   * Shake animation for wrong tap.
   */
  function animateShake(cell) {
    if (!cell || !gsap) return;
    gsap.to(cell, {
      x: -4, duration: 0.05, yoyo: true, repeat: 5,
      ease: 'power1.inOut',
      onComplete: () => gsap.set(cell, { x: 0 })
    });
  }

  /**
   * Animate players panel expand/collapse.
   */
  function animatePanel(panel, expanding) {
    if (!panel || !gsap) return;
    gsap.to(panel, {
      width: expanding ? 120 : 56,
      duration: 0.3,
      ease: 'power2.inOut'
    });
  }

  /**
   * Animate prize claim success — pulse + glow.
   */
  function animateClaim(el) {
    if (!el || !gsap) return;
    gsap.fromTo(el,
      { scale: 0.8, opacity: 0, y: 20 },
      { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.5)' }
    );
  }

  /**
   * Screen transition — fade + slide in.
   */
  function animateScreenIn(screen) {
    if (!screen || !gsap) return;
    gsap.fromTo(screen,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }
    );
  }

  /**
   * Staggered entrance for a list of elements.
   */
  function animateStagger(elements, opts = {}) {
    if (!elements || !gsap) return;
    gsap.fromTo(elements,
      { opacity: 0, y: 15, scale: 0.95 },
      { 
        opacity: 1, y: 0, scale: 1,
        duration: opts.duration || 0.3,
        stagger: opts.stagger || 0.05,
        ease: opts.ease || 'power2.out'
      }
    );
  }

  /**
   * Pulse an element (for attention).
   */
  function pulse(el) {
    if (!el || !gsap) return;
    gsap.fromTo(el,
      { scale: 1 },
      { scale: 1.1, duration: 0.15, yoyo: true, repeat: 1, ease: 'power1.inOut' }
    );
  }

  return {
    animateNumberBall,
    animateRecentBall,
    animateRecentBallStrip,
    animateMark,
    animateShake,
    animatePanel,
    animateClaim,
    animateScreenIn,
    animateStagger,
    pulse,
  };
})();
