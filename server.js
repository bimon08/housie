/**
 * Housie (Tambola) Multiplayer Game Server
 *
 * Express serves static files from public/
 * Socket.io handles real-time game communication
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Room = require('./game/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,  // ping every 25s (default, mobile-friendly)
  pingTimeout: 15000,   // wait 15s for pong (tolerates bad networks, tab switches)
});

// ── Crash Protection ────────────────────────────────────────────
// Prevent the server from crashing on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (keeps Render free tier alive)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

// Config endpoint for client analytics
app.get('/api/config', (req, res) => {
  res.json({
    posthogKey: process.env.POSTHOG_KEY || process.env.PUBLIC_POSTHOG_KEY || '',
    posthogHost: process.env.POSTHOG_HOST || process.env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
  });
});

// Store active rooms
const rooms = new Map(); // roomCode -> Room instance

// Map socket IDs to room codes for cleanup
const playerRooms = new Map(); // socketId -> roomCode

// Auto-draw timers per room
// Each entry: { delay: timeoutId|null, interval: intervalId|null, stopped: boolean }
const autoDrawTimers = new Map(); // roomCode -> timer state

// Full House grace period timers
const fullHouseTimers = new Map(); // roomCode -> timeoutId

const AUTO_DRAW_INTERVAL = 6000; // 6 seconds between draws

/**
 * Start auto-drawing numbers for a room.
 */
function startAutoDraw(roomCode) {
  stopAutoDraw(roomCode); // Clear any existing timer

  const timerState = { delay: null, interval: null, stopped: false };
  autoDrawTimers.set(roomCode, timerState);

  // 8-second delay before first draw (matches the client overlay countdown)
  timerState.delay = setTimeout(() => {
    // If stopAutoDraw was called during the delay, don't start the interval
    if (timerState.stopped) return;

    const drawFn = () => {
      const room = rooms.get(roomCode);
      if (!room || !room.gameInProgress || room.game.finished) {
        console.log(`[AutoDraw] Stopping for ${roomCode}: room gone or game finished`);
        stopAutoDraw(roomCode);
        return;
      }

      // Safety net: stop drawing if Full House was already claimed
      if (room.game.fullHouseClaimed) {
        console.log(`[AutoDraw] Stopping for ${roomCode}: Full House already claimed`);
        stopAutoDraw(roomCode);
        return;
      }

      const result = room.autoDraw();
      if (!result.success) {
        stopAutoDraw(roomCode);
        return;
      }

      io.to(roomCode).emit('number-drawn', {
        number: result.number,
        drawnNumbers: result.drawnNumbers,
        remaining: result.remaining,
      });
    };

    // Draw first number immediately after countdown
    drawFn();
    // Then draw every 7 seconds
    if (!timerState.stopped) {
      timerState.interval = setInterval(drawFn, AUTO_DRAW_INTERVAL);
    }
  }, 8000);
}

/**
 * Stop auto-drawing for a room.
 */
function stopAutoDraw(roomCode) {
  const timerState = autoDrawTimers.get(roomCode);
  if (timerState) {
    console.log(`[AutoDraw] stopAutoDraw(${roomCode}): clearing delay=${!!timerState.delay} interval=${!!timerState.interval}`);
    timerState.stopped = true;
    if (timerState.delay) {
      clearTimeout(timerState.delay);
      timerState.delay = null;
    }
    if (timerState.interval) {
      clearInterval(timerState.interval);
      timerState.interval = null;
    }
    autoDrawTimers.delete(roomCode);
  } else {
    console.log(`[AutoDraw] stopAutoDraw(${roomCode}): no timer found (already stopped or never started)`);
  }
}

/**
 * Generate a unique 4-digit room code.
 */
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));
  return code;
}

