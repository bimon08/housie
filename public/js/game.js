/**
 * Game Renderer — Client-side game logic
 *
 * Handles:
 * - Rendering tickets (grid with marking)
 * - Auto-marking numbers on tickets
 * - Managing active ticket tab
 * - Updating claim button states
 */

const GameRenderer = (() => {
  let tickets = [];
  let drawnNumbers = new Set();
  let activeTicketIndex = 0;
  let isHost = false;
  let onMarkCallback = null; // called with (ticketIndex, markedCount) after each mark
  // Track which numbers the player has manually marked per ticket
  let markedByPlayer = {}; // { ticketIndex: Set of numbers }

  /**
   * Initialize with player's tickets.
   */
  function init(playerTickets, hostFlag) {
    tickets = playerTickets;
    drawnNumbers = new Set();
    activeTicketIndex = 0;
    isHost = hostFlag;
    markedByPlayer = {};
    renderAllTickets();
    resetClaimButtons();
  }

  /**
   * A new number was drawn — add to called set, update display.
   * Does NOT auto-mark on tickets — player must tap.
   */
  function markNumber(number) {
    drawnNumbers.add(number);
    updateCurrentNumberDisplay(number);
    updateNumbersCount();
  }

  /**
   * Update the big number ball display.
   */
  function updateCurrentNumberDisplay(number) {
    const ball = document.getElementById('number-ball');
    const text = document.getElementById('current-number-text');

    // Use GSAP if available, fallback to CSS
    if (typeof Motion !== 'undefined') {
      // Set text right away — the animation handles the visual transition
      text.textContent = number;
      Motion.animateNumberBall(ball);
    } else {
      // CSS fallback: swap text immediately and trigger bounce
      text.textContent = number;
      ball.classList.remove('animate');
      void ball.offsetWidth;
      ball.classList.add('animate');
    }
  }

  /**
   * Update numbers called count.
   */
  function updateNumbersCount() {
    const el = document.getElementById('numbers-called-count');
    el.textContent = `${drawnNumbers.size}/90`;
  }

  /**
   * Highlight cells that have been called but not yet marked by the player.
   */
  function highlightCallableNumbers() {
    document.querySelectorAll('.ticket-cell[data-num]').forEach((cell) => {
      const num = parseInt(cell.dataset.num);
      if (drawnNumbers.has(num) && !cell.classList.contains('marked')) {
        cell.classList.add('callable');
      }
    });
  }

  /**
   * Handle player clicking a ticket cell to mark it.
   */
  function handleCellClick(cell) {
    const num = parseInt(cell.dataset.num);
    if (isNaN(num)) return;

    // Already marked
    if (cell.classList.contains('marked')) return;

    // Check if this number has been called
    if (!drawnNumbers.has(num)) {
      // Wrong tap — shake
      if (typeof Motion !== 'undefined') {
        Motion.animateShake(cell);
      } else {
        cell.classList.add('shake');
        setTimeout(() => cell.classList.remove('shake'), 400);
      }
      return;
    }

    // Mark it!
    cell.classList.remove('callable');
    cell.classList.add('marked');

    // GSAP stamp effect
    if (typeof Motion !== 'undefined') {
      Motion.animateMark(cell);
    }

    // Update header count for this ticket
    const ticketEl = cell.closest('.ticket');
    if (ticketEl) {
      const ticketIdx = parseInt(ticketEl.id.replace('ticket-', ''));

      // Track this mark
      if (!markedByPlayer[ticketIdx]) markedByPlayer[ticketIdx] = new Set();
      markedByPlayer[ticketIdx].add(num);
      saveMarkedNumbers();

      const grid = ticketEl.querySelector('.ticket-grid');
      const markedCount = grid.querySelectorAll('.ticket-cell.marked').length;
      const header = ticketEl.querySelector('.ticket-header span:last-child');
      if (header) header.textContent = `${markedCount}/15`;

      // Notify app.js so it can emit progress
      if (onMarkCallback) onMarkCallback(ticketIdx, markedCount);
    }
  }

  /**
   * Render all tickets stacked vertically (no tabs).
   */
  function renderAllTickets() {
    const tabsEl = document.getElementById('ticket-tabs');
    tabsEl.style.display = 'none';

    const container = document.getElementById('ticket-container');
    container.innerHTML = '';

    tickets.forEach((ticket, idx) => {
      const ticketEl = createTicketElement(ticket, idx);
      // Tap a ticket to select it for claims
      ticketEl.addEventListener('click', (e) => {
        // If they tapped a number cell, handle marking
        const cell = e.target.closest('.ticket-cell[data-num]');
        if (cell) {
          handleCellClick(cell);
          e.stopPropagation();
        }
        // Select this ticket for claims
        activeTicketIndex = idx;
        container.querySelectorAll('.ticket').forEach((t, i) => {
          t.classList.toggle('ticket-selected', i === idx);
        });
      });
      if (idx === 0) ticketEl.classList.add('ticket-selected');
      container.appendChild(ticketEl);
    });

    // Ensure scroll starts at Ticket 1
    const ticketsArea = document.querySelector('.tickets-area');
    if (ticketsArea) ticketsArea.scrollTop = 0;
  }

  /**
   * Create a ticket DOM element.
   */
  function createTicketElement(ticket, index) {
    const el = document.createElement('div');
    el.className = 'ticket';
    el.id = `ticket-${index}`;

    el.innerHTML = `
      <div class="ticket-header">
        <span>Ticket ${index + 1}</span>
        <span>0/15</span>
      </div>
      <div class="ticket-grid" id="ticket-grid-${index}">
        ${buildTicketGrid(ticket)}
      </div>
    `;

    return el;
  }

  /**
   * Build ticket grid HTML — no auto-marking.
   */
  function buildTicketGrid(ticket) {
    let html = '';
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) {
        const num = ticket[row][col];
        if (num === null) {
          html += '<div class="ticket-cell empty"></div>';
        } else {
          html += `<div class="ticket-cell" data-num="${num}">${num}</div>`;
        }
      }
    }
    return html;
  }

  /**
   * Reset claim buttons.
   */
  function resetClaimButtons() {
    const prizes = ['fullHouse'];
    prizes.forEach((prize) => {
      const btn = document.getElementById(`claim-${prize}`);
      if (btn) {
        btn.disabled = false;
        const winnerEl = btn.querySelector('.claim-winner');
        if (winnerEl) winnerEl.remove();
      }
    });
  }

  /**
   * Disable a claim button and show winner.
   */
  function disableClaim(prizeType, winnerName) {
    const btn = document.getElementById(`claim-${prizeType}`);
    if (btn) {
      btn.disabled = true;
      // Add winner name
      let winnerEl = btn.querySelector('.claim-winner');
      if (!winnerEl) {
        winnerEl = document.createElement('span');
        winnerEl.className = 'claim-winner';
        btn.appendChild(winnerEl);
      }
      winnerEl.textContent = `✓ ${winnerName}`;
    }
  }

  /**
   * Get the active ticket index for claims.
   */
  function getActiveTicketIndex() {
    return activeTicketIndex;
  }

  /**
   * Get all tickets.
   */
  function getTickets() {
    return tickets;
  }

  /**
   * Save marked numbers to localStorage for reconnection.
   */
  function saveMarkedNumbers() {
    try {
      const data = {};
      for (const [idx, nums] of Object.entries(markedByPlayer)) {
        data[idx] = Array.from(nums);
      }
      localStorage.setItem('housie-marked', JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  /**
   * Restore marked numbers from localStorage after reconnection.
   * Must be called AFTER init() and AFTER replaying drawn numbers.
   */
  function restoreMarkedNumbers() {
    try {
      const saved = localStorage.getItem('housie-marked');
      if (!saved) return;
      const data = JSON.parse(saved);

      for (const [idx, nums] of Object.entries(data)) {
        const ticketIdx = parseInt(idx);
        if (!markedByPlayer[ticketIdx]) markedByPlayer[ticketIdx] = new Set();

        nums.forEach(num => {
          // Only restore if the number has actually been drawn
          if (!drawnNumbers.has(num)) return;

          markedByPlayer[ticketIdx].add(num);

          // Find the cell and mark it visually
          const grid = document.getElementById(`ticket-grid-${ticketIdx}`);
          if (!grid) return;
          const cell = grid.querySelector(`.ticket-cell[data-num="${num}"]`);
          if (cell && !cell.classList.contains('marked')) {
            cell.classList.remove('callable');
            cell.classList.add('marked');
          }
        });

        // Update header count
        const grid = document.getElementById(`ticket-grid-${ticketIdx}`);
        if (grid) {
          const markedCount = grid.querySelectorAll('.ticket-cell.marked').length;
          const ticketEl = document.getElementById(`ticket-${ticketIdx}`);
          if (ticketEl) {
            const header = ticketEl.querySelector('.ticket-header span:last-child');
            if (header) header.textContent = `${markedCount}/15`;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * Clear saved marked numbers (for new game).
   */
  function clearMarkedNumbers() {
    markedByPlayer = {};
    localStorage.removeItem('housie-marked');
  }

  return {
    init,
    markNumber,
    renderAllTickets,
    disableClaim,
    resetClaimButtons,
    getActiveTicketIndex,
    getTickets,
    updateCurrentNumberDisplay,
    updateNumbersCount,
    highlightCallableNumbers,
    restoreMarkedNumbers,
    clearMarkedNumbers,
    setOnMark: (cb) => { onMarkCallback = cb; },
  };
})();
