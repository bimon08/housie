#!/usr/bin/env node
/**
 * Comprehensive test suite for all Housie game fixes
 * Tests: Full House stop, grace periods, lobby auto-join, broadcasts, offline status
 */

const http = require('http');
const { Server } = require('socket.io');
const express = require('express');
const path = require('path');
const { io: ioClient } = require('socket.io-client');
const Room = require('./game/Room');

// ── Test Infrastructure ──────────────────────────────────────────

const PORT = 9877;
let server, io, app;
const rooms = new Map();
const playerRooms = new Map();
const autoDrawTimers = new Map();
const fullHouseTimers = new Map();
const AUTO_DRAW_INTERVAL = 300; // Fast for testing

let testsPassed = 0;
let testsFailed = 0;

function pass(name) { testsPassed++; console.log(`  ✅ ${name}`); }
function fail(name, reason) { testsFailed++; console.log(`  ❌ ${name}: ${reason}`); }

function assert(condition, name, reason = 'assertion failed') {
  if (condition) pass(name);
  else fail(name, reason);
}

// ── Server Setup (mirrors real server.js logic) ──────────────────

function startAutoDraw(roomCode) {
  stopAutoDraw(roomCode);
  const timerState = { delay: null, interval: null, stopped: false };
  autoDrawTimers.set(roomCode, timerState);
  timerState.delay = setTimeout(() => {
    if (timerState.stopped) return;
    const drawFn = () => {
      const room = rooms.get(roomCode);
      if (!room || !room.gameInProgress || room.game.finished) { stopAutoDraw(roomCode); return; }
      if (room.game.fullHouseClaimed) { stopAutoDraw(roomCode); return; }
      const result = room.autoDraw();
      if (!result.success) { stopAutoDraw(roomCode); return; }
      io.to(roomCode).emit('number-drawn', { number: result.number, drawnNumbers: result.drawnNumbers, remaining: result.remaining });
    };
    drawFn();
    if (!timerState.stopped) { timerState.interval = setInterval(drawFn, AUTO_DRAW_INTERVAL); }
  }, 100);
}

function stopAutoDraw(roomCode) {
  const timerState = autoDrawTimers.get(roomCode);
  if (timerState) {
    timerState.stopped = true;
    if (timerState.delay) { clearTimeout(timerState.delay); timerState.delay = null; }
    if (timerState.interval) { clearInterval(timerState.interval); timerState.interval = null; }
    autoDrawTimers.delete(roomCode);
  }
}

function generateRoomCode() {
  let code;
  do { code = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms.has(code));
  return code;
}

function handlePlayerLeave(socketId, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room._graceTimers && room._graceTimers.has(socketId)) {
    clearTimeout(room._graceTimers.get(socketId));
    room._graceTimers.delete(socketId);
  }
  const result = room.removePlayer(socketId);
  playerRooms.delete(socketId);
  if (result.isEmpty) {
    stopAutoDraw(roomCode);
    rooms.delete(roomCode);
  } else {
    io.to(roomCode).emit('player-left', {
      playerName: result.name, playerCount: room.players.size,
      players: room.getPlayerList(), newHostId: result.newHostId || null,
    });
  }
}

