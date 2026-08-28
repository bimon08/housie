/**
 * Game State Manager
 *
 * Manages the game state for a Housie round:
 * - Number pool (1-90)
 * - Drawing random numbers
 * - Tracking called numbers
 * - Prize states (Early Five, First Row, Second Row, Third Row, Full House)
 */

const TicketGenerator = require('./Ticket');
const Validator = require('./Validator');

class Game {
  constructor() {
    this.ticketGenerator = new TicketGenerator();
    this.validator = new Validator();

    // Number pool: 1-90
    this.numberPool = [];
    this.drawnNumbers = [];
    this.currentNumber = null;

    // Prize tracking
    this.prizes = {
      earlyFive: null,   // { playerName, playerId, ticketIndex }
      firstRow: null,
      secondRow: null,
      thirdRow: null,
      fullHouse: null,
    };

    // Tickets assigned to players: { playerId: [ticket1, ticket2, ...] }
    this.playerTickets = {};

    // Game state
    this.started = false;
    this.finished = false;
    this.fullHouseClaimed = false;
  }

  /**
   * Finish the game (called by server after grace period).
   */
  finishGame() {
    this.finished = true;
  }

  /**
   * Initialize the game: generate tickets and assign to players.
   * @param {Array<{id: string, name: string}>} players - List of players
   * @param {number} ticketsPerPlayer - Tickets each player gets
   */
  initialize(players, ticketsPerPlayer) {
    // Reset state
    this.numberPool = this._createNumberPool();
    this.drawnNumbers = [];
    this.currentNumber = null;
    this.prizes = {
      earlyFive: null,
      firstRow: null,
      secondRow: null,
      thirdRow: null,
      fullHouse: null,
    };
    this.playerTickets = {};
    this.started = true;
    this.finished = false;

    // Generate all tickets
    const totalTickets = this.ticketGenerator.generateTickets(
      players.length,
      ticketsPerPlayer
    );

    // Assign tickets to players
    let ticketIndex = 0;
    for (const player of players) {
      this.playerTickets[player.id] = [];
      for (let i = 0; i < ticketsPerPlayer; i++) {
        this.playerTickets[player.id].push(totalTickets[ticketIndex]);
        ticketIndex++;
      }
    }

    return this.playerTickets;
  }

  /**
   * Draw the next random number from the pool.
   * @returns {{ number: number, remaining: number }|null}
   */
  drawNumber() {
    if (this.numberPool.length === 0) return null;
    if (this.finished) return null;
    if (this.fullHouseClaimed) return null;

    const index = Math.floor(Math.random() * this.numberPool.length);
    const number = this.numberPool.splice(index, 1)[0];

    this.currentNumber = number;
    this.drawnNumbers.push(number);

    return {
      number,
      remaining: this.numberPool.length,
    };
  }

  /**
   * Validate a prize claim from a player.
   * @param {string} playerId - Player making the claim
   * @param {string} playerName - Player's name
   * @param {string} prizeType - 'earlyFive', 'firstRow', 'secondRow', 'thirdRow', 'fullHouse'
   * @param {number} ticketIndex - Which ticket they're claiming with
   * @returns {{ valid: boolean, message: string }}
   */
  claimPrize(playerId, playerName, prizeType, ticketIndex) {
    // Check if THIS player already claimed this prize
    const winners = this.prizes[prizeType] || [];
    const alreadyClaimed = winners.some(w => w.playerId === playerId && w.ticketIndex === ticketIndex);
    if (alreadyClaimed) {
      return { valid: false, message: 'You already claimed this!' };
    }

    // Get the player's ticket
    const tickets = this.playerTickets[playerId];
    if (!tickets || !tickets[ticketIndex]) {
      return { valid: false, message: 'Invalid ticket!' };
    }

    const ticket = tickets[ticketIndex];

    // Validate the claim
    const isValid = this.validator.validateClaim(
      ticket,
      this.drawnNumbers,
      prizeType
    );

    if (isValid) {
      if (!this.prizes[prizeType]) {
        this.prizes[prizeType] = [];
      }
      this.prizes[prizeType].push({ playerName, playerId, ticketIndex });

      // Don't auto-finish on fullHouse — server handles grace period
      // Just track that at least one fullHouse was claimed
      if (prizeType === 'fullHouse') {
        this.fullHouseClaimed = true;
      }

      return {
        valid: true,
        message: `🎉 ${playerName} got ${this._getPrizeName(prizeType)}!`,
      };
    }

    return {
      valid: false,
      message: '❌ Not quite! Keep playing.',
    };
  }

  /**
   * Get all prize winners for the results screen.
   * @returns {Object} Prize winners
   */
  getWinners() {
    return { ...this.prizes };
  }

  /**
   * Get human-readable prize name.
   * @param {string} prizeType
   * @returns {string}
   */
  _getPrizeName(prizeType) {
    const names = {
      earlyFive: 'Early Five',
      firstRow: 'First Row',
      secondRow: 'Second Row',
      thirdRow: 'Third Row',
      fullHouse: 'Full House',
    };
    return names[prizeType] || prizeType;
  }

  /**
   * Create shuffled number pool 1-90.
   * @returns {Array<number>}
   */
  _createNumberPool() {
    const pool = [];
    for (let i = 1; i <= 90; i++) {
      pool.push(i);
    }
    return pool;
  }

  /**
   * Reset the game for a new round (keeps players).
   */
  reset() {
    this.numberPool = [];
    this.drawnNumbers = [];
    this.currentNumber = null;
    this.prizes = {
      earlyFive: null,
      firstRow: null,
      secondRow: null,
      thirdRow: null,
      fullHouse: null,
    };
    this.playerTickets = {};
    this.started = false;
    this.finished = false;
  }
}

module.exports = Game;
