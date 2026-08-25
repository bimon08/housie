# Housie (Tambola) Multiplayer PWA Game

## Status: READY TO BUILD

When the user says "continue", start building immediately from the implementation plan below. Do NOT ask questions — all decisions have been made.

---

## Decisions Made

- **Project type**: Node.js + Express + Socket.io (NOT Next.js)
- **Frontend**: Vanilla HTML/CSS/JS (single page app, no framework)
- **PWA**: Service Worker + Web Manifest for installability
- **Deployment**: Render (free tier) — supports WebSockets natively
- **Design**: Colorful, fun, game-like UI (see Design Specs below for details)
- **TTS**: Digit-by-digit number calling using Web Speech API ("Four and one... forty-one!")
- **Tickets**: FREE, no money involved at all. Host sets ticket count for all players (default 2, max 6)
- **Prize categories**: Early Five, First Row, Second Row, Third Row, Full House
- **No money tracking**: This is a fun social game. No cash, no wallet, no coins, no payments anywhere.
- **Max players per room**: 50

---

## Key Game Rules

### Tickets
- Tickets are FREE — no cost, no money involved anywhere in the app
- The HOST chooses how many tickets each player gets (not the player)
- Default: 2 tickets per player
- Maximum: 6 tickets per player
- Host sets this on the Create Game screen using a +/- selector (like the reference screenshot)

### Prizes / Claims
- Players can claim: Early Five, First Row, Second Row, Third Row, Full House
- When a player claims and it is valid, ALL players see an announcement like "🎉 Rahul got First Row!"
- There is NO money, NO rewards, NO tracking — just the fun of winning
- Once a prize is claimed by someone, that category is closed (button greyed out)
- Game ends when Full House is claimed

### Privacy
- Players can ONLY see their OWN tickets (large, centered)
- Other players' tickets are NEVER shown
- Only show player names/avatars and their count around the game area

---

## Architecture

```
housie/
├── server.js                 # Express + Socket.io server (main entry)
├── package.json              # Dependencies: express, socket.io
├── game/
│   ├── Room.js               # Room management (code, players, state)
│   ├── Game.js               # Game state (number pool, draws, prizes)
│   ├── Ticket.js             # Housie ticket generation algorithm
│   └── Validator.js          # Claim validation logic
├── public/
│   ├── index.html            # Single page app (all screens)
│   ├── css/
│   │   └── style.css         # Colorful game theme, animations
│   ├── js/
│   │   ├── app.js            # SPA routing, state, socket events
│   │   ├── game.js           # Client game logic (tickets, marking, claims)
│   │   ├── tts.js            # Text-to-speech number announcer
│   │   └── ui.js             # UI helpers (toasts, animations, modals)
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (cache-first for static, network for WS)
│   └── icons/                # PWA icons (192x192, 512x512)
├── render.yaml               # Render deployment config
├── .gitignore
└── README.md
```

---

## Implementation Order

Build in this exact order:

### Phase 1: Server Foundation
1. `package.json` — init with express + socket.io
2. `server.js` — Express serves public/, Socket.io setup
3. `game/Room.js` — Room class (create, join, player management, ticket count setting)
4. `game/Ticket.js` — Housie ticket generation (3x9, 5 numbers per row, column ranges)
5. `game/Game.js` — Game state (number pool 1-90, draw, track called numbers)
6. `game/Validator.js` — Claim validation (check pattern against ticket + drawn numbers)

### Phase 2: Frontend Core
7. `public/index.html` — SPA with all screens (home, lobby, game, results)
8. `public/css/style.css` — Full colorful game theme (see Design Specs)
9. `public/js/app.js` — SPA router, socket connection, event handling
10. `public/js/game.js` — Render tickets, auto-mark, called numbers board
11. `public/js/tts.js` — Digit-by-digit TTS ("Four and one... forty-one!")
12. `public/js/ui.js` — Toasts, animations, modals

### Phase 3: PWA
13. `public/manifest.json` — PWA manifest
14. `public/sw.js` — Service Worker with cache + update strategy
15. Generate PWA icons