function setupServer() {
  app = express();
  const httpServer = http.createServer(app);
  io = new Server(httpServer, { cors: { origin: '*' }, pingInterval: 25000, pingTimeout: 15000 });

  io.on('connection', (socket) => {
    socket.on('create-room', ({ playerName, ticketCount, deviceId }, cb) => {
      const code = generateRoomCode();
      const room = new Room(code, socket.id, playerName, ticketCount || 2);
      rooms.set(code, room);
      playerRooms.set(socket.id, code);
      socket.join(code);
      cb({ success: true, roomCode: code, playerId: socket.id });
    });

    socket.on('join-room', ({ roomCode, playerName, deviceId }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) { cb({ success: false, message: 'Room not found!' }); return; }
      const result = room.addPlayer(socket.id, playerName, deviceId);
      if (!result.success) { cb({ success: false, message: result.message }); return; }
      if (result.replacedSocketId) {
        playerRooms.delete(result.replacedSocketId);
        if (room._graceTimers && room._graceTimers.has(result.replacedSocketId)) {
          clearTimeout(room._graceTimers.get(result.replacedSocketId));
          room._graceTimers.delete(result.replacedSocketId);
        }
      }
      const player = room.players.get(socket.id);
      if (player) { player.disconnected = false; delete player.disconnectedAt; }
      playerRooms.set(socket.id, roomCode);
      socket.join(roomCode);
      cb({ success: true, playerId: socket.id, players: room.getPlayerList(), isHost: false });
      io.to(roomCode).emit('player-joined', { playerName, playerCount: room.players.size, players: room.getPlayerList() });
    });

    socket.on('start-game', ({ roomCode }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) { cb({ success: false }); return; }
      const result = room.startGame(socket.id);
      if (!result.success) { cb(result); return; }
      for (const [pid] of room.players) {
        const tickets = result.playerTickets[pid];
        io.to(pid).emit('game-started', { tickets, isHost: room.isHost(pid), players: room.getPlayerList(), prizes: room.game.prizes });
      }
      cb({ success: true });
      startAutoDraw(roomCode);
    });

    socket.on('check-game-status', ({ roomCode }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) { cb({ gameInProgress: false }); return; }
      if (room.gameInProgress && room.game) {
        const player = room.players.get(socket.id);
        const tickets = room.game.playerTickets && room.game.playerTickets[socket.id];
        if (player && tickets) {
          cb({ gameInProgress: true, tickets: tickets, isHost: room.isHost(socket.id), players: room.getPlayerList(), drawnNumbers: room.game.drawnNumbers, prizes: room.game.prizes });
        } else {
          cb({ gameInProgress: false });
        }
      } else {
        cb({ gameInProgress: false });
      }
    });

    socket.on('claim-prize', ({ roomCode, prizeType, ticketIndex }, cb) => {
      const room = rooms.get(roomCode);
      if (!room) { cb({ valid: false, message: 'Room not found!' }); return; }
      const result = room.claimPrize(socket.id, prizeType, ticketIndex);
      cb(result);
      if (result.valid) {
        io.to(roomCode).emit('prize-claimed', { prizeType: result.prizeType, winnerName: result.winnerName, playerId: socket.id, message: result.message });
        if (prizeType === 'fullHouse') {
          stopAutoDraw(roomCode);
          if (!fullHouseTimers.has(roomCode)) {
            io.to(roomCode).emit('full-house-grace', { winnerName: result.winnerName, seconds: 2 });
            const timer = setTimeout(() => {
              fullHouseTimers.delete(roomCode);
              const r = rooms.get(roomCode);
              if (r && r.game) { r.game.finishGame(); io.to(roomCode).emit('game-over', { winners: r.game.getWinners() }); }
            }, 2000);
            fullHouseTimers.set(roomCode, timer);
          }
        }
      }
    });

    socket.on('disconnect', () => {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) { playerRooms.delete(socket.id); return; }
      const player = room.players.get(socket.id);
      if (!player) { handlePlayerLeave(socket.id, roomCode); return; }
      player.disconnected = true;
      player.disconnectedAt = Date.now();
      const graceDuration = room.gameInProgress ? 5000 : 2000; // Short for testing
      socket.to(roomCode).emit('player-status', { playerId: socket.id, playerName: player.name, online: false, players: room.getPlayerList() });
      const graceTimer = setTimeout(() => {
        const p = room.players.get(socket.id);
        if (p && p.disconnected) handlePlayerLeave(socket.id, roomCode);
      }, graceDuration);
      if (!room._graceTimers) room._graceTimers = new Map();
      room._graceTimers.set(socket.id, graceTimer);
    });
  });

  return new Promise(resolve => { httpServer.listen(PORT, resolve); server = httpServer; });
}

