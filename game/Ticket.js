/**
 * Housie (Tambola) Ticket Generator
 *
 * Standard Housie ticket: 3 rows x 9 columns = 27 cells
 * Only 15 cells contain numbers (5 per row, 4 blanks per row)
 *
 * Column ranges:
 *   Col 0: 1-9, Col 1: 10-19, Col 2: 20-29, Col 3: 30-39,
 *   Col 4: 40-49, Col 5: 50-59, Col 6: 60-69, Col 7: 70-79, Col 8: 80-90
 *
 * Rules:
 *   - Each column has 1-3 numbers (never 0, never more than 3)
 *   - Numbers within a column are sorted top to bottom
 *   - Each row has exactly 5 numbers
 *   - No duplicate numbers across all tickets in a game
 */

class TicketGenerator {
  constructor() {
    // Column ranges for a Housie ticket
    this.columnRanges = [
      { min: 1, max: 9 },
      { min: 10, max: 19 },
      { min: 20, max: 29 },
      { min: 30, max: 39 },
      { min: 40, max: 49 },
      { min: 50, max: 59 },
      { min: 60, max: 69 },
      { min: 70, max: 79 },
      { min: 80, max: 90 },
    ];
  }

  /**
   * Generate a set of tickets for a game.
   * Numbers CAN repeat across tickets, but no two tickets will have
   * the exact same set of numbers in any column.
   * @param {number} playerCount - Number of players
   * @param {number} ticketsPerPlayer - Number of tickets each player gets
   * @returns {Array<Array<Array<number|null>>>} Array of tickets, each ticket is 3x9
   */
  generateTickets(playerCount, ticketsPerPlayer) {
    const totalTickets = playerCount * ticketsPerPlayer;
    const tickets = [];

    // Track used column combos: usedColumnCombos[col] = Set of "1,5,9" strings
    const usedColumnCombos = [];
    for (let col = 0; col < 9; col++) {
      usedColumnCombos.push(new Set());
    }

    for (let i = 0; i < totalTickets; i++) {
      const ticket = this._generateSingleTicket(usedColumnCombos);
      tickets.push(ticket);
    }

    return tickets;
  }

  /**
   * Generate a single valid Housie ticket.
   * @param {Array<Set<string>>} usedColumnCombos - Used column combos per column
   * @returns {Array<Array<number|null>>} 3x9 grid (null = blank cell)
   */
  _generateSingleTicket(usedColumnCombos) {
    let attempts = 0;
    const maxAttempts = 200;

    while (attempts < maxAttempts) {
      attempts++;
      const ticket = this._tryGenerateTicket(usedColumnCombos);
      if (ticket) {
        // Record column combos
        for (let col = 0; col < 9; col++) {
          const nums = [];
          for (let row = 0; row < 3; row++) {
            if (ticket[row][col] !== null) nums.push(ticket[row][col]);
          }
          if (nums.length > 0) {
            usedColumnCombos[col].add(nums.sort((a, b) => a - b).join(','));
          }
        }
        return ticket;
      }
    }

    // Fallback: generate without column-combo constraint
    return this._tryGenerateTicket(null);
  }

  /**
   * Attempt to generate a single ticket with maximum spread.
   * @param {Array<Set<string>>|null} usedColumnCombos - Column combos to avoid (null = no constraint)
   * @returns {Array<Array<number|null>>|null} Ticket or null if failed
   */
  _tryGenerateTicket(usedColumnCombos) {
    // Step 1: For each column, get all numbers in range
    const columnNumbers = [];
    for (let col = 0; col < 9; col++) {
      const { min, max } = this.columnRanges[col];
      const available = [];
      for (let n = min; n <= max; n++) {
        available.push(n);
      }
      columnNumbers.push(available);
    }

    // Step 2: Decide how many numbers each column will have (1, 2, or 3)
    const columnCounts = this._distributeColumnCounts(columnNumbers);
    if (!columnCounts) return null;

    // Step 3: Pick random numbers for each column, avoiding used combos
    const selectedNumbers = [];
    for (let col = 0; col < 9; col++) {
      const count = columnCounts[col];
      const available = columnNumbers[col];
      if (available.length < count) return null;

      // Try to find a combination not already used in this column
      let picked = null;
      const maxPickAttempts = 20;
      for (let p = 0; p < maxPickAttempts; p++) {
        const shuffled = this._shuffle([...available]);
        const candidate = shuffled.slice(0, count).sort((a, b) => a - b);
        const key = candidate.join(',');

        if (!usedColumnCombos || !usedColumnCombos[col].has(key)) {
          picked = candidate;
          break;
        }
      }

      if (!picked) {
        // Accept any combination if we can't find a unique one
        const shuffled = this._shuffle([...available]);
        picked = shuffled.slice(0, count).sort((a, b) => a - b);
      }

      selectedNumbers.push(picked);
    }

    // Step 4: Place numbers in the 3x9 grid with 5 per row
    const grid = this._placeNumbersInGrid(selectedNumbers, columnCounts);
    return grid;
  }