// ─── Socket.io Event Handling ────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // ── Create Room ──
  socket.on('create-room', ({ playerName, ticketCount, deviceId }, callback) => {
    const code = generateRoomCode();
    const room = new Room(code, socket.id, playerName, ticketCount || 2);
    // Store deviceId on host
    const host = room.players.get(socket.id);
    if (host) host.deviceId = deviceId || null;
    rooms.set(code, room);
    playerRooms.set(socket.id, code);

    socket.join(code);

    callback({
      success: true,
      roomCode: code,
      playerId: socket.id,
      players: room.getPlayerList(),
      ticketCount: room.ticketCount,
      hostName: playerName,
    });

    console.log(`Room ${code} created by ${playerName}`);
  });

  // ── Join Room ──
  socket.on('join-room', ({ roomCode, playerName, deviceId }, callback) => {
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, message: 'Room not found!' });
      return;
    }

    const result = room.addPlayer(socket.id, playerName, deviceId);
    if (!result.success) {
      callback({ success: false, message: result.message });
      return;
    }

    // If a stale socket was replaced (same device reconnected), clean it up
    if (result.replacedSocketId) {
      const oldSocketId = result.replacedSocketId;
      playerRooms.delete(oldSocketId);
      // Remove old socket from the Socket.io room
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.leave(roomCode);
      }
      // Clear any grace timer from the old socket
      if (room._graceTimers && room._graceTimers.has(oldSocketId)) {
        clearTimeout(room._graceTimers.get(oldSocketId));
        room._graceTimers.delete(oldSocketId);
      }
      console.log(`Replaced stale socket ${oldSocketId} for device ${deviceId} in room ${roomCode}`);
    }

    // Mark as online (in case they were disconnected)
    const player = room.players.get(socket.id);
    if (player) {
      player.disconnected = false;
      delete player.disconnectedAt;
    }

    playerRooms.set(socket.id, roomCode);
    socket.join(roomCode);

    const playerList = room.getPlayerList();

    callback({
      success: true,
      playerId: socket.id,
      players: playerList,
      ticketCount: room.ticketCount,
      hostName: room.players.get(room.hostId)?.name || 'Host',
      isHost: false,
    });

    // Notify ALL clients in the room (including sender) with authoritative player list
    // Using io.to() ensures everyone has the same count
    io.to(roomCode).emit('player-joined', {
      playerName,
      playerCount: room.players.size,
      players: playerList,
    });

    console.log(`${playerName} joined room ${roomCode} (${room.players.size} players)`);
  });

  // ── Rejoin Room (reconnect after accidental close) ──
  socket.on('rejoin-room', ({ roomCode, playerName, deviceId }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: 'Room no longer exists.' });
      return;
    }

    const result = room.rejoinPlayer(socket.id, playerName, deviceId);
    if (!result.success) {
      callback({ success: false, message: result.message });
      return;
    }

    playerRooms.set(socket.id, roomCode);
    socket.join(roomCode);

    // Notify others that player is back online
    socket.to(roomCode).emit('player-status', {
      playerId: socket.id,
      playerName,
      online: true,
      players: room.getPlayerList(),
    });

    callback({
      success: true,
      playerId: socket.id,
      tickets: result.tickets,
      drawnNumbers: result.drawnNumbers,
      prizes: result.prizes,
      isHost: result.isHost,
      players: result.players,
      hostName: room.players.get(room.hostId)?.name || 'Host',
    });

    console.log(`${playerName} rejoined room ${roomCode}`);
  });

  // ── Update Settings ──
  socket.on('update-settings', ({ roomCode, ticketCount }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.updateSettings(socket.id, ticketCount)) {
      io.to(roomCode).emit('settings-updated', {
        ticketCount: room.ticketCount,
      });
    }
  });

  // ── Check Game Status (lobby auto-join) ──
  // If a player is stuck on lobby but the game already started, this lets them catch up
  socket.on('check-game-status', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ gameInProgress: false });
      return;
    }

    if (room.gameInProgress && room.game) {
      const player = room.players.get(socket.id);
      const tickets = room.game.playerTickets && room.game.playerTickets[socket.id];
      if (player && tickets) {
        console.log(`[Lobby] ${player.name} catching up — game already in progress in room ${roomCode}`);
        callback({
          gameInProgress: true,
          tickets: tickets,
          isHost: room.isHost(socket.id),
          players: room.getPlayerList(),
          drawnNumbers: room.game.drawnNumbers,
          prizes: room.game.prizes,
        });
      } else {
        callback({ gameInProgress: false });
      }
    } else {
      callback({ gameInProgress: false });
    }
  });

  // ── Start Game ──
  socket.on('start-game', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: 'Room not found!' });
      return;
    }

    const result = room.startGame(socket.id);
    if (!result.success) {
      callback({ success: false, message: result.message });
      return;
    }

    // Send each player their own tickets
    for (const [playerId, player] of room.players) {
      const tickets = result.playerTickets[playerId];
      io.to(playerId).emit('game-started', {
        tickets,
        isHost: room.isHost(playerId),
        players: room.getPlayerList(),
        prizes: room.game.prizes,
      });
    }

    callback({ success: true });
    console.log(`Game started in room ${roomCode}`);

    // Start auto-draw timer (5 second interval, first draw after 5 seconds)
    startAutoDraw(roomCode);
  });

  // ── Draw Number (kept for manual fallback but not used in normal flow) ──
  socket.on('draw-number', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: 'Room not found!' });
      return;
    }

    const result = room.drawNumber(socket.id);
    if (!result.success) {
      callback({ success: false, message: result.message });
      return;
    }

    io.to(roomCode).emit('number-drawn', {
      number: result.number,
      drawnNumbers: result.drawnNumbers,
      remaining: result.remaining,
    });

    callback({ success: true, number: result.number });
  });

  // ── Claim Prize ──
  socket.on('claim-prize', ({ roomCode, prizeType, ticketIndex }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ valid: false, message: 'Room not found!' });
      return;
    }

    const result = room.claimPrize(socket.id, prizeType, ticketIndex);
    callback(result);

    if (result.valid) {
      const player = room.players.get(socket.id);
      if (player) player.hasClaimedYess = true;

      console.log(`[Claim] ${player?.name} claimed ${prizeType} (valid) in room ${roomCode}`);

      // Broadcast prize claim to all players
      io.to(roomCode).emit('prize-claimed', {
        prizeType: result.prizeType,
        winnerName: result.winnerName,
        playerId: socket.id,
        message: result.message,
      });

      // Broadcast updated leaderboard with hasClaimedYess status
      const leaderboard = [];
      for (const [id, p] of room.players) {
        const counts = p.ticketCounts || [];
        const bestMarked = counts.length > 0 ? Math.max(...counts) : 0;
        leaderboard.push({
          id,
          name: p.name,
          isHost: id === room.hostId,
          ticketCounts: counts,
          bestMarked,
          hasClaimedYess: !!p.hasClaimedYess,
        });
      }
      leaderboard.sort((a, b) => {
        if (a.hasClaimedYess && !b.hasClaimedYess) return -1;
        if (!a.hasClaimedYess && b.hasClaimedYess) return 1;
        return b.bestMarked - a.bestMarked;
      });
      io.to(roomCode).emit('leaderboard-update', { leaderboard });

      // Full House: ALWAYS stop auto-draw immediately
      if (prizeType === 'fullHouse') {
        console.log(`[Claim] Full House claimed — stopping auto-draw for room ${roomCode}`);
        stopAutoDraw(roomCode);

        // Start grace period only once (first Full House claim)
        if (!fullHouseTimers.has(roomCode)) {
          // Notify all players about the grace period
          io.to(roomCode).emit('full-house-grace', {
            winnerName: result.winnerName,
            seconds: 10,
          });

          const timer = setTimeout(() => {
            fullHouseTimers.delete(roomCode);
            const r = rooms.get(roomCode);
            if (r && r.game) {
              r.game.finishGame();
              io.to(roomCode).emit('game-over', {
                winners: r.game.getWinners(),
              });
            }
          }, 10000);

          fullHouseTimers.set(roomCode, timer);
        }
      }
    }
  });

  // ── Player Mark Progress ──
  socket.on('player-progress', ({ roomCode, ticketCounts }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    // Store per-ticket marked counts (e.g. [12, 9])
    player.ticketCounts = ticketCounts;

    // Build leaderboard sorted by Yess claims first, then most marked
    const leaderboard = [];
    for (const [id, p] of room.players) {
      const counts = p.ticketCounts || [];
      const bestMarked = counts.length > 0 ? Math.max(...counts) : 0;
      leaderboard.push({
        id,
        name: p.name,
        isHost: id === room.hostId,
        ticketCounts: counts,
        bestMarked,
        hasClaimedYess: !!p.hasClaimedYess,
      });
    }
    leaderboard.sort((a, b) => {
      if (a.hasClaimedYess && !b.hasClaimedYess) return -1;
      if (!a.hasClaimedYess && b.hasClaimedYess) return 1;
      return b.bestMarked - a.bestMarked;
    });

    io.to(roomCode).emit('leaderboard-update', { leaderboard });
  });

  // ── Play Again ──
  socket.on('play-again', ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: 'Room not found!' });
      return;
    }

    if (room.resetGame(socket.id)) {
      stopAutoDraw(roomCode);
      io.to(roomCode).emit('game-reset', {
        players: room.getPlayerList(),
        ticketCount: room.ticketCount,
      });
      callback({ success: true });
    } else {
      callback({ success: false, message: 'Only the host can restart!' });
    }
  });

  // ── Leave Room ──
  socket.on('leave-room', ({ roomCode }) => {
    handlePlayerLeave(socket, roomCode);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const roomCode = playerRooms.get(socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (!room) { playerRooms.delete(socket.id); return; }

      const player = room.players.get(socket.id);
      if (!player) { handlePlayerLeave(socket, roomCode); return; }

      player.disconnected = true;
      player.disconnectedAt = Date.now();

      // Grace period: 2 minutes during game, 30 seconds in lobby
      const graceDuration = room.gameInProgress ? 2 * 60 * 1000 : 30 * 1000;
      const label = room.gameInProgress ? '2min' : '30s';
      console.log(`Player ${player.name} disconnected from room ${roomCode} — ${label} grace period`);

      // Notify others that player went offline
      socket.to(roomCode).emit('player-status', {
        playerId: socket.id,
        playerName: player.name,
        online: false,
        players: room.getPlayerList(),
      });

      // Grace period timer — remove if they don't reconnect
      const graceTimer = setTimeout(() => {
        const currentPlayer = room.players.get(socket.id);
        if (currentPlayer && currentPlayer.disconnected) {
          handlePlayerLeave(socket, roomCode);
          console.log(`Grace period expired for ${player.name} in room ${roomCode}`);
        }
      }, graceDuration);

      // Store timer so we can clear it on rejoin
      if (!room._graceTimers) room._graceTimers = new Map();
      room._graceTimers.set(socket.id, graceTimer);
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

/**
 * Handle a player leaving a room.
 */
function handlePlayerLeave(socket, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Clear any grace timer
  if (room._graceTimers && room._graceTimers.has(socket.id)) {
    clearTimeout(room._graceTimers.get(socket.id));
    room._graceTimers.delete(socket.id);
  }

  const result = room.removePlayer(socket.id);
  playerRooms.delete(socket.id);
  socket.leave(roomCode);

  if (result.isEmpty) {
    stopAutoDraw(roomCode);
    if (fullHouseTimers.has(roomCode)) {
      clearTimeout(fullHouseTimers.get(roomCode));
      fullHouseTimers.delete(roomCode);
    }
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} deleted (empty)`);
  } else {
    io.to(roomCode).emit('player-left', {
      playerName: result.name,
      playerCount: room.players.size,
      players: room.getPlayerList(),
      newHostId: result.newHostId || null,
    });
  }
}

// ─── Start Server ────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎯 Housie server running on http://localhost:${PORT}`);
});