function connect() { return ioClient(`http://localhost:${PORT}`, { forceNew: true }); }

function waitEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Test Helpers ──────────────────────────────────────────────────

async function createAndJoinRoom(c1Name, c2Name) {
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: c1Name, ticketCount: 2, deviceId: 'dev1' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: c2Name, deviceId: 'dev2' }, () => resolve());
  });

  return { c1, c2, roomCode };
}

async function startGameAndWaitForNumbers(c1, roomCode, numCount) {
  let c1Tickets = null;
  const ticketPromise = waitEvent(c1, 'game-started');
  c1.emit('start-game', { roomCode }, () => {});
  const gameData = await ticketPromise;
  c1Tickets = gameData.tickets;

  // Wait for numbers
  let drawn = [];
  await new Promise(resolve => {
    c1.on('number-drawn', (data) => {
      drawn = data.drawnNumbers;
      if (drawn.length >= numCount) resolve();
    });
  });

  return { c1Tickets, drawn };
}

// ── Tests ────────────────────────────────────────────────────────

async function testFullHouseStopsDraw() {
  console.log('\n── Test 1: Full House claim stops auto-draw ──');
  const { c1, c2, roomCode } = await createAndJoinRoom('Alice', 'Bob');

  const { c1Tickets } = await startGameAndWaitForNumbers(c1, roomCode, 5);

  // Force all ticket numbers into drawn so claim is valid
  const room = rooms.get(roomCode);
  const ticket = c1Tickets[0];
  for (const row of ticket) {
    for (const num of row) {
      if (num !== 0 && !room.game.drawnNumbers.includes(num)) room.game.drawnNumbers.push(num);
    }
  }

  // Set up listeners BEFORE claiming so we don't miss broadcasts
  let numbersAfterClaim = 0;
  const prizePromise = waitEvent(c2, 'prize-claimed', 5000);
  const gracePromise = waitEvent(c2, 'full-house-grace', 5000);
  const gameOverPromise = waitEvent(c2, 'game-over', 5000);
  c2.on('number-drawn', () => numbersAfterClaim++);

  // Now claim
  const claimResult = await new Promise(resolve => {
    c1.emit('claim-prize', { roomCode, prizeType: 'fullHouse', ticketIndex: 0 }, resolve);
  });

  assert(claimResult.valid, 'Full House claim is valid');
  await delay(2000);
  assert(numbersAfterClaim <= 1, 'At most 1 in-flight number after Full House', `${numbersAfterClaim} drawn`);

  // Check broadcasts
  const prizeData = await prizePromise;
  assert(prizeData.prizeType === 'fullHouse', 'Prize broadcast received by watcher');

  const graceData = await gracePromise;
  assert(graceData.winnerName === 'Alice', 'Grace period broadcast received');

  const gameOverData = await gameOverPromise;
  assert(gameOverData !== undefined, 'Game over broadcast received');

  c1.disconnect(); c2.disconnect();
  await delay(200);
}

async function testLobbyGracePeriod() {
  console.log('\n── Test 2: Lobby disconnect grace period ──');
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: 'Host', ticketCount: 2, deviceId: 'devH' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: 'Guest', deviceId: 'devG' }, () => resolve());
  });

  const room = rooms.get(roomCode);
  assert(room.players.size === 2, 'Both players in room');

  // Guest disconnects
  c2.disconnect();
  await delay(300);

  // Check guest is marked disconnected but still in room
  let guestFound = false;
  for (const [, p] of room.players) {
    if (p.name === 'Guest') { guestFound = true; assert(p.disconnected === true, 'Guest marked as disconnected'); }
  }
  assert(guestFound, 'Guest still in room during grace period');
  assert(room.players.size === 2, 'Player count unchanged during grace', `count: ${room.players.size}`);

  // Wait for grace to expire (2s in test)
  await delay(2500);
  assert(room.players.size === 1, 'Guest removed after grace expired', `count: ${room.players.size}`);

  c1.disconnect();
  await delay(200);
}