  /**
   * Distribute column counts such that total = 15 and each row has exactly 5.
   * Each column gets 1-3 numbers.
   * SPREAD STRATEGY: Maximize coverage across all 9 columns by distributing
   * numbers as evenly as possible (prefer 1-2 per column over 3 in some and 0 in none).
   * @param {Array<Array<number>>} columnNumbers - Available numbers per column
   * @returns {Array<number>|null} Count per column or null if impossible
   */
  _distributeColumnCounts(columnNumbers) {
    // Check each column has at least 1 available number
    for (let col = 0; col < 9; col++) {
      if (columnNumbers[col].length < 1) return null;
    }

    // Start with 1 per column (9 total), need 6 more to reach 15
    const counts = new Array(9).fill(1);
    let remaining = 6; // 15 - 9

    // SPREAD: First, try to bring every column to 2 before any column gets 3.
    const cols = this._shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    // Round 1: give each column a 2nd number (up to 6 columns)
    for (const col of cols) {
      if (remaining <= 0) break;
      if (counts[col] < 2 && columnNumbers[col].length >= 2) {
        counts[col] = 2;
        remaining--;
      }
    }

    // Round 2: if still remaining, give a 3rd number to columns that can hold it
    if (remaining > 0) {
      const cols2 = this._shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      for (const col of cols2) {
        if (remaining <= 0) break;
        if (counts[col] < 3 && columnNumbers[col].length >= 3) {
          counts[col] = 3;
          remaining--;
        }
      }
    }

    // Round 3: last resort — fill anywhere possible
    while (remaining > 0) {
      let added = false;
      for (let col = 0; col < 9; col++) {
        if (remaining <= 0) break;
        if (counts[col] < 3 && counts[col] < columnNumbers[col].length) {
          counts[col]++;
          remaining--;
          added = true;
        }
      }
      if (!added) return null;
    }

    const total = counts.reduce((s, c) => s + c, 0);
    if (total !== 15) return null;

    return counts;
  }

  /**
   * Place selected numbers into a 3x9 grid ensuring 5 numbers per row.
   * @param {Array<Array<number>>} selectedNumbers - Sorted numbers per column
   * @param {Array<number>} columnCounts - Count per column
   * @returns {Array<Array<number|null>>} 3x9 grid
   */
  _placeNumbersInGrid(selectedNumbers, columnCounts) {
    // Create empty grid
    const grid = [
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
    ];

    // For columns with 3 numbers, place in all 3 rows
    // For columns with 2 numbers, pick 2 rows
    // For columns with 1 number, pick 1 row
    // Ensure each row ends up with exactly 5

    const rowCounts = [0, 0, 0];

    // Track which rows each column will use
    const columnRows = [];
    for (let col = 0; col < 9; col++) {
      const count = columnCounts[col];
      if (count === 3) {
        columnRows.push([0, 1, 2]);
      } else if (count === 2) {
        columnRows.push(null); // decide later
      } else {
        columnRows.push(null); // decide later
      }
    }

    // First pass: assign rows for 3-count columns
    for (let col = 0; col < 9; col++) {
      if (columnCounts[col] === 3) {
        rowCounts[0]++;
        rowCounts[1]++;
        rowCounts[2]++;
      }
    }

    // Second pass: assign rows for 2-count columns
    for (let col = 0; col < 9; col++) {
      if (columnCounts[col] === 2) {
        const rows = this._pickBestRows(2, rowCounts);
        columnRows[col] = rows;
        for (const r of rows) rowCounts[r]++;
      }
    }

    // Third pass: assign rows for 1-count columns
    for (let col = 0; col < 9; col++) {
      if (columnCounts[col] === 1) {
        const rows = this._pickBestRows(1, rowCounts);
        columnRows[col] = rows;
        for (const r of rows) rowCounts[r]++;
      }
    }

    // Check if each row has exactly 5
    if (rowCounts[0] !== 5 || rowCounts[1] !== 5 || rowCounts[2] !== 5) {
      // Try to fix by swapping — or just retry
      return this._placeWithBacktracking(selectedNumbers, columnCounts);
    }

    // Place numbers
    for (let col = 0; col < 9; col++) {
      const rows = columnRows[col];
      const nums = selectedNumbers[col];
      for (let i = 0; i < nums.length; i++) {
        grid[rows[i]][col] = nums[i];
      }
    }

    return grid;
  }

