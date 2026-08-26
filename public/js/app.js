/**
 * App — SPA Router & Socket.io Event Handling
 *
 * Flow: Welcome (name) → Home (create/join) → Lobby → Game → Results
 */

(() => {
  // ── State ──────────────────────────────────────────────────────
  let socket = null;
  let currentScreen = 'welcome';
  let roomCode = null;
  let playerId = null;
  let playerName = '';
  let isHost = false;
  let ticketCount = 2;
  let hostName = '';

  // ── PWA Install ─────────────────────────────────────────────────
  let deferredInstallPrompt = null;

  // Capture the install prompt event (Chrome/Android)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  function isRunningAsPWA() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  async function setupInstallPrompt() {
    const overlay = document.getElementById('install-overlay');
    const btnInstall = document.getElementById('btn-install');
    const iosHint = document.getElementById('install-ios-hint');
    const subtitle = document.querySelector('.install-subtitle');

    // Already running as PWA — skip entirely
    if (isRunningAsPWA()) return;

    // Install overlay disabled for now
    return;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

    // Check if previously installed (via localStorage flag)
    const wasInstalled = localStorage.getItem('housie-installed');

    // Also try the getInstalledRelatedApps API (Chrome 80+)
    let isInstalled = !!wasInstalled;
    try {
      if ('getInstalledRelatedApps' in navigator) {
        const apps = await navigator.getInstalledRelatedApps();
        if (apps.length > 0) isInstalled = true;
      }
    } catch (e) {}

    // Show the overlay
    overlay.classList.add('active');

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isInstalled) {
      // PWA is installed — show "Open App" button
      subtitle.textContent = 'App is installed! Open it for the best experience.';
      btnInstall.textContent = '🚀 Open App';
      btnInstall.addEventListener('click', () => {
        // Navigate to the app URL — browser will redirect to installed PWA
        window.location.href = window.location.origin + '/?standalone=true';
      });
    } else if (isIOS) {
      // iOS — no install prompt available
      btnInstall.style.display = 'none';
      iosHint.style.display = 'block';
    } else {
      // Android/Chrome — use install prompt
      btnInstall.textContent = '📲 Install App';

      // Wait for beforeinstallprompt if not yet captured
      const waitForPrompt = () => new Promise((resolve) => {
        if (deferredInstallPrompt) return resolve(deferredInstallPrompt);
        const timeout = setTimeout(() => resolve(null), 3000);
        window.addEventListener('beforeinstallprompt', (e) => {
          e.preventDefault();
          clearTimeout(timeout);
          deferredInstallPrompt = e;
          resolve(e);
        }, { once: true });
      });

      btnInstall.addEventListener('click', async () => {
        if (!deferredInstallPrompt) {
          btnInstall.textContent = '⏳ Preparing...';
          btnInstall.disabled = true;
          await waitForPrompt();
          btnInstall.disabled = false;
        }

        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          const result = await deferredInstallPrompt.userChoice;
          if (result.outcome === 'accepted') {
            localStorage.setItem('housie-installed', 'true');
            overlay.classList.remove('active');
          }
          deferredInstallPrompt = null;
        } else {
          // Prompt truly unavailable — show manual instructions
          btnInstall.textContent = 'Tap ⋮ menu → "Add to Home Screen"';
          btnInstall.disabled = true;
        }
      });
    }

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      localStorage.setItem('housie-installed', 'true');
      overlay.classList.remove('active');
    });
  }



  // ── Screen Navigation ─────────────────────────────────────────
  function showScreen(name, pushState = true) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${name}`);
    if (screen) {
      screen.classList.add('active');
      if (typeof Motion !== 'undefined') {
        Motion.animateScreenIn(screen);
      }
    }
    currentScreen = name;

    // Push to browser history so back button works
    if (pushState) {
      history.pushState({ screen: name }, '', `#${name}`);
    }

    // Show/hide claim buttons only on game screen
    const claimBtns = document.getElementById('claim-buttons');
    if (claimBtns) claimBtns.style.display = name === 'game' ? 'flex' : 'none';

    // Check for saved session when showing home
    if (name === 'home') {
      checkSavedSession();
    }
  }

  /**
   * Check for a saved game session and show the continue banner.
   */
  function checkSavedSession() {
    const banner = document.getElementById('continue-banner');
    if (!banner) return;

    const saved = localStorage.getItem('housie-session');
    if (!saved) {
      banner.style.display = 'none';
      return;
    }

    try {
      const session = JSON.parse(saved);
      document.getElementById('continue-room-label').textContent = `${session.hostName || 'Host'}'s Room`;
      banner.style.display = '';
    } catch {
      banner.style.display = 'none';
    }
  }

  // ── Back Button Handling ───────────────────────────────────────
  function setupBackNavigation() {
    window.addEventListener('popstate', (e) => {
      const target = e.state?.screen || 'home';

      // Handle leaving room/game on back
      if (currentScreen === 'lobby') {
        if (roomCode) socket.emit('leave-room', { roomCode });
        resetState();
        showScreen('home', false);
      } else if (currentScreen === 'game') {
        // Don't leave-room on back — preserve session for rejoin
        resetState();
        stopCountdown();
        showScreen('home', false);
      } else if (currentScreen === 'results') {
        if (roomCode) socket.emit('leave-room', { roomCode });
        resetState();
        showScreen('home', false);
      } else {
        showScreen(target, false);
      }
    });
  }

  // ── Welcome Screen ────────────────────────────────────────────
  function setupWelcomeScreen() {
    const nameInput = document.getElementById('player-name');
    const btnContinue = document.getElementById('btn-continue');

    // Load saved name if any
    const saved = localStorage.getItem('housie-name') || '';
    nameInput.value = saved;

    btnContinue.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        UI.showToast('Please enter your name!', 'error');
        nameInput.focus();
        return;
      }
      playerName = name;
      localStorage.setItem('housie-name', playerName);
      document.getElementById('greeting-name').textContent = playerName;
      showScreen('home');
    });

    // Enter key to continue
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnContinue.click();
    });
  }

  // ── Home Screen Setup ─────────────────────────────────────────
  function setupHomeScreen() {
    const ticketDisplay = document.getElementById('ticket-count');
    const btnMinus = document.getElementById('btn-tickets-minus');
    const btnPlus = document.getElementById('btn-tickets-plus');
    const btnCreate = document.getElementById('btn-create-game');
    const btnJoin = document.getElementById('btn-join-game');
    const joinCodeInput = document.getElementById('join-code');

    // Ticket count
    btnMinus.addEventListener('click', () => {
      if (ticketCount > 1) {
        ticketCount--;
        ticketDisplay.textContent = ticketCount;
      }
    });

    btnPlus.addEventListener('click', () => {
      if (ticketCount < 6) {
        ticketCount++;
        ticketDisplay.textContent = ticketCount;
      }
    });

    // Create game
    btnCreate.addEventListener('click', () => {
      btnCreate.disabled = true;
      const createTimeout = setTimeout(() => { btnCreate.disabled = false; }, 5000);
      socket.emit('create-room', { playerName, ticketCount }, (response) => {
        clearTimeout(createTimeout);
        btnCreate.disabled = false;
        if (response.success) {
          roomCode = response.roomCode;
          playerId = response.playerId;
          isHost = true;
          hostName = response.hostName || playerName;
          enterLobby(response);
        } else {
          UI.showToast(response.message || 'Failed to create room', 'error');
        }
      });
    });

    // Join game
    btnJoin.addEventListener('click', () => {
      const code = joinCodeInput.value.trim();
      if (!code || code.length !== 4) {
        UI.showToast('Enter a valid 4-digit room code!', 'error');
        joinCodeInput.focus();
        return;
      }

      btnJoin.disabled = true;
      const joinTimeout = setTimeout(() => { btnJoin.disabled = false; }, 5000);
      socket.emit('join-room', { roomCode: code, playerName }, (response) => {
        clearTimeout(joinTimeout);
        btnJoin.disabled = false;
        if (response.success) {
          roomCode = code;
          playerId = response.playerId;
          isHost = false;
          ticketCount = response.ticketCount;
          hostName = response.hostName || 'Host';
          enterLobby(response);
        } else {
          UI.showToast(response.message || 'Failed to join room', 'error');
        }
      });
    });

    // Auto-filter room code input + auto-join on 4 digits
    joinCodeInput.addEventListener('input', () => {
      joinCodeInput.value = joinCodeInput.value.replace(/\D/g, '').slice(0, 4);
      if (joinCodeInput.value.length === 4) {
        btnJoin.click();
      }
    });

    // Continue game (rejoin saved session)
    document.getElementById('btn-continue-game')?.addEventListener('click', () => {
      const saved = localStorage.getItem('housie-session');
      if (!saved) return;

      try {
        const session = JSON.parse(saved);
        socket.emit('rejoin-room', {
          roomCode: session.roomCode,
          playerName: session.playerName || playerName,
        }, (response) => {
          if (response.success) {
            roomCode = session.roomCode;
            playerId = response.playerId;
            isHost = response.isHost;
            hostName = response.hostName || session.hostName;
            playerName = session.playerName || playerName;
            enterGame(response);
            UI.showToast('Rejoined game! 🎉', 'success');
          } else {
            localStorage.removeItem('housie-session');
            document.getElementById('continue-banner').style.display = 'none';
            UI.showToast(response.message || 'Could not rejoin', 'error');
          }
        });
      } catch {
        localStorage.removeItem('housie-session');
      }
    });

    // Dismiss continue banner
    document.getElementById('btn-dismiss-continue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.removeItem('housie-session');
      document.getElementById('continue-banner').style.display = 'none';
    });
  }

  // ── Settings Modal ────────────────────────────────────────────
  function setupSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const nameInput = document.getElementById('settings-name');
    const btnSave = document.getElementById('btn-save-settings');
    const btnCancel = document.getElementById('btn-cancel-settings');
    const btnSettings = document.getElementById('btn-settings');

    btnSettings.addEventListener('click', () => {
      nameInput.value = playerName;
      modal.classList.add('active');
      nameInput.focus();
    });

    btnSave.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        UI.showToast('Name cannot be empty!', 'error');
        return;
      }
      playerName = name;
      localStorage.setItem('housie-name', playerName);
      document.getElementById('greeting-name').textContent = playerName;
      modal.classList.remove('active');
      UI.showToast('Name updated!', 'success', 2000);
    });

    btnCancel.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // ── Lobby Screen ──────────────────────────────────────────────
  function enterLobby(data) {
    showScreen('lobby');

    document.getElementById('room-code-value').textContent = roomCode;
    document.getElementById('game-room-badge').textContent = `${hostName}'s Room`;
    UI.renderPlayerList(data.players);

    // Host controls
    const startBtn = document.getElementById('btn-start-game');

    if (isHost) {
      startBtn.style.display = '';
      startBtn.disabled = data.players.length < 2;
    } else {
      startBtn.style.display = 'none';
    }
  }

  function setupLobbyScreen() {
    // Copy code
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      if (roomCode) UI.copyToClipboard(roomCode);
    });

    // Leave lobby
    document.getElementById('btn-leave-lobby').addEventListener('click', () => {
      if (roomCode) {
        socket.emit('leave-room', { roomCode });
      }
      resetState();
      showScreen('home');
    });


    // Start game
    document.getElementById('btn-start-game').addEventListener('click', () => {
      const btn = document.getElementById('btn-start-game');
      btn.disabled = true;
      socket.emit('start-game', { roomCode }, (response) => {
        if (!response.success) {
          btn.disabled = false;
          UI.showToast(response.message, 'error');
        }
      });
    });
  }

  // ── Game Screen ───────────────────────────────────────────────
  function enterGame(data) {
    showScreen('game');

    // Fullscreen on first tap (API requires user gesture)
    const gameScreen = document.getElementById('screen-game');
    function goFullscreen() {
      try {
        const el = document.documentElement;
        const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (rfs) rfs.call(el).catch(() => {});
      } catch(e) {}
      gameScreen.removeEventListener('click', goFullscreen);
    }
    gameScreen.addEventListener('click', goFullscreen, { once: true });
    // Save session so player can rejoin if they accidentally close
    localStorage.setItem('housie-session', JSON.stringify({
      roomCode,
      playerName,
      hostName,
    }));

    GameRenderer.init(data.tickets, isHost);
    UI.renderPlayersRibbon(data.players, playerId);
    UI.updateNumberBoard(data.drawnNumbers || [], data.drawnNumbers?.[data.drawnNumbers.length - 1] || null);

    // Replay any already-drawn numbers onto board (rejoin scenario)
    if (data.drawnNumbers && data.drawnNumbers.length > 0) {
      data.drawnNumbers.forEach(n => GameRenderer.markNumber(n));
      document.getElementById('numbers-called-count').textContent = `${data.drawnNumbers.length}/90`;
      UI.updateRecentBalls(data.drawnNumbers);

      // Restore which numbers the player had manually marked before disconnect
      GameRenderer.restoreMarkedNumbers();
      // Highlight any callable numbers they haven't marked yet
      GameRenderer.highlightCallableNumbers();
    } else {
      // Fresh game — clear old state
      document.getElementById('current-number-text').textContent = '?';
      document.getElementById('numbers-called-count').textContent = '0/90';
      // Clear recent balls from any previous game
      const recentBalls = document.getElementById('recent-balls');
      if (recentBalls) recentBalls.innerHTML = '';
      // Clear saved marked numbers from previous game
      GameRenderer.clearMarkedNumbers();
    }

    document.getElementById('game-room-badge').textContent = `${hostName}'s Room`;
    document.getElementById('number-board-wrapper').classList.remove('expanded');

    // Show countdown only for fresh game start (no numbers drawn yet)
    if (!data.drawnNumbers || data.drawnNumbers.length === 0) {
      showGameCountdown();
    } else {
      document.getElementById('game-countdown-overlay').classList.add('hidden');
    }

    if (data.prizes) {
      Object.entries(data.prizes).forEach(([prizeType, winners]) => {
        if (winners && winners.length > 0) {
          GameRenderer.disableClaim(prizeType, winners[0].playerName);
        }
      });
    }
  }

  // ── Game Start Countdown Overlay ─────────────────────────────────
  let gameCountdownTimer = null;

  function showGameCountdown() {
    const overlay = document.getElementById('game-countdown-overlay');
    const numEl = document.getElementById('game-countdown-number');
    if (!overlay || !numEl) return;

    overlay.classList.remove('hidden');
    let seconds = 8;
    numEl.textContent = seconds;

    gameCountdownTimer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(gameCountdownTimer);
        gameCountdownTimer = null;
        overlay.classList.add('hidden');
      } else {
        numEl.textContent = seconds;
      }
    }, 1000);
  }

  function stopCountdown() {
    if (gameCountdownTimer) {
      clearInterval(gameCountdownTimer);
      gameCountdownTimer = null;
    }
    const overlay = document.getElementById('game-countdown-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function setupGameScreen() {

    // Mute toggle
    let isMuted = false;
    document.getElementById('btn-mute').addEventListener('click', () => {
      isMuted = !isMuted;
      TTS.setMuted(isMuted);
      document.getElementById('mute-icon-on').style.display = isMuted ? 'none' : '';
      document.getElementById('mute-icon-off').style.display = isMuted ? '' : 'none';
    });

    // Players panel — tap to expand/collapse
    const playersPanel = document.getElementById('game-panel-right');
    playersPanel.addEventListener('click', () => {
      playersPanel.classList.toggle('expanded');
    });
    document.querySelector('.game-panel-center')?.addEventListener('click', () => {
      playersPanel.classList.remove('expanded');
    });

    // Toggle number board modal
    const boardWrapper = document.getElementById('number-board-wrapper');
    document.getElementById('btn-toggle-board').addEventListener('click', () => {
      boardWrapper.classList.toggle('expanded');
    });
    document.getElementById('btn-close-board').addEventListener('click', () => {
      boardWrapper.classList.remove('expanded');
    });
    boardWrapper.addEventListener('click', (e) => {
      if (e.target === boardWrapper) boardWrapper.classList.remove('expanded');
    });

    // Claim buttons
    document.querySelectorAll('.claim-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prizeType = btn.dataset.prize;
        btn.disabled = true;

        // For Full House: try each ticket in order to find one that's valid
        const tickets = GameRenderer.getTickets();
        const indicesToTry = prizeType === 'fullHouse'
          ? tickets.map((_, i) => i)          // try all tickets
          : [GameRenderer.getActiveTicketIndex()]; // use selected ticket

        function tryNext(indices) {
          if (indices.length === 0) {
            btn.disabled = false;
            UI.showToast('❌ Not quite! Keep playing.', 'error');
            return;
          }
          const [ticketIndex, ...rest] = indices;
          socket.emit('claim-prize', { roomCode, prizeType, ticketIndex }, (response) => {
            if (response.valid) {
              // success — button stays disabled (server will broadcast)
            } else if (prizeType === 'fullHouse' && rest.length > 0) {
              tryNext(rest); // try next ticket
            } else {
              btn.disabled = false;
              UI.showToast(response.message, 'error');
            }
          });
        }

        tryNext(indicesToTry);
      });
    });

    // Leave game — only clear session if user confirms
    document.getElementById('btn-leave-game').addEventListener('click', () => {
      if (confirm('Are you sure you want to leave the game?')) {
        localStorage.removeItem('housie-session'); // explicit leave = clear saved session
        socket.emit('leave-room', { roomCode });
        resetState();
        showScreen('home');
      }
    });

    // Emit progress whenever a number is marked; server broadcasts sorted leaderboard
    GameRenderer.setOnMark((ticketIdx, markedCount) => {
      if (!roomCode) return;
      // Collect current marked counts for ALL tickets
      const tickets = GameRenderer.getTickets();
      const ticketCounts = tickets.map((_, i) => {
        const grid = document.getElementById(`ticket-grid-${i}`);
        return grid ? grid.querySelectorAll('.ticket-cell.marked').length : 0;
      });
      socket.emit('player-progress', { roomCode, ticketCounts });
    });
  }

  // ── Results Screen ────────────────────────────────────────────
  function showResults(winners) {
    showScreen('results');
    UI.launchConfetti(80);

    const list = document.getElementById('winners-list');
    list.innerHTML = '';

    const fullHouseWinners = winners.fullHouse || [];

    if (fullHouseWinners.length > 0) {
      fullHouseWinners.forEach((winner, i) => {
        const card = document.createElement('div');
        card.className = 'winner-card';
        card.innerHTML = `
          <div class="winner-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
          <span class="winner-name">${UI.escapeHtml(winner.playerName)}</span>
          <span class="winner-label">Full House</span>
        `;
        list.appendChild(card);
      });
    } else {
      list.innerHTML = '<div class="winner-card"><span class="winner-unclaimed">No winners</span></div>';
    }
  }

  function setupResultsScreen() {
    document.getElementById('btn-play-again').addEventListener('click', () => {
      socket.emit('play-again', { roomCode }, (response) => {
        if (!response.success) {
          UI.showToast(response.message, 'error');
        }
      });
    });

    document.getElementById('btn-leave-results').addEventListener('click', () => {
      socket.emit('leave-room', { roomCode });
      resetState();
      showScreen('home');
    });
  }

  // ── Socket Events ─────────────────────────────────────────────
  function setupSocketEvents() {
    socket.on('player-joined', (data) => {
      UI.renderPlayerList(data.players);
      UI.showToast(`${data.playerName} joined!`, 'info', 2000);

      if (isHost) {
        document.getElementById('btn-start-game').disabled = data.playerCount < 2;
      }
    });

    socket.on('player-left', (data) => {
      UI.renderPlayerList(data.players);
      UI.showToast(`${data.playerName} left`, 'warning', 2000);

      if (data.newHostId === playerId) {
        isHost = true;
        UI.showToast('You are now the host!', 'info');

        if (currentScreen === 'lobby') {
          document.getElementById('btn-start-game').style.display = '';
          document.getElementById('btn-start-game').disabled = data.players.length < 2;
        } else if (currentScreen === 'game') {
          // Auto-draw handles everything now
        }
      }

      if (isHost && currentScreen === 'lobby') {
        document.getElementById('btn-start-game').disabled = data.players.length < 2;
      }

      if (currentScreen === 'game') {
        UI.renderPlayersRibbon(data.players);
      }
    });

    socket.on('settings-updated', (data) => {
      ticketCount = data.ticketCount;
      document.getElementById('ticket-count').textContent = ticketCount;
    });

    socket.on('game-started', (data) => {
      isHost = data.isHost;
      enterGame(data);
      UI.showToast('Game started! 🎉', 'success');
    });

    socket.on('number-drawn', (data) => {
      GameRenderer.markNumber(data.number);
      UI.updateNumberBoard(data.drawnNumbers, data.number);
      UI.updateRecentBalls(data.drawnNumbers);
      TTS.announceNumber(data.number);
    });

    socket.on('prize-claimed', (data) => {
      // Don't disable Full House — grace period allows multiple winners
      if (data.prizeType !== 'fullHouse') {
        GameRenderer.disableClaim(data.prizeType, data.winnerName);
      }
      UI.showPrizeAnnouncement(data.message, 3500);
    });

    // Full House grace period — countdown for others to claim
    let graceInterval = null;
    socket.on('full-house-grace', (data) => {
      let remaining = data.seconds;

      // Show initial toast
      UI.showToast(`🏠 ${data.winnerName} got Full House! ${remaining}s for others to claim!`, 'warning', 4000);

      // Update countdown
      graceInterval = setInterval(() => {
        remaining--;
        const badge = document.getElementById('numbers-called-count');
        if (badge) badge.textContent = `⏱️ ${remaining}s`;
        if (remaining <= 0) clearInterval(graceInterval);
      }, 1000);
    });

    socket.on('game-over', (data) => {
      if (graceInterval) clearInterval(graceInterval);
      stopCountdown();
      localStorage.removeItem('housie-session'); // game is done
      setTimeout(() => {
        showResults(data.winners);
      }, 4000);
    });

    socket.on('game-reset', (data) => {
      showScreen('lobby');
      UI.renderPlayerList(data.players);
      ticketCount = data.ticketCount;

      if (isHost) {
        document.getElementById('btn-start-game').style.display = '';
        document.getElementById('btn-start-game').disabled = data.players.length < 2;
      } else {
        document.getElementById('btn-start-game').style.display = 'none';
      }

      UI.showToast('New round! Get ready 🎲', 'info');
    });

    socket.on('leaderboard-update', (data) => {
      if (currentScreen === 'game') {
        UI.renderPlayersRibbon(data.leaderboard, playerId);
      }
    });

    socket.on('error', (data) => {
      UI.showToast(data.message, 'error');
    });

    socket.on('disconnect', () => {
      if (currentScreen === 'game' || currentScreen === 'lobby') {
        showReconnectingOverlay(true);
      }
    });

    socket.on('connect', () => {
      // Auto-rejoin if we were in a game
      if (currentScreen === 'game' || currentScreen === 'lobby') {
        attemptAutoRejoin();
      } else if (currentScreen !== 'welcome' && currentScreen !== 'home') {
        UI.showToast('Reconnected!', 'success', 2000);
      }
    });

    // Handle player online/offline status from server
    socket.on('player-status', (data) => {
      if (!data.online) {
        UI.showToast(`${data.playerName} went offline`, 'warning', 2500);
      } else {
        UI.showToast(`${data.playerName} is back! 🟢`, 'success', 2500);
      }
      UI.renderPlayersRibbon(data.players, playerId);
    });

    // ── Visibility / Focus Listeners ──
    // When user returns from phone call, app switch, or lock screen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        if (currentScreen === 'game' || currentScreen === 'lobby') {
          showReconnectingOverlay(true);
          socket.connect(); // force reconnect
        }
      }
    });

    // bfcache restore (iOS Safari)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && !socket.connected) {
        if (currentScreen === 'game' || currentScreen === 'lobby') {
          showReconnectingOverlay(true);
          socket.connect();
        }
      }
    });
  }

  /**
   * Attempt to auto-rejoin the current game session.
   */
  function attemptAutoRejoin() {
    const saved = localStorage.getItem('housie-session');
    if (!saved) {
      showReconnectingOverlay(false);
      return;
    }

    try {
      const session = JSON.parse(saved);
      const name = session.playerName || playerName;
      const code = session.roomCode || roomCode;

      if (!code || !name) {
        showReconnectingOverlay(false);
        return;
      }

      socket.emit('rejoin-room', {
        roomCode: code,
        playerName: name,
      }, (response) => {
        showReconnectingOverlay(false);
        if (response.success) {
          roomCode = code;
          playerId = response.playerId;
          isHost = response.isHost;
          hostName = response.hostName || session.hostName;
          playerName = name;
          enterGame(response);
          UI.showToast('Back in the game! 🎉', 'success', 2000);

          // Notify server we're back online
          socket.to && socket.emit && socket.emit('player-online', { roomCode: code });
        } else {
          localStorage.removeItem('housie-session');
          UI.showToast(response.message || 'Could not rejoin', 'error');
          showScreen('home');
        }
      });
    } catch {
      showReconnectingOverlay(false);
    }
  }

  /**
   * Show/hide a reconnecting overlay on the game screen.
   */
  function showReconnectingOverlay(show) {
    let overlay = document.getElementById('reconnecting-overlay');
    if (show) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reconnecting-overlay';
        overlay.innerHTML = `
          <div class="reconnecting-content">
            <div class="reconnecting-spinner"></div>
            <p>Reconnecting...</p>
          </div>
        `;
        document.body.appendChild(overlay);
      }
      overlay.classList.remove('hidden');
    } else if (overlay) {
      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 500);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  function resetState() {
    roomCode = null;
    playerId = null;
    isHost = false;
  }

  // ── Dev Mock Mode ──────────────────────────────────────────────
  function loadMockGame() {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
    const isMock = location.hash === '#game' || location.hash === '#mock' || location.search.includes('mock');
    if (!isMock) return false;

    // 30 mock player names
    const mockNames = [
      'Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Neha', 'Arjun', 'Pooja',
      'Karan', 'Divya', 'Rohit', 'Meera', 'Sanjay', 'Anjali', 'Deepak', 'Kavita',
      'Manish', 'Ritu', 'Suresh', 'Nisha', 'Anil', 'Swati', 'Rajesh', 'Simran',
      'Vivek', 'Tanvi', 'Gaurav', 'Isha', 'Nikhil', 'Megha'
    ];

    const mockPlayers = mockNames.map((name, i) => ({
      id: `mock-${i}`, name, isHost: i === 0
    }));

    // Generate a mock ticket with no duplicate numbers
    function makeMockTicket() {
      const colRanges = [
        [1,9], [10,19], [20,29], [30,39], [40,49],
        [50,59], [60,69], [70,79], [80,90]
      ];

      // Step 1: Decide how many numbers each column gets (1-3, total 15)
      const colCounts = new Array(9).fill(1); // start with 1 each = 9
      let remaining = 6; // need 6 more to reach 15
      const shuffled = [0,1,2,3,4,5,6,7,8].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (remaining <= 0) break;
        const extra = Math.min(2, remaining, Math.ceil(Math.random() * 2));
        colCounts[c] += extra;
        remaining -= extra;
      }
      // Distribute any leftover
      while (remaining > 0) {
        for (let c = 0; c < 9 && remaining > 0; c++) {
          if (colCounts[c] < 3) { colCounts[c]++; remaining--; }
        }
      }

      // Step 2: Pick unique numbers for each column
      const usedInTicket = new Set();
      const colNums = colCounts.map((count, c) => {
        const [min, max] = colRanges[c];
        const picked = [];
        while (picked.length < count) {
          const n = min + Math.floor(Math.random() * (max - min + 1));
          if (!usedInTicket.has(n) && !picked.includes(n)) {
            picked.push(n);
            usedInTicket.add(n);
          }
        }
        return picked.sort((a, b) => a - b);
      });

      // Step 3: Assign to rows (5 numbers per row)
      const ticket = [
        [null,null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null,null],
        [null,null,null,null,null,null,null,null,null]
      ];
      const rowCounts = [0, 0, 0];

      // Place 3-count columns first (all rows)
      for (let c = 0; c < 9; c++) {
        if (colCounts[c] === 3) {
          for (let r = 0; r < 3; r++) { ticket[r][c] = colNums[c][r]; rowCounts[r]++; }
        }
      }
      // Place 2-count columns (pick 2 rows with fewest)
      for (let c = 0; c < 9; c++) {
        if (colCounts[c] === 2) {
          const rows = [0,1,2].sort((a,b) => rowCounts[a] - rowCounts[b] || Math.random() - 0.5).slice(0,2).sort((a,b) => a-b);
          rows.forEach((r, i) => { ticket[r][c] = colNums[c][i]; rowCounts[r]++; });
        }
      }
      // Place 1-count columns (pick 1 row with fewest)
      for (let c = 0; c < 9; c++) {
        if (colCounts[c] === 1) {
          const row = [0,1,2].sort((a,b) => rowCounts[a] - rowCounts[b] || Math.random() - 0.5)[0];
          ticket[row][c] = colNums[c][0]; rowCounts[row]++;
        }
      }

      return ticket;
    }

    // Draw 25 random numbers
    const allNums = Array.from({ length: 90 }, (_, i) => i + 1);
    for (let i = allNums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allNums[i], allNums[j]] = [allNums[j], allNums[i]];
    }
    const drawnNumbers = allNums.slice(0, 25);

    hostName = 'Rahul';
    roomCode = '4567';

    // Show game screen
    showScreen('game');
    document.getElementById('game-countdown-overlay').classList.add('hidden');
    document.getElementById('game-room-badge').textContent = `${hostName}'s Room`;
    document.getElementById('numbers-called-count').textContent = `${drawnNumbers.length}/90`;

    // Assign random ticket progress to each mock player
    const TICKET_COUNT = 6;
    mockPlayers.forEach((p, i) => {
      // Simulate varying progress — some players ahead, some behind
      p.ticketCounts = Array.from({ length: TICKET_COUNT }, () =>
        Math.floor(Math.random() * 14) // 0-13 marked out of 15
      );
      p.bestMarked = Math.max(...p.ticketCounts);
    });

    // Sort by most marked (closest to winning) first
    mockPlayers.sort((a, b) => b.bestMarked - a.bestMarked);

    // "You" are Rahul (mock-0), set playerId so ribbon highlights you
    playerId = 'mock-0';

    // Render players ribbon (sorted, with counts)
    UI.renderPlayersRibbon(mockPlayers, playerId);
    UI.generateNumberBoard();

    // Render tickets
    const mockTickets = Array.from({ length: 6 }, () => makeMockTicket());
    GameRenderer.init(mockTickets, true);

    // Simulate called numbers on the board
    drawnNumbers.forEach((n) => {
      GameRenderer.markNumber(n);
    });
    UI.updateNumberBoard(drawnNumbers, drawnNumbers[drawnNumbers.length - 1]);
    UI.updateRecentBalls(drawnNumbers);

    // Simulate leaderboard changes every 5s (mock only)
    setInterval(() => {
      // Each player has a chance to mark 1-2 more numbers
      mockPlayers.forEach(p => {
        p.ticketCounts = p.ticketCounts.map(count => {
          const bump = Math.random() < 0.4 ? 1 : 0; // 40% chance to mark one more
          return Math.min(15, count + bump);
        });
        p.bestMarked = Math.max(...p.ticketCounts);
      });

      // Re-sort
      mockPlayers.sort((a, b) => b.bestMarked - a.bestMarked);

      // Re-render ribbon
      UI.renderPlayersRibbon(mockPlayers, playerId);
    }, 5000);

    return true;
  }

  // ── Start ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Init socket (graceful offline handling)
    try {
      socket = io({ reconnection: true, reconnectionDelay: 2000, reconnectionAttempts: Infinity });
    } catch(e) {
      socket = { on: ()=>{}, emit: ()=>{}, connected: false };
    }
    setupInstallPrompt();
    setupWelcomeScreen();
    setupHomeScreen();
    setupLobbyScreen();
    setupGameScreen();
    setupResultsScreen();
    setupSettingsModal();
    setupSocketEvents();
    setupBackNavigation();
    UI.generateNumberBoard();

    // Try mock mode first
    if (loadMockGame()) return;

    // Normal flow — skip welcome if name saved
    const savedName = localStorage.getItem('housie-name');
    if (savedName && savedName.trim()) {
      playerName = savedName.trim();
      showScreen('home');
      document.getElementById('greeting-name').textContent = playerName;
    } else {
      showScreen('welcome');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  });
})();