async function testLobbyReconnectBeforeGrace() {
  console.log('\n── Test 3: Lobby reconnect before grace expires ──');
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: 'Host', ticketCount: 2, deviceId: 'devH2' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: 'Guest', deviceId: 'devG2' }, () => resolve());
  });

  const room = rooms.get(roomCode);
  
  // Guest disconnects
  c2.disconnect();
  await delay(300);
  assert(room.players.size === 2, 'Guest still in room during grace');

  // Guest reconnects with new socket before grace expires
  const c2new = connect();
  await delay(100);
  const rejoinResult = await new Promise(resolve => {
    c2new.emit('join-room', { roomCode, playerName: 'Guest', deviceId: 'devG2' }, resolve);
  });

  assert(rejoinResult.success, 'Guest rejoined successfully');
  
  // Check guest is no longer marked disconnected
  let guestOnline = false;
  for (const [, p] of room.players) {
    if (p.name === 'Guest') { guestOnline = !p.disconnected; }
  }
  assert(guestOnline, 'Guest marked as online after rejoin');

  // Wait past grace — guest should NOT be removed
  await delay(2500);
  assert(room.players.size === 2, 'Guest stays after grace (reconnected)', `count: ${room.players.size}`);

  c1.disconnect(); c2new.disconnect();
  await delay(200);
}

async function testOfflineStatusInPlayerList() {
  console.log('\n── Test 4: Offline status in player list ──');
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: 'Host', ticketCount: 2, deviceId: 'devH3' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: 'Guest', deviceId: 'devG3' }, () => resolve());
  });

  // Listen for player-status on host
  const statusPromise = waitEvent(c1, 'player-status', 3000);
  c2.disconnect();
  
  const statusData = await statusPromise;
  assert(statusData.online === false, 'player-status reports offline');
  assert(statusData.playerName === 'Guest', 'Correct player name in status');
  
  // Check disconnected flag in players list
  const offlinePlayer = statusData.players.find(p => p.name === 'Guest');
  assert(offlinePlayer && offlinePlayer.disconnected === true, 'disconnected flag in player list');

  c1.disconnect();
  await delay(2500);
}

async function testNewPlayerCantJoinMidGame() {
  console.log('\n── Test 5: New player cannot join mid-game ──');
  const { c1, c2, roomCode } = await createAndJoinRoom('Alice', 'Bob');
  
  // Start game
  const startPromise = waitEvent(c1, 'game-started');
  c1.emit('start-game', { roomCode }, () => {});
  await startPromise;
  await delay(300);

  // New player tries to join
  const c3 = connect();
  await delay(100);
  const joinResult = await new Promise(resolve => {
    c3.emit('join-room', { roomCode, playerName: 'Charlie', deviceId: 'devC' }, resolve);
  });

  assert(!joinResult.success, 'New player rejected mid-game');
  assert(joinResult.message === 'Game already in progress!', 'Correct rejection message', `got: ${joinResult.message}`);

  stopAutoDraw(roomCode);
  c1.disconnect(); c2.disconnect(); c3.disconnect();
  await delay(200);
}

async function testCheckGameStatus() {
  console.log('\n── Test 6: Lobby auto-join (check-game-status) ──');
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: 'Host', ticketCount: 2, deviceId: 'devH4' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: 'Latecomer', deviceId: 'devL4' }, () => resolve());
  });

  // Before game starts — check-game-status should return false
  const preStatus = await new Promise(resolve => {
    c2.emit('check-game-status', { roomCode }, resolve);
  });
  assert(!preStatus.gameInProgress, 'No game before start');

  // Start game
  const startPromise = waitEvent(c1, 'game-started');
  c1.emit('start-game', { roomCode }, () => {});
  await startPromise;
  await delay(300);

  // Now check-game-status should return true with tickets
  const postStatus = await new Promise(resolve => {
    c2.emit('check-game-status', { roomCode }, resolve);
  });
  assert(postStatus.gameInProgress, 'Game detected as in progress');
  assert(postStatus.tickets && postStatus.tickets.length > 0, 'Tickets returned for existing player');
  assert(Array.isArray(postStatus.drawnNumbers), 'Drawn numbers returned');
  assert(Array.isArray(postStatus.players), 'Player list returned');

  // New player (not in room) should NOT get game data
  const c3 = connect();
  await delay(100);
  const outsiderStatus = await new Promise(resolve => {
    c3.emit('check-game-status', { roomCode }, resolve);
  });
  assert(!outsiderStatus.gameInProgress, 'Outsider gets no game data');

  stopAutoDraw(roomCode);
  c1.disconnect(); c2.disconnect(); c3.disconnect();
  await delay(200);
}