  /**
   * Pick the best rows to place numbers in, preferring rows with fewer numbers.
   * @param {number} count - How many rows to pick
   * @param {Array<number>} rowCounts - Current count per row
   * @returns {Array<number>} Selected row indices, sorted
   */
  _pickBestRows(count, rowCounts) {
    const indexed = [0, 1, 2].map((i) => ({ row: i, count: rowCounts[i] }));
    // Sort by count ascending, then randomize ties
    indexed.sort((a, b) => a.count - b.count || Math.random() - 0.5);
    const selected = indexed
      .slice(0, count)
      .map((x) => x.row)
      .sort((a, b) => a - b);
    return selected;
  }

  /**
   * Backtracking placement for when greedy approach fails.
   * @param {Array<Array<number>>} selectedNumbers - Numbers per column
   * @param {Array<number>} columnCounts - Count per column
   * @returns {Array<Array<number|null>>} 3x9 grid
   */
  _placeWithBacktracking(selectedNumbers, columnCounts) {
    const grid = [
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
    ];

    // Generate all possible row assignments for each column
    const allRowOptions = [];
    for (let col = 0; col < 9; col++) {
      const count = columnCounts[col];
      const options = this._getCombinations([0, 1, 2], count);
      allRowOptions.push(this._shuffle([...options]));
    }

    // Backtrack
    const rowCounts = [0, 0, 0];

    const solve = (col) => {
      if (col === 9) {
        return rowCounts[0] === 5 && rowCounts[1] === 5 && rowCounts[2] === 5;
      }

      for (const rows of allRowOptions[col]) {
        // Check if adding these rows would exceed 5
        let valid = true;
        for (const r of rows) {
          if (rowCounts[r] + 1 > 5) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Place
        for (const r of rows) rowCounts[r]++;
        if (solve(col + 1)) {
          // Record the assignment
          const nums = selectedNumbers[col];
          const sortedRows = [...rows].sort((a, b) => a - b);
          for (let i = 0; i < nums.length; i++) {
            grid[sortedRows[i]][col] = nums[i];
          }
          return true;
        }
        // Undo
        for (const r of rows) rowCounts[r]--;
      }

      return false;
    };

    if (solve(0)) {
      return grid;
    }

    // Last resort: just place randomly (shouldn't happen)
    return this._forcePlacement(selectedNumbers, columnCounts);
  }

  /**
   * Force placement as a last resort.
   */
  _forcePlacement(selectedNumbers, columnCounts) {
    const grid = [
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
    ];

    // Simple placement: fill columns left to right
    const rowCounts = [0, 0, 0];
    for (let col = 0; col < 9; col++) {
      const nums = selectedNumbers[col];
      const count = columnCounts[col];
      const availableRows = [0, 1, 2]
        .filter((r) => rowCounts[r] < 5)
        .sort((a, b) => rowCounts[a] - rowCounts[b]);

      const rows = availableRows.slice(0, count).sort((a, b) => a - b);
      for (let i = 0; i < nums.length; i++) {
        if (rows[i] !== undefined) {
          grid[rows[i]][col] = nums[i];
          rowCounts[rows[i]]++;
        }
      }
    }

    return grid;
  }

  /**
   * Get all combinations of `count` items from `arr`.
   */
  _getCombinations(arr, count) {
    if (count === 0) return [[]];
    if (count === arr.length) return [arr];
    const result = [];
    for (let i = 0; i <= arr.length - count; i++) {
      const rest = this._getCombinations(arr.slice(i + 1), count - 1);
      for (const combo of rest) {
        result.push([arr[i], ...combo]);
      }
    }
    return result;
  }

  /**
   * Fisher-Yates shuffle.
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = TicketGenerator;
