/**
 * UI Helpers — Toasts, Animations, Modals, Confetti
 */

const UI = (() => {
  const AVATAR_COLORS = [
    '#ff6b35', '#4ecdc4', '#ffc107', '#e91e63', '#9c27b0',
    '#4caf50', '#2196f3', '#ff9800', '#00bcd4', '#8bc34a',
    '#f44336', '#3f51b5', '#795548', '#607d8b', '#cddc39',
  ];

  /**
   * Show a toast notification.
   */
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Show prize announcement overlay.
   */
  function showPrizeAnnouncement(message, duration = 3000) {
    const overlay = document.getElementById('prize-overlay');
    const text = document.getElementById('prize-text');
    text.textContent = message;
    overlay.classList.add('active');

    // Celebration!
    launchConfetti();
    playWinSound();

    setTimeout(() => {
      overlay.classList.remove('active');
    }, duration);
  }

  /**
   * Play a victory fanfare using Web Audio API.
   */
  function playWinSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      const noteDuration = 0.15;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'triangle';
        osc.frequency.value = freq;

        const start = ctx.currentTime + i * noteDuration;
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + noteDuration * 2);

        osc.start(start);
        osc.stop(start + noteDuration * 2);
      });
    } catch (e) {
      // Audio not available
    }
  }

  /**
   * Launch confetti animation.
   */
  function launchConfetti(count = 50) {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';

    const colors = ['#ff6b35', '#4ecdc4', '#ffc107', '#e91e63', '#4caf50', '#2196f3', '#ff9800', '#f44336'];
    const shapes = ['square', 'circle'];

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const size = 6 + Math.random() * 10;
      const left = Math.random() * 100;
      const delay = Math.random() * 1.5;
      const duration = 2 + Math.random() * 2;

      piece.style.cssText = `
        left: ${left}%;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: ${shape === 'circle' ? '50%' : '2px'};
        animation-duration: ${duration}s;
        animation-delay: ${delay}s;
      `;

      container.appendChild(piece);
    }

    // Cleanup after animation
    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  }

  /**
   * Get a consistent color for a player based on their name.
   */
  function getPlayerColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  /**
   * Get player initial(s).
   */
  function getPlayerInitial(name) {
    return name.charAt(0).toUpperCase();
  }

  /**
   * Render player list in lobby.
   */
  function renderPlayerList(players) {
    const list = document.getElementById('players-list');
    const badge = document.getElementById('player-count-badge');

    list.innerHTML = '';
    badge.textContent = players.length;

    players.forEach((player) => {
      const color = getPlayerColor(player.name);
      const initial = getPlayerInitial(player.name);
      const item = document.createElement('div');
      item.className = 'player-item';
      item.innerHTML = `
        <div class="player-avatar" style="background: ${color}">${initial}</div>
        <span class="player-name">${escapeHtml(player.name)}</span>
        ${player.isHost ? '<span class="player-host-badge">Host</span>' : ''}
      `;
      list.appendChild(item);
    });
  }

  /**
   * Render player ribbon in game screen.
   * players: array sorted by server (most marked first)
   * currentPlayerId: this client's socket id to highlight "you"
   */
  function renderPlayersRibbon(players, currentPlayerId) {
    const ribbon = document.getElementById('players-ribbon');
    ribbon.innerHTML = '';

    // Update count badge
    const countEl = document.getElementById('players-count-num');
    if (countEl) countEl.textContent = players.length;

    players.forEach((player, idx) => {
      const color = getPlayerColor(player.name);
      const initial = getPlayerInitial(player.name);
      const isMe = player.id === currentPlayerId;
      const isLeading = idx === 0 && (player.ticketCounts || []).some(c => c > 0);

      // Build ticket count badges
      let countBadges = '';
      if (player.ticketCounts && player.ticketCounts.length > 0) {
        countBadges = player.ticketCounts.map((marked, ti) => {
          const remaining = 15 - marked;
          const isTopTicket = marked === Math.max(...player.ticketCounts);
          return `<span class="ribbon-count-badge${isLeading && isTopTicket ? ' leading' : ''}">T${ti + 1}: ${remaining} left</span>`;
        }).join('');
      }

      const el = document.createElement('div');
      el.className = 'ribbon-player';
      el.title = player.name;

      el.innerHTML = `
        <div class="ribbon-avatar" style="background:${color};${isMe ? 'box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(255,255,255,0.3);' : ''}">${initial}</div>
        <span class="ribbon-name">${escapeHtml(player.name)}</span>
        ${countBadges ? `<div class="ribbon-counts">${countBadges}</div>` : ''}
      `;
      ribbon.appendChild(el);
    });
  }

  /**
   * Generate the 1-90 number board.
   */
  function generateNumberBoard() {
    const board = document.getElementById('number-board');
    board.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
      const cell = document.createElement('div');
      cell.className = 'board-num';
      cell.id = `board-${i}`;
      cell.textContent = i;
      board.appendChild(cell);
    }
  }

  /**
   * Update the number board with called numbers.
   */
  function updateNumberBoard(drawnNumbers) {
    // Reset all
    document.querySelectorAll('.board-num').forEach((el) => {
      el.classList.remove('called');
    });

    drawnNumbers.forEach((n) => {
      const el = document.getElementById(`board-${n}`);
      if (el) el.classList.add('called');
    });
  }

  /**
   * Escape HTML to prevent XSS.
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Copy text to clipboard.
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Room code copied!', 'success', 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast('Room code copied!', 'success', 2000);
    }
  }

  /**
   * Update the recent balls strip (last 7 numbers).
   */
  function updateRecentBalls(drawnNumbers) {
    const container = document.getElementById('recent-balls');
    if (!container) return;

    const last7 = drawnNumbers.slice(-7).reverse();
    container.innerHTML = '';

    last7.forEach((n, i) => {
      const ball = document.createElement('div');
      ball.className = 'recent-ball';
      ball.textContent = n;
      // Only fade the oldest ball (last/rightmost)
      if (i === last7.length - 1 && last7.length > 1) {
        ball.style.opacity = '0.35';
        ball.style.transform = 'scale(0.8)';
      }
      container.appendChild(ball);
    });

    // GSAP strip animation
    if (typeof Motion !== 'undefined') {
      Motion.animateRecentBallStrip(container);
    }
  }

  return {
    showToast,
    showPrizeAnnouncement,
    launchConfetti,
    getPlayerColor,
    getPlayerInitial,
    renderPlayerList,
    renderPlayersRibbon,
    generateNumberBoard,
    updateNumberBoard,
    updateRecentBalls,
    escapeHtml,
    copyToClipboard,
  };
})();