### Phase 4: Deployment and Polish
16. `render.yaml` — Render config
17. `.gitignore` + `README.md`
18. Test full flow locally with multiple browser tabs
19. Git init + first commit

---

## UI Screens (Reference: see design-reference/ folder for screenshots)

### Screen 1: Home Screen
Inspired by the reference app's home screen:
- Fun, colorful background (gradient with playful elements like leaves, patterns)
- Large title banner: "HOUSIE" with decorative styling (bold, maybe with a ribbon/banner effect)
- Player name input field at the top
- Two side-by-side cards:
  - LEFT: "Create Game" — with a fun icon/illustration, orange/warm button
  - RIGHT: "Join Game" — with a fun icon/illustration, blue/cyan button
- Between the cards: ticket count selector with - and + buttons and the number displayed
  - This is ONLY shown on the "Create Game" side since the host sets it
- "OR" divider between the two options
- Clean, rounded corners, card-based layout
- No coins, no VIP, no money indicators whatsoever

### Screen 2: Lobby (after creating/joining)
- Room code displayed prominently (large, copyable)
- "Share this code with friends!" text
- List of joined players (name + avatar/initial)
- Player count indicator
- Host sees: "Start Game" button (only enabled when 2+ players)
- Host can adjust ticket count here too before starting
- Fun waiting animation or "Waiting for players..." indicator

### Screen 3: Game Screen (Player View)
Inspired by the reference app's game screen:
- YOUR ticket(s) displayed LARGE and centered (this is the main focus)
  - If 2+ tickets, show them in a swipeable/tabbed view or stacked
  - Ticket styled like a real Housie ticket (3 rows x 9 columns grid)
  - Numbers clearly visible, blank cells have a subtle pattern
  - Marked numbers are highlighted (bright color, maybe with a stamp/daub effect)
- Called numbers display:
  - Current number shown BIG with animation (bouncing ball or reveal effect)
  - Small grid or scrollable list of all called numbers (1-90 grid, called ones highlighted)
  - "Numbers called: X/90" counter
- Claim buttons at the BOTTOM of the screen (always visible):
  - Row of buttons: "Early Five" | "First Row" | "Second Row" | "Third Row" | "Full House"
  - Each button is color-coded (yellow, green, blue, orange, red — like the reference)
  - Claimed prizes are greyed out with winner name shown
  - Buttons are only tappable, no reward/money shown
- Player names shown around the edges (just names, NO tickets shown)
- Numbers remaining indicator

### Screen 4: Game Screen (Host View)
Same as player view PLUS:
- A prominent "DRAW NUMBER" button (large, centered above tickets or floating)
- The host also has their own tickets and can play
- Host can see all player names

### Screen 5: Results Screen
- Shows after Full House is claimed
- List of all prizes and who won them
- Fun celebration animation (confetti, fireworks CSS)
- "Play Again" button (creates a new game in same room)
- "Leave Room" button

---

## Design Specs

IMPORTANT: The design should be FUN, COLORFUL, and GAME-LIKE. NOT dark/minimal/corporate.