async function testHostTransferOnDisconnect() {
  console.log('\n── Test 7: Host transfer on disconnect ──');
  const c1 = connect();
  const c2 = connect();
  await delay(100);

  const roomCode = await new Promise(resolve => {
    c1.emit('create-room', { playerName: 'OldHost', ticketCount: 2, deviceId: 'devOH' }, (res) => resolve(res.roomCode));
  });

  await new Promise(resolve => {
    c2.emit('join-room', { roomCode, playerName: 'NewHost', deviceId: 'devNH' }, () => resolve());
  });

  const room = rooms.get(roomCode);
  assert(room.hostId === c1.id, 'Original host is c1');

  // Listen for player-left with new host
  const leftPromise = waitEvent(c2, 'player-left', 5000);
  c1.disconnect();

  // Wait for grace to expire
  await delay(2500);

  const leftData = await leftPromise;
  assert(leftData.newHostId !== null, 'New host assigned');
  assert(leftData.playerName === 'OldHost', 'Left player name correct');

  c2.disconnect();
  await delay(200);
}

async function testPrizeBroadcastToAll() {
  console.log('\n── Test 8: Prize claim broadcasts to all players ──');
  const { c1, c2, roomCode } = await createAndJoinRoom('Claimer', 'Watcher');

  const { c1Tickets } = await startGameAndWaitForNumbers(c1, roomCode, 5);

  // Force claim validity
  const room = rooms.get(roomCode);
  const ticket = c1Tickets[0];
  for (const row of ticket) {
    for (const num of row) {
      if (num !== 0 && !room.game.drawnNumbers.includes(num)) room.game.drawnNumbers.push(num);
    }
  }

  // Listen for broadcast on watcher
  const broadcastPromise = waitEvent(c2, 'prize-claimed', 3000);
  const gracePromise = waitEvent(c2, 'full-house-grace', 3000);

  c1.emit('claim-prize', { roomCode, prizeType: 'fullHouse', ticketIndex: 0 }, () => {});

  const broadcast = await broadcastPromise;
  assert(broadcast.prizeType === 'fullHouse', 'Prize type correct in broadcast');
  assert(broadcast.winnerName === 'Claimer', 'Winner name correct in broadcast');

  const grace = await gracePromise;
  assert(grace.winnerName === 'Claimer', 'Grace period broadcast received');
  assert(typeof grace.seconds === 'number', 'Grace seconds included');

  c1.disconnect(); c2.disconnect();
  await delay(200);
}

// ── Run All Tests ────────────────────────────────────────────────

async function runAll() {
  console.log('🧪 Starting Housie Test Suite...\n');
  await setupServer();
  console.log(`   Server on port ${PORT}\n`);

  try {
    await testFullHouseStopsDraw();
    await testLobbyGracePeriod();
    await testLobbyReconnectBeforeGrace();
    await testOfflineStatusInPlayerList();
    await testNewPlayerCantJoinMidGame();
    await testCheckGameStatus();
    await testHostTransferOnDisconnect();
    await testPrizeBroadcastToAll();
  } catch (err) {
    console.error('\n💥 Test crashed:', err);
    testsFailed++;
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  server.close();
  process.exit(testsFailed > 0 ? 1 : 0);
}

runAll();
