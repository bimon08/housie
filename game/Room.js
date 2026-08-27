/**
 * Room Manager
 *
 * Handles room creation, player management, and game lifecycle.
 * Each room has a unique 4-digit code, a host, and manages a Game instance.
 */

const Game = require('./Game');

class Room {
  /**
   * @param {string} code - 4-digit room code
   * @param {string} hostId - Socket ID of the host
   * @param {string} hostName - Name of the host
   * @param {number} ticketCount - Number of tickets per player (default 2)
   */
  constructor(code, hostId, hostName, ticketCount = 2) {
    this.code = code;
    this.hostId = hostId;
    this.ticketCount = ticketCount;
    this.players = new Map(); // socketId -> { id, name }
    this.game = new Game();
    this.gameInProgress = false;

    // Add host as first player
    this.players.set(hostId, { id: hostId, name: hostName, deviceId: null });
  }

  /**
   * Add a player to the room.
   * @param {string} playerId - Socket ID
   * @param {string} playerName - Player's display name
   * @param {string} deviceId - Unique device identifier
   * @returns {{ success: boolean, message?: string, replacedSocketId?: string }}
   */
  addPlayer(playerId, playerName, deviceId) {
    if (this.gameInProgress) {
      return { success: false, message: 'Game already in progress!' };
    }

    if (this.players.has(playerId)) {
      return { success: false, message: 'Already in this room!' };
    }

    // If the same device already has an entry (reconnect/duplicate tab),
    // remove the old entry and replace with the new socket
    let replacedSocketId = null;
    if (deviceId) {
      for (const [oldId, p] of this.players) {
        if (p.deviceId === deviceId && oldId !== playerId) {
          if (oldId === this.hostId) this.hostId = playerId;
          this.players.delete(oldId);
          replacedSocketId = oldId;
          break;
        }
      }
    }

    this.players.set(playerId, { id: playerId, name: playerName, deviceId: deviceId || null });
    return { success: true, replacedSocketId };
  }

  /**
   * Remove a player from the room.
   * @param {string} playerId - Socket ID
   * @returns {{ name: string, isEmpty: boolean, newHostId?: string }}
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    const name = player ? player.name : 'Unknown';
    this.players.delete(playerId);

    const result = { name, isEmpty: this.players.size === 0 };

    // If host left and room isn't empty, assign new host
    if (playerId === this.hostId && this.players.size > 0) {
      this.hostId = this.players.keys().next().value;
      result.newHostId = this.hostId;
    }

    return result;
  }

  /**
   * Rejoin a game in progress (e.g. after accidental disconnect, phone call, app switch).
   * Matches by deviceId first, then by name. Registers the new socket ID.
   * @param {string} newSocketId - New socket ID
   * @param {string} playerName - Player's name
   * @param {string} deviceId - Device identifier
   */
  rejoinPlayer(newSocketId, playerName, deviceId) {
    if (!this.gameInProgress) {
      return { success: false, message: 'No game in progress.' };
    }

    // Find old player entry — prefer deviceId match, fall back to name
    let oldSocketId = null;
    if (deviceId) {
      for (const [id, p] of this.players) {
        if (p.deviceId === deviceId) { oldSocketId = id; break; }
      }
    }
    if (!oldSocketId) {
      for (const [id, p] of this.players) {
        if (p.name === playerName) { oldSocketId = id; break; }
      }
    }

    if (!oldSocketId) {
      return { success: false, message: 'Player not found in this room.' };
    }

    // Clear any grace timer for the old socket
    if (this._graceTimers && this._graceTimers.has(oldSocketId)) {
      clearTimeout(this._graceTimers.get(oldSocketId));
      this._graceTimers.delete(oldSocketId);
    }

    // Re-map: remove old entry, add new socket ID
    const playerData = this.players.get(oldSocketId);
    this.players.delete(oldSocketId);
    playerData.id = newSocketId;
    playerData.disconnected = false;
    playerData.disconnectedAt = null;
    this.players.set(newSocketId, playerData);

    // Fix host if needed
    if (oldSocketId === this.hostId) this.hostId = newSocketId;

    // Remap tickets
    const tickets = this.game.playerTickets[oldSocketId];
    if (tickets) {
      this.game.playerTickets[newSocketId] = tickets;
      delete this.game.playerTickets[oldSocketId];
    }

    return {
      success: true,
      tickets: tickets || [],
      drawnNumbers: this.game.drawnNumbers,
      prizes: this.game.prizes,
      isHost: newSocketId === this.hostId,
      players: Array.from(this.players.values()),
    };
  }

