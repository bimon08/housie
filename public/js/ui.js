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
   * Celebrate prize claim (no big modal, celebration via side YESSS! and confetti).
   */
  function showPrizeAnnouncement(message, duration = 3000) {
    // No full-screen blocking modal — celebrate unobtrusively
    launchConfetti();
    playWinSound();
  }

  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * Play a soft, subtle haptic-like UI click sound.
   */
  function playClickSound() {
    if (sfxVolume === 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, now);
      osc.frequency.exponentialRampToValueAtTime(550, now + 0.025);

      gain.gain.setValueAtTime(0.05 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

      osc.start(now);
      osc.stop(now + 0.028);
    } catch (e) {}
  }

  /**
   * Play a soft, pleasant bubble pop when marking a number.
   */
  function playStampSound() {
    if (sfxVolume === 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.04);

      gain.gain.setValueAtTime(0.08 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  /**
   * Play a gentle soft thump on invalid tap.
   */
  function playErrorSound() {
    if (sfxVolume === 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.04);

      gain.gain.setValueAtTime(0.04 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  /**
   * Play a pleasant victory chime using Web Audio API.
   */
  function playWinSound() {
    if (sfxVolume === 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      const noteDuration = 0.12;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.value = freq;

        const start = ctx.currentTime + i * noteDuration;
        gain.gain.setValueAtTime(0.08 * sfxVolume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration * 1.5);

        osc.start(start);
        osc.stop(start + noteDuration * 1.5);
      });
    } catch (e) {}
  }

  /**
   * Play countdown beep from 8 down to 0 before starting.
   */
  function playCountdownTick(seconds) {
    if (sfxVolume === 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (seconds === 0) {
        // "GO / START" bright chord (C6 + E6)
        [1046.5, 1318.5].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now);

          gain.gain.setValueAtTime(0.09 * sfxVolume, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

          osc.start(now);
          osc.stop(now + 0.36);
        });
      } else {
        // Progressive tone as countdown nears 1
        let freq = 580;
        let vol = 0.05;
        if (seconds === 3) { freq = 740; vol = 0.06; }
        else if (seconds === 2) { freq = 880; vol = 0.07; }
        else if (seconds === 1) { freq = 1046; vol = 0.08; }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.9, now + 0.06);

        gain.gain.setValueAtTime(vol * sfxVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

        osc.start(now);
        osc.stop(now + 0.07);
      }
    } catch (e) {}
  }

  // Global delegation for instant click sound across every interactive element
  document.addEventListener('click', (e) => {
    const clickable = e.target.closest('button, .btn, .btn-icon, .sidebar-toggle-handle, .room-badge-pill, .counter-badge-wrap, input[type="radio"], [role="button"]');
    if (clickable) {
      playClickSound();
    }
  }, { passive: true });

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
    if (!ribbon) return;
    ribbon.innerHTML = '';

    // Update count badge
    const countEl = document.getElementById('players-count-num');
    if (countEl) countEl.textContent = players.length;

    // Set to track players who have clicked Yess!! / claimed
    if (!window._yessClaimedPlayers) window._yessClaimedPlayers = new Set();
    if (!window._shownYessPopups) window._shownYessPopups = new Set();

    // Sort players: Yess winners FIRST, then by closest to winning (most marked)
    const sortedPlayers = [...players].sort((a, b) => {
      const aYess = !!a.hasClaimedYess || 
                    window._yessClaimedPlayers.has(a.id) || 
                    window._yessClaimedPlayers.has(a.name);
      const bYess = !!b.hasClaimedYess || 
                    window._yessClaimedPlayers.has(b.id) || 
                    window._yessClaimedPlayers.has(b.name);
      if (aYess && !bYess) return -1;
      if (!aYess && bYess) return 1;

      const aMax = (a.ticketCounts && a.ticketCounts.length) ? Math.max(...a.ticketCounts) : (a.bestMarked || 0);
      const bMax = (b.ticketCounts && b.ticketCounts.length) ? Math.max(...b.ticketCounts) : (b.bestMarked || 0);
      return bMax - aMax;
    });

    sortedPlayers.forEach((player, idx) => {
      const color = getPlayerColor(player.name);
      const initial = getPlayerInitial(player.name);
      const isMe = player.id === currentPlayerId;
      const serialNum = idx + 1;
      const isYessClaimed = !!player.hasClaimedYess || 
                            window._yessClaimedPlayers.has(player.id) || 
                            window._yessClaimedPlayers.has(player.name);

      const hasOneLeft = !isYessClaimed && (player.ticketCounts || []).some(m => (15 - m) === 1);

      // Build ticket count badges (only shown if player has NOT clicked Yess)
      let countBadges = '';
      if (!isYessClaimed && player.ticketCounts && player.ticketCounts.length > 0) {
        countBadges = player.ticketCounts.map((marked, ti) => {
          const remaining = 15 - marked;
          const isOneLeft = remaining === 1;
          
          let badgeClass = 'ribbon-count-badge';
          if (isOneLeft) badgeClass += ' one-left';
          
          return `<span class="${badgeClass}">T${ti + 1}: <strong>${remaining}</strong> left${isOneLeft ? ' 🔥' : ''}</span>`;
        }).join('');
      }

      const el = document.createElement('div');
      el.className = `ribbon-player ${isMe ? 'is-me' : ''} ${isYessClaimed ? 'is-yess-winner' : ''} ${hasOneLeft ? 'has-one-left' : ''}`;
      el.dataset.playerIndex = idx;
      el.title = `#${serialNum} ${player.name}${isMe ? ' (You)' : ''}`;

      el.innerHTML = `
        <div class="ribbon-avatar-wrap">
          <div class="ribbon-avatar" style="background:${color};">${initial}</div>
        </div>
        <div class="ribbon-player-details">
          <div class="ribbon-name-row">
            <span class="ribbon-serial-num">#${serialNum}</span>
            <span class="ribbon-name">${escapeHtml(player.name)}</span>
            ${isMe ? '<span class="ribbon-you-tag">YOU</span>' : ''}
          </div>
          ${isYessClaimed ? 
            `<div class="ribbon-yess-claimed-tag">YESSS!! 🎉</div>` : 
            (countBadges ? `<div class="ribbon-counts">${countBadges}</div>` : '')}
        </div>
      `;
      ribbon.appendChild(el);

      // Trigger the one-time floating YESSS!! tooltip popup when they click Yess
      if (isYessClaimed && !window._shownYessPopups.has(player.id || player.name)) {
        window._shownYessPopups.add(player.id || player.name);
        setTimeout(() => {
          triggerSingleYessBubble(player, isMe, idx);
        }, 100);
      }
    });
  }

  /**
   * Record a Yess claim for a player.
   */
  function recordYessClaim(playerName, playerId) {
    if (!window._yessClaimedPlayers) window._yessClaimedPlayers = new Set();
    if (playerName) window._yessClaimedPlayers.add(playerName);
    if (playerId) window._yessClaimedPlayers.add(playerId);

    // If player elements exist in ribbon, trigger side bubble immediately
    const ribbon = document.getElementById('players-ribbon');
    if (ribbon) {
      Array.from(ribbon.children).forEach((child, idx) => {
        const title = child.getAttribute('title') || '';
        if ((playerName && title.includes(playerName)) || (playerId && child.dataset.playerId === playerId)) {
          child.classList.add('is-yess-winner');
          child.classList.remove('has-one-left');
          // Replace ticket counts with YESSS! tag in expanded view
          const details = child.querySelector('.ribbon-player-details');
          if (details) {
            const counts = details.querySelector('.ribbon-counts');
            if (counts) counts.remove();
            if (!details.querySelector('.ribbon-yess-claimed-tag')) {
              const tag = document.createElement('div');
              tag.className = 'ribbon-yess-claimed-tag';
              tag.textContent = 'YESSS!! 🎉';
              details.appendChild(tag);
            }
          }
          // Trigger side bubble if not already shown
          if (!window._shownYessPopups) window._shownYessPopups = new Set();
          if (!window._shownYessPopups.has(playerName || playerId)) {
            window._shownYessPopups.add(playerName || playerId);
            triggerSingleYessBubble({ name: playerName, id: playerId }, false, idx);
          }
        }
      });
    }
  }

  /**
   * Reset Yess claim states for a new game.
   */
  function resetYessClaims() {
    if (window._yessClaimedPlayers) window._yessClaimedPlayers.clear();
    if (window._shownYessPopups) window._shownYessPopups.clear();
  }

  /**
   * Trigger a temporary one-time YESSS! callout bubble that auto-dismisses after 4.5s.
   */
  function triggerSingleYessBubble(player, isMe, idx) {
    const bubbleOverlay = document.getElementById('yess-bubbles-overlay');
    const panel = document.getElementById('game-panel-right');
    const ribbon = document.getElementById('players-ribbon');
    if (!bubbleOverlay || !panel || !ribbon) return;

    const playerEl = ribbon.children[idx];
    if (!playerEl) return;

    const panelRect = panel.getBoundingClientRect();
    const playerRect = playerEl.getBoundingClientRect();
    const topOffset = playerRect.top - panelRect.top + (playerRect.height / 2);

    const bubble = document.createElement('div');
    bubble.className = 'floating-yess-bubble';
    bubble.dataset.playerIdx = idx;
    bubble.style.top = `${topOffset}px`;
    bubble.innerHTML = `<span>${isMe ? 'YOU' : escapeHtml(player.name)}: YESSS!! 🎉</span>`;
    bubbleOverlay.appendChild(bubble);

    // Auto-dismiss after 4 seconds with fade out
    setTimeout(() => {
      bubble.classList.add('fade-out');
      setTimeout(() => {
        bubble.remove();
      }, 400);
    }, 4000);
  }

  // Keep any active bubbles aligned when scrolling the players list
  const playerRibbonEl = document.getElementById('players-ribbon');
  if (playerRibbonEl) {
    playerRibbonEl.addEventListener('scroll', () => {
      const bubbleOverlay = document.getElementById('yess-bubbles-overlay');
      const panel = document.getElementById('game-panel-right');
      if (!bubbleOverlay || !panel) return;
      const panelRect = panel.getBoundingClientRect();
      bubbleOverlay.querySelectorAll('.floating-yess-bubble').forEach((bubble) => {
        const idx = parseInt(bubble.dataset.playerIdx);
        const playerEl = playerRibbonEl.children[idx];
        if (playerEl) {
          const playerRect = playerEl.getBoundingClientRect();
          const topOffset = playerRect.top - panelRect.top + (playerRect.height / 2);
          bubble.style.top = `${topOffset}px`;
          bubble.style.display = (playerRect.bottom < panelRect.top || playerRect.top > panelRect.bottom) ? 'none' : 'flex';
        }
      });
    }, { passive: true });
  }

  /**
   * Generate the 1-90 number board.
   */
  function generateNumberBoard() {
    const board = document.getElementById('number-board');
    if (!board) return;
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
  function updateNumberBoard(drawnNumbers, latestNumber = null) {
    if (!drawnNumbers) return;
    const drawnSet = new Set(drawnNumbers);
    const lastNum = latestNumber || (drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null);

    document.querySelectorAll('.board-num').forEach((el) => {
      const num = parseInt(el.textContent);
      const isCalled = drawnSet.has(num);
      const isLatest = num === lastNum;

      el.classList.toggle('called', isCalled);
      el.classList.toggle('latest', isLatest);
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
   * Update the recent balls strip (last 8 numbers).
   * Incrementally updates the DOM so existing balls don't flash.
   */
  function updateRecentBalls(drawnNumbers) {
    const container = document.getElementById('recent-balls');
    if (!container || !drawnNumbers || drawnNumbers.length === 0) return;

    const MAX_BALLS = 8;
    const last = drawnNumbers.slice(-MAX_BALLS).reverse(); // newest first

    // Get currently displayed numbers
    const existingBalls = Array.from(container.querySelectorAll('.recent-ball'));

    // Full rebuild when container is empty (first load / rejoin)
    if (existingBalls.length === 0) {
      container.innerHTML = '';
      last.forEach((n) => {
        const ball = document.createElement('div');
        ball.className = 'recent-ball';
        ball.textContent = n;
        container.appendChild(ball);
      });
      return;
    }

    // Incremental update — check if the newest number is already shown
    const newestNum = String(last[0]);
    const currentFirst = existingBalls[0] ? existingBalls[0].textContent : '';

    if (newestNum !== currentFirst) {
      // Remove the 'new' class from any previous newest ball
      existingBalls.forEach(b => b.classList.remove('new'));

      // Create the new ball
      const ball = document.createElement('div');
      ball.className = 'recent-ball new';
      ball.textContent = last[0];

      // Prepend (insert at the beginning)
      container.insertBefore(ball, container.firstChild);

      // Remove excess balls from the end
      while (container.children.length > MAX_BALLS) {
        container.lastChild.remove();
      }

      // Remove the 'new' class after animation completes
      setTimeout(() => ball.classList.remove('new'), 500);
    }
  }

  // ── SFX Volume Control ──────────────────────────────────────────
  let sfxVolume = 0.6; // 0 to 1

  function setSfxVolume(v) {
    sfxVolume = Math.max(0, Math.min(1, v));
  }

  function getSfxVolume() { return sfxVolume; }

  // ── Background Music (audio file loop) ──────────────────────────
  let musicVolume = 0;
  let musicAudio = null;

  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, v));
    if (musicAudio) {
      musicAudio.volume = musicVolume * 0.4; // cap max so it stays subtle
    }
    if (musicVolume > 0 && !musicAudio) {
      startMusic();
    } else if (musicVolume === 0 && musicAudio) {
      stopMusic();
    }
  }

  function getMusicVolume() { return musicVolume; }

  function startMusic() {
    if (musicAudio) return;
    try {
      musicAudio = new Audio('/audio/bg-music.mp3');
      musicAudio.loop = true;
      musicAudio.volume = musicVolume * 0.4;
      musicAudio.play().catch(() => {
        // Autoplay blocked — will start on next user interaction
        const startOnGesture = () => {
          if (musicAudio && musicVolume > 0) {
            musicAudio.play().catch(() => {});
          }
          document.removeEventListener('click', startOnGesture);
        };
        document.addEventListener('click', startOnGesture, { once: true });
      });
    } catch (e) {}
  }

  function stopMusic() {
    if (!musicAudio) return;
    try {
      musicAudio.pause();
      musicAudio.currentTime = 0;
      musicAudio = null;
    } catch (e) {}
  }

  return {
    playClickSound,
    playStampSound,
    playErrorSound,
    playWinSound,
    playCountdownTick,
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
    recordYessClaim,
    resetYessClaims,
    escapeHtml,
    copyToClipboard,
    setSfxVolume,
    getSfxVolume,
    setMusicVolume,
    getMusicVolume,
    startMusic,
    stopMusic,
  };
})();
