# 🃏 The Collector

> *The game where smaller cards are more valuable than gold.*

A real-time multiplayer card game for 3–8 players. Race to shed all your cards — the last person holding cards becomes **The Collector** and loses. Play low, escape early.

---

## Features

- 🌐 Real-time multiplayer — play with friends on any device
- 📱 Mobile, tablet and desktop friendly
- 🔊 Procedural sound effects — no audio files needed
- ⚡ Final Showdown mode — blind lucky draw from the waste pile
- ⚔️ Steal mechanic — take all cards from the next player
- 🎨 Dark luxury card table UI with smooth animations
- 🏳️ Resign option when only 2 players remain
- 🚪 Instant room creation with shareable room codes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Server | Express |
| Realtime | Socket.io |
| Frontend | HTML + CSS + JavaScript (no framework) |
| Audio | Web Audio API |

---

## Project Structure

```
the-collector/
├── server.js          ← Game logic + Socket.io server
├── package.json
├── README.md
└── public/
    ├── index.html     ← HTML structure
    ├── style.css      ← Styles + responsive breakpoints
    └── game.js        ← Client game logic + rendering + audio
```

---

## Setup

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open `http://localhost:3000` in your browser.

For multiplayer on the same network, share your local IP with friends:
```
http://192.168.x.x:3000
```

---

## How to Play

### Goal
Get rid of all your cards. The last player holding cards is **The Collector** and loses.

### Setup
3–8 players. A 52-card deck is dealt one by one clockwise. Cards rank **2 (lowest) → A (highest)**.

### Starting the Game
The player holding the **Ace of Spades** goes first. They may optionally steal all cards from the next player clockwise before playing. They play any card — its suit becomes the **Base Suit**.

### Each Round
- Play moves **clockwise**
- Every player must follow the Base Suit if they have it
- The player with the **highest Base Suit card** wins the round
- All cards go to the **waste pile**
- The winner leads the next round, playing any card to set the new Base Suit
- Before playing, the Round Leader may **steal all cards** from the next active player

### Interruption *(Round 2 onwards)*
If a player has no Base Suit card, they play any card — this **interrupts** the round. Players after them skip their turn. The player with the highest Base Suit card played so far picks up **all cards** into their hand and leads the next round.

> First round only: no interruption — all players still play and cards go to the waste pile normally.

### Escaping
When you play your last card in a clean round, you **safely escape** and win. The game continues among remaining players.

### Endgame
After every clean round, check how many players still have cards:

- **2+ players have cards** — normal play continues, biggest card leads
- **Only 1 player has cards and played the biggest card** — they are The Collector instantly
- **Only 1 player has cards but did NOT play the biggest card** — the biggest-card player is brought back and the 1v1 Final Showdown begins
- **Everyone played their last card** — the player with the highest card loses

### 1v1 Final Showdown
The dramatic finale — always between exactly 2 players:

1. The **Drawer** (0 cards) picks any number from 1 to the waste pile size. The pile is shuffled face-down — that numbered card is drawn blind by pure luck and played as the new Base Suit
2. The **Hand Player** must follow the Base Suit if they have it
3. Whoever **cannot follow** interrupts and **wins** — the other becomes The Collector
4. Biggest card leads the next showdown round. Continues until someone can't follow

### Resignation
When only 2 players remain, either player may voluntarily resign and become The Collector.

## Deployment
Deployed on render Open `http://thecollector-exb7.onrender.com/` in your browser.

## 👨‍💻 Author
- Developed by [NIKHIL RAJ] 
- 🎯 IIIT Manipur | B.Tech CSE