  /**
   * Update game settings (only host can do this).
   * @param {string} playerId - Must be the host
   * @param {number} ticketCount - New ticket count
   * @returns {boolean}
   */
  updateSettings(playerId, ticketCount) {
    if (playerId !== this.hostId) return false;
    if (this.gameInProgress) return false;
    this.ticketCount = Math.max(1, Math.min(6, ticketCount));
    return true;
  }

  /**
   * Start the game.
   * @param {string} playerId - Must be the host
   * @returns {{ success: boolean, message?: string, playerTickets?: Object }}
   */
  startGame(playerId) {
    if (playerId !== this.hostId) {
      return { success: false, message: 'Only the host can start the game!' };
    }

    if (this.players.size < 2) {
      return { success: false, message: 'Need at least 2 players to start!' };
    }

    if (this.gameInProgress) {
      return { success: false, message: 'Game already in progress!' };
    }

    this.gameInProgress = true;
    const playerList = Array.from(this.players.values());
    const playerTickets = this.game.initialize(playerList, this.ticketCount);

    return { success: true, playerTickets };
  }

  /**
   * Draw the next number.
   * @param {string} playerId - Must be the host
   * @returns {{ success: boolean, number?: number, remaining?: number, message?: string }}
   */
  drawNumber(playerId) {
    if (playerId !== this.hostId) {
      return { success: false, message: 'Only the host can draw numbers!' };
    }

    return this.autoDraw();
  }

  /**
   * Auto-draw the next number (no host check — used by server timer).
   */
  autoDraw() {
    if (!this.gameInProgress) {
      return { success: false, message: 'Game has not started!' };
    }

    if (this.game.finished) {
      return { success: false, message: 'Game is already over!' };
    }

    const result = this.game.drawNumber();
    if (!result) {
      return { success: false, message: 'No more numbers to draw!' };
    }

    return {
      success: true,
      number: result.number,
      drawnNumbers: [...this.game.drawnNumbers],
      remaining: result.remaining,
    };
  }

  /**
   * Process a prize claim.
   * @param {string} playerId
   * @param {string} prizeType
   * @param {number} ticketIndex
   * @returns {{ valid: boolean, message: string, prizeType: string, winnerName?: string }}
   */
  claimPrize(playerId, prizeType, ticketIndex) {
    const player = this.players.get(playerId);
    if (!player) {
      return { valid: false, message: 'Player not in room!', prizeType };
    }

    const result = this.game.claimPrize(playerId, player.name, prizeType, ticketIndex);

    if (result.valid) {
      return {
        ...result,
        prizeType,
        winnerName: player.name,
        gameOver: this.game.finished,
        winners: this.game.finished ? this.game.getWinners() : null,
      };
    }

    return { ...result, prizeType };
  }

  /**
   * Reset the game for a new round.
   * @param {string} playerId - Must be the host
   * @returns {boolean}
   */
  resetGame(playerId) {
    if (playerId !== this.hostId) return false;
    this.game.reset();
    this.gameInProgress = false;
    return true;
  }

  /**
   * Get player list for sending to clients.
   * @returns {Array<{ id: string, name: string, isHost: boolean }>}
   */
  getPlayerList() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === this.hostId,
    }));
  }

  /**
   * Check if a player is the host.
   */
  isHost(playerId) {
    return playerId === this.hostId;
  }
}

module.exports = Room;
