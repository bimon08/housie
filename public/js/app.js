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

  // Unique device ID — persists across sessions to prevent duplicate entries
  const deviceId = localStorage.getItem('housie-device-id') || (() => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('housie-device-id', id);
    return id;
  })();
  let wakeLock = null;

  // ── Screen Wake Lock (all pages) ───────────────────────────────
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* browser denied or not supported */ }
  }

  // Acquire on load
  acquireWakeLock();

  // Re-acquire when coming back from phone call / app switch
  // Also mute/unmute ALL audio
  let _savedSfxVol = null;
  let _savedAnnounceVol = null;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!wakeLock) acquireWakeLock();
      // Restore all audio
      if (_savedSfxVol !== null) {
        UI.setSfxVolume(_savedSfxVol);
        _savedSfxVol = null;
      }
      if (_savedAnnounceVol !== null && typeof TTS !== 'undefined') {
        TTS.setVolume(_savedAnnounceVol);
        _savedAnnounceVol = null;
      }
      if (UI && UI.getMusicVolume() > 0) UI.startMusic();
    } else {
      // Mute everything when app is hidden
      if (UI) {
        _savedSfxVol = UI.getSfxVolume();
        UI.setSfxVolume(0);
        UI.stopMusic();
      }
      if (typeof TTS !== 'undefined') {
        _savedAnnounceVol = TTS.getVolume();
        TTS.setVolume(0);
      }
    }
  });

  // ── Fullscreen Helper (hides mobile OS system status bar) ───────
  function requestAppFullscreen() {
    try {
      const el = document.documentElement;
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (rfs && !document.fullscreenElement && !document.webkitFullscreenElement) {
        rfs.call(el).catch(() => {});
      }
    } catch (e) {}
  }

  // Trigger fullscreen on ANY user interaction anywhere to keep OS status bar hidden
  document.addEventListener('touchstart', requestAppFullscreen, { passive: true });
  document.addEventListener('click', requestAppFullscreen, { passive: true });

  // ── DPI / System Scaling Normalization ──────────────────────────
  // On Android, users can increase "Display Size" in settings, which
  // inflates devicePixelRatio and shrinks the CSS viewport. We detect
  // non-standard scaling and compensate by adjusting the root font-size.
  (function normalizeDPI() {
    const dpr = window.devicePixelRatio || 1;
    // Standard DPRs: 1, 1.5, 2, 3. Non-standard (e.g. 2.625, 3.5) = system scaled
    if (dpr > 1) {
      const roundedDpr = Math.round(dpr);
      const scaleFactor = roundedDpr / dpr;
      // Only compensate if the difference is significant (>5%)
      if (Math.abs(1 - scaleFactor) > 0.05) {
        document.documentElement.style.fontSize = (scaleFactor * 100) + '%';
      }
    }
  })();

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
  // Silent auto-update flag — set when a new SW version is detected
  let _pendingUpdate = false;

  function showScreen(name, pushState = true) {
    // Silent auto-update: reload at safe transition points (never during game)
    if (_pendingUpdate && name !== 'game') {
      _pendingUpdate = false;
      window.location.reload();
      return;
    }

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

  // ── Button Loading Helper ──────────────────────────────────────
  function setLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.classList.add('btn-loading');
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
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
      requestAppFullscreen();
      setLoading(btnCreate, true);
      const createTimeout = setTimeout(() => { setLoading(btnCreate, false); }, 5000);
      socket.emit('create-room', { playerName, ticketCount, deviceId }, (response) => {
        clearTimeout(createTimeout);
        setLoading(btnCreate, false);
        if (response.success) {
          roomCode = response.roomCode;
          playerId = response.playerId;
          isHost = true;
          hostName = response.hostName || playerName;
          if (typeof window.Analytics !== 'undefined') {
            window.Analytics.identify(playerId, { name: playerName });
            window.Analytics.track('room_created', { ticketCount, roomCode });
          }
          enterLobby(response);
        } else {
          UI.showToast(response.message || 'Failed to create room', 'error');
        }
      });
    });

    // Join game
    function submitJoinCode() {
      requestAppFullscreen();
      const code = joinCodeInput.value.trim();
      if (!code || code.length !== 4) {
        UI.showToast('Enter a valid 4-digit room code!', 'error');
        joinCodeInput.focus();
        return;
      }

      setLoading(btnJoin, true);
      const joinTimeout = setTimeout(() => { setLoading(btnJoin, false); }, 5000);
      socket.emit('join-room', { roomCode: code, playerName, deviceId }, (response) => {
        clearTimeout(joinTimeout);
        setLoading(btnJoin, false);
        if (response.success) {
          roomCode = code;
          playerId = response.playerId;
          isHost = false;
          if (typeof window.Analytics !== 'undefined') {
            window.Analytics.identify(playerId, { name: playerName });
            window.Analytics.track('room_joined', { roomCode: code });
          }
          ticketCount = response.ticketCount;
          hostName = response.hostName || 'Host';
          enterLobby(response);
        } else {
          UI.showToast(response.message || 'Failed to join room', 'error');
          joinCodeInput.classList.add('shake');
          setTimeout(() => joinCodeInput.classList.remove('shake'), 450);
          joinCodeInput.select();
        }
      });
    }

    btnJoin.addEventListener('click', submitJoinCode);

    // Auto-filter room code input + auto-join immediately on 4 full digits
    joinCodeInput.addEventListener('input', () => {
      joinCodeInput.value = joinCodeInput.value.replace(/\D/g, '').slice(0, 4);
      if (joinCodeInput.value.length === 4) {
        submitJoinCode();
      }
    });

    joinCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submitJoinCode();
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
          deviceId,
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

    // Volume sliders
    const volAnnounce = document.getElementById('vol-announce');
    const volSfx = document.getElementById('vol-sfx');
    const volMusic = document.getElementById('vol-music');
    const volAnnounceVal = document.getElementById('vol-announce-val');
    const volSfxVal = document.getElementById('vol-sfx-val');
    const volMusicVal = document.getElementById('vol-music-val');

    // Load saved volume settings
    const savedVols = JSON.parse(localStorage.getItem('housie-volumes') || '{}');
    const announceVol = savedVols.announce !== undefined ? savedVols.announce : 80;
    const sfxVol = savedVols.sfx !== undefined ? savedVols.sfx : 60;
    const musicVol = savedVols.music !== undefined ? savedVols.music : 0;

    // Apply saved volumes
    volAnnounce.value = announceVol;
    volSfx.value = sfxVol;
    volMusic.value = musicVol;
    applyVolumes(announceVol, sfxVol, musicVol);
    updateVolLabels();

    function updateVolLabels() {
      volAnnounceVal.textContent = volAnnounce.value == 0 ? 'Off' : volAnnounce.value + '%';
      volSfxVal.textContent = volSfx.value == 0 ? 'Off' : volSfx.value + '%';
      volMusicVal.textContent = volMusic.value == 0 ? 'Off' : volMusic.value + '%';
    }

    function applyVolumes(a, s, m) {
      if (typeof TTS !== 'undefined') TTS.setVolume(a / 100);
      UI.setSfxVolume(s / 100);
      UI.setMusicVolume(m / 100);
    }

    function saveVolumes() {
      localStorage.setItem('housie-volumes', JSON.stringify({
        announce: parseInt(volAnnounce.value),
        sfx: parseInt(volSfx.value),
        music: parseInt(volMusic.value),
      }));
    }

    // Real-time slider updates
    volAnnounce.addEventListener('input', () => {
      updateVolLabels();
      if (typeof TTS !== 'undefined') TTS.setVolume(parseInt(volAnnounce.value) / 100);
    });
    volSfx.addEventListener('input', () => {
      updateVolLabels();
      UI.setSfxVolume(parseInt(volSfx.value) / 100);
    });
    volMusic.addEventListener('input', () => {
      updateVolLabels();
      UI.setMusicVolume(parseInt(volMusic.value) / 100);
    });

    btnSettings.addEventListener('click', () => {
      nameInput.value = playerName;
      modal.classList.add('active');
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

      // Save volumes
      applyVolumes(parseInt(volAnnounce.value), parseInt(volSfx.value), parseInt(volMusic.value));
      saveVolumes();

      modal.classList.remove('active');
      UI.showToast('Settings saved!', 'success', 2000);
    });

    btnCancel.addEventListener('click', () => {
      // Revert sliders to saved values
      const saved = JSON.parse(localStorage.getItem('housie-volumes') || '{}');
      volAnnounce.value = saved.announce !== undefined ? saved.announce : 80;
      volSfx.value = saved.sfx !== undefined ? saved.sfx : 60;
      volMusic.value = saved.music !== undefined ? saved.music : 0;
      applyVolumes(parseInt(volAnnounce.value), parseInt(volSfx.value), parseInt(volMusic.value));
      updateVolLabels();
      modal.classList.remove('active');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        btnCancel.click(); // revert on backdrop close
      }
    });
  }

  // ── Lobby Screen ──────────────────────────────────────────────
  let _lobbyPollTimer = null;

  function enterLobby(data) {
    showScreen('lobby');

    document.getElementById('room-code-value').textContent = roomCode || '1234';
    document.getElementById('game-room-badge').textContent = `${hostName || 'Host'}'s Room`;
    UI.renderPlayerList(data.players);

    // Host controls
    const startBtn = document.getElementById('btn-start-game');

    if (isHost) {
      startBtn.style.display = '';
      startBtn.disabled = data.players.length < 2;
    } else {
      startBtn.style.display = 'none';
    }



    // Poll: auto-join game if it already started (catches missed game-started events)
    stopLobbyPoll();
    _lobbyPollTimer = setInterval(() => {
      if (currentScreen !== 'lobby' || !roomCode || !socket.connected) {
        stopLobbyPoll();
        return;
      }
      socket.emit('check-game-status', { roomCode }, (response) => {
        if (response && response.gameInProgress && currentScreen === 'lobby') {
          console.log('[Lobby] Game already in progress — auto-joining');
          stopLobbyPoll();
          isHost = response.isHost;
          enterGame(response);
          UI.showToast('Game in progress — jumping in! 🎉', 'success');
        }
      });
    }, 1500);
  }

  function stopLobbyPoll() {
    if (_lobbyPollTimer) {
      clearInterval(_lobbyPollTimer);
      _lobbyPollTimer = null;
    }
  }

  function setupLobbyScreen() {
    // Copy code
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      if (roomCode) UI.copyToClipboard(roomCode);
    });

    // Leave lobby
    document.getElementById('btn-leave-lobby').addEventListener('click', () => {
      stopLobbyPoll();
      if (roomCode) {
        socket.emit('leave-room', { roomCode });
      }
      resetState();
      showScreen('home');
    });


    // Start game
    document.getElementById('btn-start-game').addEventListener('click', () => {
      requestAppFullscreen();
      const btn = document.getElementById('btn-start-game');
      setLoading(btn, true);
      socket.emit('start-game', { roomCode }, (response) => {
        if (!response.success) {
          setLoading(btn, false);
          UI.showToast(response.message, 'error');
        }
      });
    });
  }

  // ── Game Screen ───────────────────────────────────────────────
  function enterGame(data) {
    showScreen('game');
    if (typeof window.Analytics !== 'undefined') {
      window.Analytics.track('game_started', { roomCode, isHost });
    }

    // Request fullscreen immediately to hide OS system status bar
    requestAppFullscreen();

    // Also trigger on first tap if browser blocked the initial call
    const gameScreen = document.getElementById('screen-game');
    gameScreen.addEventListener('click', requestAppFullscreen, { once: true });
    // Save session so player can rejoin if they accidentally close
    localStorage.setItem('housie-session', JSON.stringify({
      roomCode,
      playerName,
      hostName,
    }));

    // Clear stale Yess claims from previous game
    UI.resetYessClaims();

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
    } else {
      // Fresh game — clear old state
      document.getElementById('current-number-text').textContent = '?';
      document.getElementById('numbers-called-count').textContent = '0/90';
      // Clear recent balls from any previous game
      const recentBalls = document.getElementById('recent-balls');
      if (recentBalls) recentBalls.innerHTML = '';
      // Clear the 1-90 number board grid
      document.querySelectorAll('.board-num').forEach((el) => {
        el.classList.remove('called', 'latest');
      });
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
          // Never disable Full House — grace period allows multiple winners
          if (prizeType !== 'fullHouse') {
            GameRenderer.disableClaim(prizeType, winners[0].playerName);
          }
        }
      });
    }
    // Initialize mascot (deferred to avoid const TDZ)
    setTimeout(() => Mascot.init(), 0);
  }

  // ── Mascot System ──────────────────────────────────────────────
  const Mascot = (() => {
    const bubble = () => document.getElementById('mascot-bubble');
    const wrap = () => document.getElementById('mascot-wrap');
    let lastMessage = '';
    let clickIndex = 0;

    // ── Message pools (NO "lucky" or similar) ──
    const msgs = {
      start: [
        "Let's goooo! 🔥", "Game time! 💪", "Show 'em what you got!", "Here we go! 🎉",
        "Focus mode: ON 🧠", "You ready? I'm ready! 🎯", "This is gonna be epic!",
      ],
      slow: [
        "Slow start huh? 🐢", "Patience is a virtue 🧘", "Don't sweat it!",
        "The board is warming up...", "Relax, it's just getting started 😌",
        "Numbers will come, trust me 😎", "Easy now, easy... 🫖",
        "The good numbers are coming!", "Think of it as... suspense 🎬",
        "Jai jai number hoi la jen ei lar 🐌",
      ],
      mid: [
        "Now we're cooking! 🍳", "Getting there! 💫", "Nice pace you've got! 🚀",
        "Keep going, keep going!", "You're on a roll! 🎲", "Ooh things are heating up 🌡️",
        "Halfway hero vibes 🦸", "Not bad, not bad at all 👏",
      ],
      good: [
        "Woah you're flying! ✈️", "This is YOUR game! 💪", "Can't stop won't stop!",
        "The board fears you 😈", "You're built different 🔥", "Crushing it! 🏆",
        "Someone's on fire! 🧯", "Look at you go! 🏃‍♂️",
        "Nga lah kynruh bha wain! 🔥",
      ],
      almostThere: [
        "SO CLOSE! Don't breathe! 😱", "ALMOST THERE!! 🤯", "I can taste it! 👅",
        "Two more... just two! ✌️", "The finish line is RIGHT THERE!",
        "My tentacles are tingling! 🐙", "HOLD ON HOLD ON!! 😤",
      ],
      oneLeft: [
        "ONE MORE! ONE MORE! 😱🔥", "I CAN'T LOOK! 🙈", "DON'T. BLINK. 👁️",
        "THIS IS IT!! 🚨", "My heart can't take this! 💓",
        "The moment of truth! ⚡", "COME ONNNN! 🤞",
      ],
      fullHouse: [
        "YESSSSS!! 🎉🎉🎉", "YOU DID IT!! 👑", "ABSOLUTE LEGEND! 🏆",
        "THE CROWD GOES WILD! 🎪", "Take a bow! 🎭",
      ],
      someoneClaimed: [
        "That could've been you 😅", "Oof, next time! 💪", "It's okay, Full House is bigger!",
        "Stay focused, eyes on the prize 👀", "Don't worry, your time is coming!",
        "Shake it off! 🐕", "One less thing to worry about!",
      ],
      manyDrawn: [
        "This game is getting spicy! 🌶️", "We're deep in it now 🏊", "End game approaching...",
        "The pool is thinning! 🎱", "Every number counts now!",
        "It's getting real! 😤", "Final stretch energy 🏁",
      ],
      click: [
        "I believe in you! 💪", "Stay sharp! 🔪", "You got this! 🫵",
        "Keep those eyes peeled! 👀", "Big things coming! 🚀",
        "I'm rooting for you! 📣", "Vibes are immaculate ✨",
        "Manifesting your win 🧘", "Plot armor activated 🛡️",
        "Main character energy! 🎬", "Trust the process 🔄",
        "Built different! 🧱", "No cap, you're killing it 🧢",
        "Big brain plays only 🧠", "Elite gamer moment 🎮",
        "Your time is NOW! ⏰", "Legend in the making! 📖",
        "Absolute cinema! 🎥", "Sending positive vibes ~~~",
        "I see greatness ahead! 🔮", "Goosebumps! 🪿",
      ],
    };

    function pick(arr) {
      let msg;
      do { msg = arr[Math.floor(Math.random() * arr.length)]; } while (msg === lastMessage && arr.length > 1);
      lastMessage = msg;
      return msg;
    }

    function show(text) {
      const b = bubble();
      if (!b) return;
      b.textContent = text;
      // Re-trigger animation by removing and re-adding class
      b.classList.remove('visible');
      void b.offsetHeight; // force reflow
      b.classList.add('visible');
    }

    /** Get a context-aware message based on game state */
    function getContextMessage() {
      const progress = GameRenderer.getProgress();
      const drawn = GameRenderer.getDrawnCount();
      const best = progress.best;

      if (best === 15) return pick(msgs.fullHouse);
      if (best === 14) return pick(msgs.oneLeft);
      if (best >= 12) return pick(msgs.almostThere);
      if (drawn >= 60) return pick(msgs.manyDrawn);
      if (best >= 8) return pick(msgs.good);
      if (best >= 4) return pick(msgs.mid);
      if (drawn >= 5) return pick(msgs.slow);
      return pick(msgs.start);
    }

    function init() {
      const w = wrap();
      if (!w) return;

      // Click handler — cycle through random click messages
      w.addEventListener('click', () => {
        clickIndex++;
        // Every 3rd click show a context-aware message, otherwise random
        if (clickIndex % 3 === 0) {
          show(getContextMessage());
        } else {
          show(pick(msgs.click));
        }
      });

      // Show starting message
      show(pick(msgs.start));
    }

    /** Called when someone else claims a prize */
    function onOtherClaimed() {
      show(pick(msgs.someoneClaimed));
    }

    return { init, show, getContextMessage, onOtherClaimed, pick, msgs };
  })();

  // ── Game Start Countdown Overlay ─────────────────────────────────
  let gameCountdownTimer = null;

  function showGameCountdown() {
    const overlay = document.getElementById('game-countdown-overlay');
    const numEl = document.getElementById('game-countdown-number');
    if (!overlay || !numEl) return;

    overlay.classList.remove('hidden');
    let seconds = 8;
    numEl.textContent = seconds;
    if (typeof UI !== 'undefined' && UI.playCountdownTick) {
      UI.playCountdownTick(8);
    }

    gameCountdownTimer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(gameCountdownTimer);
        gameCountdownTimer = null;
        if (typeof UI !== 'undefined' && UI.playCountdownTick) {
          UI.playCountdownTick(0);
        }
        overlay.classList.add('hidden');
      } else {
        numEl.textContent = seconds;
        if (typeof UI !== 'undefined' && UI.playCountdownTick) {
          UI.playCountdownTick(seconds);
        }
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

    // Players panel — toggle drawer
    const playersPanel = document.getElementById('game-panel-right');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    if (toggleBtn && playersPanel) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playersPanel.classList.toggle('expanded');
      });
    }
    if (playersPanel) {
      playersPanel.addEventListener('click', (e) => {
        if (!playersPanel.classList.contains('expanded')) {
          playersPanel.classList.add('expanded');
        }
      });
    }
    document.querySelector('.game-panel-center')?.addEventListener('click', () => {
      if (playersPanel) playersPanel.classList.remove('expanded');
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

        // Full House: silently ignore if no ticket has all 15 numbers marked
        if (prizeType === 'fullHouse') {
          const tickets = GameRenderer.getTickets();
          let hasFullHouse = false;
          tickets.forEach((_, i) => {
            const grid = document.getElementById(`ticket-grid-${i}`);
            if (grid && grid.querySelectorAll('.ticket-cell.marked').length >= 15) {
              hasFullHouse = true;
            }
          });
          if (!hasFullHouse) {
            // Subtle shake to indicate "not yet" — no error toast
            btn.classList.add('shake');
            setTimeout(() => btn.classList.remove('shake'), 450);
            return;
          }
        }

        btn.disabled = true;

        // Support mock/demo mode only (localhost) — NOT real games
        const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        const isMockHash = location.hash === '#mock' || location.search.includes('mock') || (isLocalhost && location.hash === '#game');
        const isMockMode = isMockHash && (!socket || !socket.connected);
        if (isMockMode) {
          UI.recordYessClaim(playerName || 'Rahul', playerId || 'mock-0');
          UI.showToast('🎉 YESSS!! Claimed!', 'success');
          return;
        }

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
      showLeaveModal(() => {
        localStorage.removeItem('housie-session');
        socket.emit('leave-room', { roomCode });
        resetState();
        showScreen('home');
      });
    });

    // Emit progress whenever a number is marked + update mascot
    GameRenderer.setOnMark((ticketIdx, markedCount) => {
      // Progress to server
      if (roomCode) {
        const tickets = GameRenderer.getTickets();
        const ticketCounts = tickets.map((_, i) => {
          const grid = document.getElementById(`ticket-grid-${i}`);
          return grid ? grid.querySelectorAll('.ticket-cell.marked').length : 0;
        });
        socket.emit('player-progress', { roomCode, ticketCounts });
      }
      // Mascot milestone reactions
      if (markedCount === 14) Mascot.show(Mascot.pick(Mascot.msgs.oneLeft));
      else if (markedCount === 13 || markedCount === 12) Mascot.show(Mascot.pick(Mascot.msgs.almostThere));
      else if (markedCount === 8 || markedCount === 10) Mascot.show(Mascot.pick(Mascot.msgs.good));
      else if (markedCount === 5) Mascot.show(Mascot.pick(Mascot.msgs.mid));
    });
  }

  // ── Results Screen ────────────────────────────────────────────
  function showResults(winners) {
    showScreen('results');
    UI.launchConfetti(80);
    if (typeof window.Analytics !== 'undefined') {
      window.Analytics.track('game_completed', { roomCode });
    }

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
      const btn = document.getElementById('btn-play-again');
      setLoading(btn, true);
      socket.emit('play-again', { roomCode }, (response) => {
        setLoading(btn, false);
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
      // Always re-render with the authoritative server list
      UI.renderPlayerList(data.players);



      if (isHost) {
        document.getElementById('btn-start-game').disabled = data.playerCount < 2;
      }
    });

    socket.on('player-left', (data) => {
      UI.renderPlayerList(data.players);

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
      // Acknowledge receipt so server stops retrying
      socket.emit('game-ack', { roomCode });

      // Ignore if we're already on the game screen (duplicate from retry)
      if (currentScreen === 'game') return;

      isHost = data.isHost;
      enterGame(data);
      UI.showToast('Game started! 🎉', 'success');
    });

    // Special mascot messages for specific numbers (can be single string or array)
    const numberQuips = {
      1: "Tang in wei! ☝️",
      2: "Two for the show! ✌️",
      3: "Hat-trick incoming! 🎩⚽",
      4: "Fantastic Four! 🦸‍♂️",
      5: "High five! 🖐️",
      7: ["suuuiiiiii", "Inshallah... hehehe SIUUU!"],
      8: "Infinite possibilities! ♾️",
      9: ["I am Zlatan! 🦁", "R9 El Fenomeno! ⚡"],
      10: ["messi is not the goat dei u ronaldo", "Qué mirás, bobo? Anda pa allá! 👀"],
      11: ["I have nussing to say! 🤫", "Eleven on the pitch! ⚽"],
      12: "12th Man in the stands! 📢",
      13: "Unlucky for who? Not you! 🍀",
      14: "Cruyff turn masterclass! 🔄",
      15: "Full house count! 15! 🏠",
      17: "De Bruyne let me talk! 🗣️",
      18: "Legal age to win big! 🔞🎉",
      20: "Perfect 20/20 vision! 👓",
      21: "Blackjack! 🃏",
      22: "Ar tylli ki han, 22! ✌️✌️",
      23: "Jordan mode: activated! 🏀",
      25: "Silver Jubilee! 🥈",
      30: "Dirty thirty! 🔥",
      33: "Rolling doubles! 🎲",
      40: "Life begins at 40! ✨",
      44: "Double four on the door! 🚪",
      45: "Why Always Me? 👕😏",
      50: "Half century! 🏏",
      55: "ar ngut ki pasan 55",
      60: "An hour into the match! ⏱️",
      66: "Corner taken quickly! 🎯",
      69: "Nice. 😏",
      70: "Lucky seven zero! ✨",
      77: "Double lucky seven! 🎰",
      80: "Ronaldinho joga bonito! 🤙✨",
      88: "ar ngut ki mem sngaid 88",
      89: "1 away from the end! ⏳",
      90: ["Fergie time! 90 mins! ⏱️🔥", "Top of the shop! 90! 🏁"],
    };

    socket.on('number-drawn', (data) => {
      GameRenderer.markNumber(data.number);
      UI.updateNumberBoard(data.drawnNumbers, data.number);
      UI.updateRecentBalls(data.drawnNumbers);
      TTS.announceNumber(data.number);
      // Mascot reacts to first drawn number or special numbers
      if (data.drawnNumbers && data.drawnNumbers.length === 1) {
        Mascot.show(`u number ba mih nyngkong dei u ${data.number}`);
      } else if (numberQuips[data.number]) {
        const quip = numberQuips[data.number];
        const msg = Array.isArray(quip) ? quip[Math.floor(Math.random() * quip.length)] : quip;
        Mascot.show(msg);
      }
    });

    socket.on('prize-claimed', (data) => {
      // Don't disable Full House — grace period allows multiple winners
      if (data.prizeType !== 'fullHouse') {
        GameRenderer.disableClaim(data.prizeType, data.winnerName);
      }
      UI.recordYessClaim(data.winnerName, data.playerId);
      UI.showPrizeAnnouncement(data.message, 3500);
      Mascot.onOtherClaimed();
    });

    // Full House grace period — big blinking countdown overlay
    let graceInterval = null;
    socket.on('full-house-grace', (data) => {
      let remaining = data.seconds;

      // Create or reuse the countdown overlay
      let overlay = document.getElementById('grace-countdown-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'grace-countdown-overlay';
        overlay.className = 'grace-countdown-overlay';
        const center = document.querySelector('.game-panel-center') || document.querySelector('.game-content');
        if (center) center.appendChild(overlay);
      }

      function updateOverlay() {
        overlay.innerHTML = `<div class="grace-countdown-number">${remaining}</div>`;
        overlay.style.display = 'flex';
        // Re-trigger the pulse animation
        const num = overlay.querySelector('.grace-countdown-number');
        if (num) {
          num.style.animation = 'none';
          void num.offsetHeight;
          num.style.animation = '';
        }
      }

      updateOverlay();

      graceInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(graceInterval);
          graceInterval = null;
          if (overlay) overlay.remove();
          return;
        }
        updateOverlay();
      }, 1000);
    });

    socket.on('game-over', (data) => {
      if (graceInterval) clearInterval(graceInterval);
      stopCountdown();
      localStorage.removeItem('housie-session');

      // Remove grace overlay if present
      const graceOverlay = document.getElementById('grace-countdown-overlay');
      if (graceOverlay) graceOverlay.remove();

      // Show big "TARR NOH KI SLIP!" shredding overlay
      const shredOverlay = document.createElement('div');
      shredOverlay.className = 'shred-overlay';
      shredOverlay.innerHTML = `
        <div class="shred-content">
          <div class="shred-emoji">📋✂️</div>
          <div class="shred-text">TARR NOH KI SLIP!</div>
          <div class="shred-sub">Game Over!</div>
        </div>
        <div class="shred-strips">
          <div class="shred-strip"></div>
          <div class="shred-strip"></div>
          <div class="shred-strip"></div>
          <div class="shred-strip"></div>
          <div class="shred-strip"></div>
        </div>
      `;
      document.getElementById('screen-game').appendChild(shredOverlay);
      void shredOverlay.offsetHeight;
      shredOverlay.classList.add('active');

      setTimeout(() => {
        shredOverlay.remove();
        showResults(data.winners);
      }, 3500);
    });

    socket.on('game-reset', (data) => {
      // Reset ALL game UI state for a fresh round
      UI.resetYessClaims();

      // Clear the 1-90 number board grid
      document.querySelectorAll('.board-num').forEach((el) => {
        el.classList.remove('called', 'latest');
      });

      // Clear recent balls strip
      const recentBalls = document.getElementById('recent-balls');
      if (recentBalls) recentBalls.innerHTML = '';

      // Reset current number display
      const numText = document.getElementById('current-number-text');
      if (numText) numText.textContent = '?';
      const numCount = document.getElementById('numbers-called-count');
      if (numCount) numCount.textContent = '0/90';

      // Clear leaderboard / players ribbon
      const ribbon = document.getElementById('players-ribbon');
      if (ribbon) ribbon.innerHTML = '';
      const countEl = document.getElementById('players-count-num');
      if (countEl) countEl.textContent = '0';

      // Clear saved marked numbers from previous game
      GameRenderer.clearMarkedNumbers();

      // Go to lobby
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

    // Handle player online/offline status from server — silent ribbon update, no toast
    socket.on('player-status', (data) => {
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
        deviceId,
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

  // ── Leave Game Modal ────────────────────────────────────────────
  function showLeaveModal(onConfirm) {
    // Remove existing modal if any
    const existing = document.getElementById('leave-modal-overlay');
    if (existing) existing.remove();

    const funMessages = [
      "The octopus will miss you! 🐙",
      "Your numbers are still waiting! 🎱",
      "But Full House is so close! 🏠",
      "Don't leave the party now! 🎉",
      "The game won't be the same without you! 😢",
      "Are you really leaving mid-game? 🫠",
    ];
    const msg = funMessages[Math.floor(Math.random() * funMessages.length)];

    const overlay = document.createElement('div');
    overlay.id = 'leave-modal-overlay';
    overlay.className = 'leave-modal-overlay';
    overlay.innerHTML = `
      <div class="leave-modal">
        <div class="leave-modal-emoji">😢</div>
        <div class="leave-modal-title">Leave Game?</div>
        <div class="leave-modal-msg">${msg}</div>
        <div class="leave-modal-btns">
          <button class="leave-modal-btn stay" id="leave-modal-stay">Stay 💪</button>
          <button class="leave-modal-btn leave" id="leave-modal-leave">Leave</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Force reflow then show
    void overlay.offsetHeight;
    overlay.classList.add('visible');

    document.getElementById('leave-modal-stay').addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 250);
    });

    document.getElementById('leave-modal-leave').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 250);
      }
    });
  }

  // ── Browser Back Button ─────────────────────────────────────────
  window.addEventListener('popstate', (e) => {
    if (currentScreen === 'game') {
      e.preventDefault();
      history.pushState(null, '', ''); // re-push state to prevent navigation
      showLeaveModal(() => {
        localStorage.removeItem('housie-session');
        if (socket && roomCode) socket.emit('leave-room', { roomCode });
        resetState();
        showScreen('home');
      });
    }
  });
  // Push initial state so we can intercept back
  history.pushState(null, '', '');

  // ── Helpers ────────────────────────────────────────────────────
  function resetState() {
    roomCode = null;
    playerId = null;
    isHost = false;
  }

  // ── Dev Mock Mode ──────────────────────────────────────────────
  function loadMockGame() {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
    const isMock = location.hash === '#game' || location.hash === '#mock' || location.hash === '#lobby' || location.search.includes('mock');
    if (!isMock) return false;

    // Mock lobby mode
    if (location.hash === '#lobby') {
      const mockNames = [
        'Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Neha', 'Arjun', 'Pooja',
        'Karan', 'Divya', 'Rohit', 'Meera', 'Sanjay', 'Anjali', 'Deepak', 'Kavita',
        'Manish', 'Ritu', 'Suresh', 'Nisha', 'Anil', 'Swati', 'Rajesh', 'Simran',
        'Vivek', 'Tanvi', 'Gaurav', 'Isha', 'Nikhil', 'Megha'
      ];
      let mockPlayers = mockNames.map((name, i) => ({ id: `mock-${i}`, name, isHost: i === 0 }));
      enterLobby({ players: mockPlayers });

      // Simulate churn: every 2s, remove 1-2 and add 1-2
      let counter = 0;
      setInterval(() => {
        if (currentScreen !== 'lobby') return;
        const removeCount = Math.random() > 0.5 ? 2 : 1;
        for (let i = 0; i < removeCount && mockPlayers.length > 5; i++) {
          const idx = 1 + Math.floor(Math.random() * (mockPlayers.length - 1));
          mockPlayers.splice(idx, 1);
        }
        const addCount = Math.random() > 0.4 ? 2 : 1;
        const extra = ['Zara', 'Dev', 'Komal', 'Sahil', 'Riya', 'Aman', 'Tina', 'Jay'];
        for (let i = 0; i < addCount && mockPlayers.length < 35; i++) {
          counter++;
          mockPlayers.push({ id: `new-${counter}`, name: extra[counter % extra.length] + counter, isHost: false });
        }
        UI.renderPlayerList(mockPlayers);
      }, 2000);
      return true;
    }

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

    // Make 1 mock player already have claimed Yess (e.g. Swati) so user immediately sees it
    const mockWinner1 = mockPlayers.find(p => p.name === 'Swati') || mockPlayers[1];
    if (mockWinner1) {
      mockWinner1.hasClaimedYess = true;
      UI.recordYessClaim(mockWinner1.name, mockWinner1.id);
    }

    // Sort by Yess claims first, then most marked
    mockPlayers.sort((a, b) => {
      if (a.hasClaimedYess && !b.hasClaimedYess) return -1;
      if (!a.hasClaimedYess && b.hasClaimedYess) return 1;
      return b.bestMarked - a.bestMarked;
    });

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

    // Simulate a 2nd mock player claiming Yess after 8 seconds
    setTimeout(() => {
      const mockWinner2 = mockPlayers.find(p => p.id !== 'mock-0' && !p.hasClaimedYess);
      if (mockWinner2) {
        mockWinner2.hasClaimedYess = true;
        UI.recordYessClaim(mockWinner2.name, mockWinner2.id);
        UI.renderPlayersRibbon(mockPlayers, playerId);
      }
    }, 8000);

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

      // Re-sort: Yess claims first, then closest to winning
      mockPlayers.sort((a, b) => {
        if (a.hasClaimedYess && !b.hasClaimedYess) return -1;
        if (!a.hasClaimedYess && b.hasClaimedYess) return 1;
        return b.bestMarked - a.bestMarked;
      });

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
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Check for updates every 30 seconds (frequent so stale code is caught quickly)
        setInterval(() => { reg.update().catch(() => {}); }, 30 * 1000);

        /**
         * Handle a detected SW update:
         * - If NOT on the game screen → reload immediately to get fresh code
         * - If ON the game screen → flag for reload at next screen transition
         */
        function handleUpdate() {
          if (currentScreen !== 'game') {
            window.location.reload();
          } else {
            _pendingUpdate = true;
          }
        }

        // When a new SW is found and activated
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                handleUpdate();
              }
            });
          }
        });
      }).catch(() => {});

      // Listen for SW_UPDATED message
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SW_UPDATED') {
          if (currentScreen !== 'game') {
            window.location.reload();
          } else {
            _pendingUpdate = true;
          }
        }
      });
    }
  });
})();
