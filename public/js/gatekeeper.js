/**
 * Gatekeeper — App Availability Controller
 * 
 * Rules:
 *  1. App is available from Sept 1, 2026 to Sept 30, 2026 (inclusive)
 *  2. App is NOT available on Sundays (day 0)
 *  3. Before Sept 1 or after Sept 30 → "This game has been deleted" block
 *  4. Each day (within the valid window), show a meme modal ONCE per day
 *     with a random image from /memes/ folder
 */

const Gatekeeper = (() => {
  const APP_START = new Date(2026, 7, 31);  // Aug 31, 2026 (available today)
  const SEPT_1    = new Date(2026, 8, 1);   // Sept 1 — Day 1 of the meme countdown
  const APP_END   = new Date(2026, 8, 30, 23, 59, 59); // Sept 30, 2026 end of day
  const MEME_SHOWN_KEY = 'housie-meme-shown-date';

  // Known meme filenames — updated dynamically via /api/memes or manually listed
  // The server endpoint will return the list of files in /public/memes/
  let memeFiles = [];

  function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isSunday() {
    return new Date().getDay() === 0;
  }

  function isWithinValidPeriod() {
    const now = new Date();
    return now >= APP_START && now <= APP_END;
  }

  function isBeforeStart() {
    return new Date() < APP_START;
  }

  function createBlockOverlay(emoji, title, subtitle, extraClass) {
    const overlay = document.createElement('div');
    overlay.className = 'gatekeeper-block ' + (extraClass || '');
    overlay.innerHTML = `
      <div class="gk-block-card">
        <div class="gk-block-emoji">${emoji}</div>
        <h1 class="gk-block-title">${title}</h1>
        <p class="gk-block-subtitle">${subtitle}</p>
        <div class="gk-block-decor">
          <div class="gk-floating-shape s1"></div>
          <div class="gk-floating-shape s2"></div>
          <div class="gk-floating-shape s3"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    // Hide the main app
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    return overlay;
  }

  function createMemeModal(imageSrc) {
    const overlay = document.createElement('div');
    overlay.className = 'gk-meme-overlay';
    overlay.id = 'gk-meme-overlay';

    // Calculate day number (Sept 1 = Day 1)
    const now = new Date();
    const diffMs = now - SEPT_1;
    const dayNum = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
    const daysLeft = 30 - dayNum;

    overlay.innerHTML = `
      <div class="gk-meme-modal">
        <div class="gk-meme-header">
          <span class="gk-meme-day">Day ${dayNum} of 30</span>
          <span class="gk-meme-countdown">${daysLeft} day${daysLeft !== 1 ? 's' : ''} left ⏳</span>
        </div>
        <div class="gk-meme-image-wrap">
          <img class="gk-meme-image" src="${imageSrc}" alt="Meme of the day" />
        </div>
        <button class="gk-meme-dismiss" id="gk-meme-dismiss">
          <span>Let's Play! 🎲</span>
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });

    // Dismiss handler
    const dismissBtn = document.getElementById('gk-meme-dismiss');
    dismissBtn.addEventListener('click', () => {
      overlay.classList.remove('visible');
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 400);
    });

    // Also dismiss by clicking outside the modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        dismissBtn.click();
      }
    });

    // Mark as shown for today
    localStorage.setItem(MEME_SHOWN_KEY, getTodayString());
  }

  function hasMemeBeenShownToday() {
    return localStorage.getItem(MEME_SHOWN_KEY) === getTodayString();
  }

  async function fetchMemeList() {
    try {
      const res = await fetch('/api/memes');
      if (res.ok) {
        const data = await res.json();
        memeFiles = data.memes || [];
      }
    } catch (e) {
      console.warn('Could not load meme list:', e);
    }
  }

  function getRandomMeme() {
    if (memeFiles.length === 0) return null;
    // Use today's date as a seed for consistent random per day
    const today = getTodayString();
    let hash = 0;
    for (let i = 0; i < today.length; i++) {
      hash = ((hash << 5) - hash) + today.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % memeFiles.length;
    return '/memes/' + memeFiles[index];
  }

  /**
   * Main init — called before the app boots.
   * Returns true if the app should proceed, false if blocked.
   */
  async function init() {
    // Block: before start date
    if (isBeforeStart()) {
      createBlockOverlay(
        '🚧',
        'Coming Soon!',
        'Housie opens on September 1st. See you then!',
        'gk-coming-soon'
      );
      return false;
    }

    // Block: after end date (game deleted)
    if (!isWithinValidPeriod()) {
      createBlockOverlay(
        '🗑️',
        'This Game Has Been Deleted',
        'Housie was available from Sept 1–30, 2026. It\'s over now. Thanks for playing!',
        'gk-expired'
      );
      return false;
    }

    // Block: Sunday
    if (isSunday()) {
      createBlockOverlay(
        '🛋️',
        'Sunday Closed',
        'Take a break! Housie is closed on Sundays. Come back tomorrow!',
        'gk-sunday'
      );
      return false;
    }

    // Show daily meme modal (once per day, only from Sept 1 onwards)
    const now = new Date();
    if (now >= SEPT_1 && !hasMemeBeenShownToday()) {
      await fetchMemeList();
      const meme = getRandomMeme();
      if (meme) {
        createMemeModal(meme);
      }
    }

    return true;
  }

  return { init };
})();
