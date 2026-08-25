/**
 * Claim Validator
 *
 * Validates player claims for Housie prizes:
 * - Early Five: First player to have any 5 numbers marked
 * - First Row: All 5 numbers in row 0 marked
 * - Second Row: All 5 numbers in row 1 marked
 * - Third Row: All 5 numbers in row 2 marked
 * - Full House: All 15 numbers on the ticket marked
 */

class Validator {
  /**
   * Validate a prize claim.
   * @param {Array<Array<number|null>>} ticket - 3x9 ticket grid
   * @param {Array<number>} drawnNumbers - All drawn numbers so far
   * @param {string} prizeType - Type of prize being claimed
   * @returns {boolean} Whether the claim is valid
   */
  validateClaim(ticket, drawnNumbers, prizeType) {
    const drawnSet = new Set(drawnNumbers);

    switch (prizeType) {
      case 'earlyFive':
        return this._validateEarlyFive(ticket, drawnSet);
      case 'firstRow':
        return this._validateRow(ticket, 0, drawnSet);
      case 'secondRow':
        return this._validateRow(ticket, 1, drawnSet);
      case 'thirdRow':
        return this._validateRow(ticket, 2, drawnSet);
      case 'fullHouse':
        return this._validateFullHouse(ticket, drawnSet);
      default:
        return false;
    }
  }

  /**
   * Check if at least 5 numbers on the ticket have been drawn.
   */
  _validateEarlyFive(ticket, drawnSet) {
    let count = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) {
        if (ticket[row][col] !== null && drawnSet.has(ticket[row][col])) {
          count++;
        }
      }
    }
    return count >= 5;
  }

  /**
   * Check if all numbers in a specific row have been drawn.
   */
  _validateRow(ticket, rowIndex, drawnSet) {
    for (let col = 0; col < 9; col++) {
      const num = ticket[rowIndex][col];
      if (num !== null && !drawnSet.has(num)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if all 15 numbers on the ticket have been drawn.
   */
  _validateFullHouse(ticket, drawnSet) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) {
        const num = ticket[row][col];
        if (num !== null && !drawnSet.has(num)) {
          return false;
        }
      }
    }
    return true;
  }
}

module.exports = Validator;
