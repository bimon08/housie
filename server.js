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
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms
const rooms = new Map(); // roomCode -> Room instance

// Map socket IDs to room codes for cleanup
const playerRooms = new Map(); // socketId -> roomCode

// Auto-draw timers per room
const autoDrawTimers = new Map(); // roomCode -> intervalId

// Full House grace period timers
const fullHouseTimers = new Map(); // roomCode -> timeoutId

const AUTO_DRAW_INTERVAL = 8000; // 8 seconds between draws

/**
 * Start auto-drawing numbers for a room.
 */
function startAutoDraw(roomCode) {
  stopAutoDraw(roomCode); // Clear any existing timer

  // 8-second delay before first draw (matches the client overlay countdown)
  const initialDelay = setTimeout(() => {
    const drawFn = () => {
      const room = rooms.get(roomCode);
      if (!room || !room.gameInProgress || room.game.finished) {
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
    // Then draw every 5 seconds
    const interval = setInterval(drawFn, AUTO_DRAW_INTERVAL);
    autoDrawTimers.set(roomCode, interval);
  }, 8000);

  // Store the initial delay timer so it can be cancelled
  autoDrawTimers.set(roomCode, initialDelay);
}

/**
 * Stop auto-drawing for a room.
 */
function stopAutoDraw(roomCode) {
  const timer = autoDrawTimers.get(roomCode);
  if (timer) {
    clearInterval(timer);
    autoDrawTimers.delete(roomCode);
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
  socket.on('create-room', ({ playerName, ticketCount }, callback) => {
    const code = generateRoomCode();
    const room = new Room(code, socket.id, playerName, ticketCount || 2);
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
  socket.on('join-room', ({ roomCode, playerName }, callback) => {
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ success: false, message: 'Room not found!' });
      return;
    }

    const result = room.addPlayer(socket.id, playerName);
    if (!result.success) {
      callback({ success: false, message: result.message });
      return;
    }

    playerRooms.set(socket.id, roomCode);
    socket.join(roomCode);

    callback({
      success: true,
      playerId: socket.id,
      players: room.getPlayerList(),
      ticketCount: room.ticketCount,
      hostName: room.players.get(room.hostId)?.name || 'Host',
      isHost: false,
    });

    // Notify others
    socket.to(roomCode).emit('player-joined', {
      playerName,
      playerCount: room.players.size,
      players: room.getPlayerList(),
    });

    console.log(`${playerName} joined room ${roomCode}`);
  });

  // ── Rejoin Room (reconnect after accidental close) ──
  socket.on('rejoin-room', ({ roomCode, playerName }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ success: false, message: 'Room no longer exists.' });
      return;
    }

    const result = room.rejoinPlayer(socket.id, playerName);
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
      // Broadcast prize claim to all players
      io.to(roomCode).emit('prize-claimed', {
        prizeType: result.prizeType,
        winnerName: result.winnerName,
        message: result.message,
      });

      // Full House grace period — 30s for others to also claim
      if (prizeType === 'fullHouse' && !fullHouseTimers.has(roomCode)) {
        stopAutoDraw(roomCode);

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
  });
  // ── Player Mark Progress ──
  socket.on('player-progress', ({ roomCode, ticketCounts }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    // Store per-ticket marked counts (e.g. [12, 9])
    player.ticketCounts = ticketCounts;

    // Build leaderboard sorted by most marked (closest to winning)
    const leaderboard = [];
    for (const [id, p] of room.players) {
      const counts = p.ticketCounts || [];
      const bestMarked = counts.length > 0 ? Math.max(...counts) : 0;
      leaderboard.push({ id, name: p.name, isHost: id === room.hostId, ticketCounts: counts, bestMarked });
    }
    leaderboard.sort((a, b) => b.bestMarked - a.bestMarked);

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

      // If game is in progress, give them a grace period to reconnect
      if (room && room.gameInProgress) {
        const player = room.players.get(socket.id);
        if (player) {
          player.disconnected = true;
          player.disconnectedAt = Date.now();
          console.log(`Player ${player.name} disconnected from room ${roomCode} — 2min grace period`);

          // Notify others that player went offline
          socket.to(roomCode).emit('player-status', {
            playerId: socket.id,
            playerName: player.name,
            online: false,
            players: room.getPlayerList(),
          });

          // Grace period: remove after 2 minutes if they don't reconnect
          const graceTimer = setTimeout(() => {
            // Check if still disconnected (they might have rejoined)
            const currentPlayer = room.players.get(socket.id);
            if (currentPlayer && currentPlayer.disconnected) {
              handlePlayerLeave(socket, roomCode);
              console.log(`Grace period expired for ${player.name} in room ${roomCode}`);
            }
          }, 2 * 60 * 1000); // 2 minutes

          // Store timer so we can clear it on rejoin
          if (!room._graceTimers) room._graceTimers = new Map();
          room._graceTimers.set(socket.id, graceTimer);
        } else {
          handlePlayerLeave(socket, roomCode);
        }
      } else {
        // No active game — remove immediately
        handlePlayerLeave(socket, roomCode);
      }
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