### Color Palette
- **Background**: Rich gradient — deep green to teal (like a game table) with decorative elements
- **Cards/Panels**: Warm cream/beige (#FFF8E7) with rounded corners and subtle shadows
- **Primary accent**: Vibrant orange (#FF6B35) for CTAs and highlights
- **Secondary accent**: Sky blue (#4ECDC4) for secondary actions
- **Ticket background**: White with light grid lines
- **Marked numbers**: Bright orange/red circular stamp effect
- **Blank cells**: Subtle checkered/pattern (like the reference)
- **Claim buttons**: Each a different vibrant color:
  - Early Five: Yellow (#FFC107)
  - First Row: Green (#4CAF50)
  - Second Row: Blue (#2196F3)
  - Third Row: Orange (#FF9800)
  - Full House: Red (#F44336)

### Typography
- Google Font: "Fredoka One" for headings (fun, rounded, game-like)
- Google Font: "Nunito" for body text (friendly, readable)
- Large, bold numbers on tickets for easy reading on phones

### Animations
- Number draw: Bouncing ball animation that reveals the number
- Marking a number: Stamp/daub effect with a subtle pop
- Claim success: Confetti burst + banner announcement
- Button hover/tap: Scale bounce effect
- Screen transitions: Smooth slide/fade

### Layout
- Mobile-first design (most players will be on phones)
- Ticket takes up majority of screen real estate
- Claim buttons are fixed at bottom (always accessible)
- Called numbers in a collapsible/minimized panel (tap to expand full 1-90 grid)

---

## Housie Ticket Generation Rules

Standard Housie ticket: 3 rows x 9 columns = 27 cells, but only 15 contain numbers (5 per row, 4 blanks per row).

Column number ranges:
- Col 1: 1-9
- Col 2: 10-19
- Col 3: 20-29
- Col 4: 30-39
- Col 5: 40-49
- Col 6: 50-59
- Col 7: 60-69
- Col 8: 70-79
- Col 9: 80-90

Rules:
- Each column has 1-3 numbers (never 0, never more than 3)
- Numbers within a column are sorted top to bottom
- Each row has exactly 5 numbers
- No duplicate numbers across all tickets in a game

---

## Socket.io Events

### Client to Server
- `create-room` { playerName, ticketCount } -> response: { roomCode, playerId }
- `join-room` { roomCode, playerName } -> response: { success, playerId }
- `update-settings` { roomCode, ticketCount } -> host can change ticket count before game starts
- `start-game` { roomCode } -> triggers ticket distribution
- `draw-number` { roomCode } -> draws next number
- `claim-prize` { roomCode, prizeType, ticketIndex } -> validates claim
- `leave-room` { roomCode }
- `play-again` { roomCode } -> resets game, keeps players in room

### Server to Client
- `room-created` { roomCode, playerId }
- `player-joined` { playerName, playerCount, players[] }
- `player-left` { playerName, playerCount }
- `settings-updated` { ticketCount }
- `game-started` { tickets[] } — each player gets ONLY their own tickets
- `number-drawn` { number, drawnNumbers[], remaining }
- `claim-result` { valid, prizeType, winnerName, ticketIndex }
- `prize-claimed` { prizeType, winnerName } — broadcast to all
- `game-over` { winners[] }
- `error` { message }

---

## TTS Number Calling Format

Digit-by-digit, natural sounding:

- Single digits (1-9): "Number [word]!" -> "Number seven!"
- Teens (10-19): "One and [digit]... [word]!" -> "One and three... thirteen!"
- Tens (20,30...90): "Number [word]!" -> "Number twenty!"
- Others: "[digit] and [digit]... [word]!" -> "Four and one... forty-one!"

---

## Prize Patterns

```
Early Five:    First player to mark any 5 numbers on a single ticket
First Row:     All 5 numbers in row 1 marked on a single ticket
Second Row:    All 5 numbers in row 2 marked on a single ticket
Third Row:     All 5 numbers in row 3 marked on a single ticket
Full House:    All 15 numbers marked on a single ticket
```

---

## Host Controls (During Game)

The host has the same UI as players PLUS:
- **Draw Number** button (big, prominent, centered)
- The host ALSO gets tickets and can play while hosting
- Host sees a "Play Again" option on results screen (resets game, keeps room)

---

## Game Flow

```
1. Player opens app -> sees Home Screen
2. Enters their name
3a. Host taps "Create Game" (sets ticket count with +/- buttons, default 2)
    -> Room created, 4-digit code shown
3b. Player taps "Join Game" -> enters room code
4. Lobby shows all joined players
5. Host taps "Start Game" (2+ players required)
6. Each player receives their tickets (only THEIR tickets, never others')
7. Host taps "Draw" -> random number drawn from 1-90
8. All players hear TTS: "Four and one... forty-one!"
9. Number auto-marked on matching tickets for all players
10. Claim buttons at bottom: Early Five, First Row, Second Row, Third Row, Full House
11. Player taps claim -> server validates against their ticket + drawn numbers
12. If valid: "🎉 Rahul won First Row!" shown to everyone, button greyed out
13. If invalid: "❌ Not quite! Keep playing" shown to that player only
14. Game continues until Full House is claimed
15. Results screen: all prize winners listed
16. "Play Again" to restart with same room
```
