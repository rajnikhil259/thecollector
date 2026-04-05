const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// ─── Deck Helpers ─────────────────────────────────────────────────────────────
function createDeck() {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (const suit of suits)
    for (const value of values)
      deck.push({ suit, value, numVal: values.indexOf(value) });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(players, deck) {
  let i = 0;
  for (const card of deck) {
    players[i % players.length].hand.push(card);
    i++;
  }
}

function findAceOfSpades(players) {
  for (const p of players)
    for (const c of p.hand)
      if (c.suit === 'spades' && c.value === 'A') return p.id;
  return players[0].id;
}

// ─── Player Helpers ───────────────────────────────────────────────────────────
function activePlayers(players) {
  return players.filter(p => !p.eliminated);
}

function getPlayerIndex(players, id) {
  return players.findIndex(p => p.id === id);
}

function nextActiveIndex(players, currentIndex) {
  const n = players.length;
  for (let i = 1; i < n; i++) {
    const idx = (currentIndex + i) % n;
    if (!players[idx].eliminated) return idx;
  }
  return -1;
}

// ─── Round Helpers ────────────────────────────────────────────────────────────
// Returns the round entry with the highest base suit card
function findHighest(round, baseSuit) {
  let winner = null;
  let highestVal = -1;
  for (const entry of round) {
    if (entry.card.suit === baseSuit && entry.card.numVal > highestVal) {
      highestVal = entry.card.numVal;
      winner = entry;
    }
  }
  return winner;
}

// Returns highest base suit card among a subset of player ids
function findHighestAmong(round, baseSuit, playerIds) {
  let winner = null;
  let highestVal = -1;
  for (const entry of round) {
    if (playerIds.includes(entry.playerId) && entry.card.suit === baseSuit && entry.card.numVal > highestVal) {
      highestVal = entry.card.numVal;
      winner = entry;
    }
  }
  return winner;
}

// Safely eliminate all 0-card players (they escaped)
function eliminateZeroCardPlayers(room, excludeIds = []) {
  for (const p of room.players) {
    if (!p.eliminated && p.hand.length === 0 && !excludeIds.includes(p.id)) {
      p.eliminated = true;
      io.to(room.code).emit('playerEliminated', { playerId: p.id, name: p.name });
    }
  }
}

// ─── Room Init ────────────────────────────────────────────────────────────────
function initRoom(roomCode) {
  rooms[roomCode] = {
    code: roomCode,
    players: [],
    started: false,
    phase: 'lobby',
    wastePile: [],
    baseSuit: null,
    currentRound: [],
    roundLeaderId: null,
    roundNumber: 0,
    firstRound: true,
    endgameActive: false,   // true when 1v1 showdown is active
    showdownDrawerId: null, // player who draws from waste pile in showdown
    loser: null,
    host: null,
    currentTurnPlayerId: null,
  };
}

// ─── State Broadcasting ───────────────────────────────────────────────────────
function broadcastState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  for (const player of room.players) {
    io.to(player.socketId).emit('gameState', buildClientState(room, player.id));
  }
}

function buildClientState(room, playerId) {
  return {
    phase: room.phase,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      eliminated: p.eliminated,
      isRoundLeader: p.id === room.roundLeaderId,
      hand: p.id === playerId ? p.hand : null,
    })),
    baseSuit: room.baseSuit,
    currentRound: room.currentRound,
    roundLeaderId: room.roundLeaderId,
    wastePileCount: room.wastePile.length,
    myId: playerId,
    currentTurnPlayerId: room.phase === 'playing' ? room.currentTurnPlayerId : null,
    firstRound: room.firstRound,
    endgameActive: room.endgameActive,
    showdownDrawerId: room.showdownDrawerId,
    loser: room.loser,
    host: room.host,
    canSteal: canPlayerSteal(room, playerId),
    stealTarget: getStealTarget(room, playerId),
    roundNumber: room.roundNumber,
  };
}

function getStealTarget(room, playerId) {
  if (playerId !== room.roundLeaderId) return null;
  if (room.currentRound.length > 0) return null;
  const idx = getPlayerIndex(room.players, playerId);
  const nextIdx = nextActiveIndex(room.players, idx);
  if (nextIdx === -1) return null;
  const target = room.players[nextIdx];
  if (target.id === playerId) return null;
  return { id: target.id, name: target.name, cardCount: target.hand.length };
}

function canPlayerSteal(room, playerId) {
  if (playerId !== room.roundLeaderId) return false;
  if (room.currentRound.length > 0) return false;
  const idx = getPlayerIndex(room.players, playerId);
  const nextIdx = nextActiveIndex(room.players, idx);
  if (nextIdx === -1) return false;
  return room.players[nextIdx].id !== playerId;
}

// ─── Game Start ───────────────────────────────────────────────────────────────
function startGame(roomCode) {
  const room = rooms[roomCode];
  const deck = shuffle(createDeck());
  for (const p of room.players) p.hand = [];
  dealCards(room.players, deck);
  room.wastePile = [];
  room.phase = 'playing';
  room.started = true;
  room.firstRound = true;
  room.endgameActive = false;
  room.showdownDrawerId = null;
  room.currentRound = [];
  room.baseSuit = null;
  room.roundNumber = 0;
  room.loser = null;

  const leaderId = findAceOfSpades(room.players);
  room.roundLeaderId = leaderId;
  room.currentTurnPlayerId = leaderId;
  broadcastState(roomCode);
  io.to(roomCode).emit('gameStarted', { leaderId });
}

// ─── Game End ─────────────────────────────────────────────────────────────────
function endGame(roomCode, loserId) {
  const room = rooms[roomCode];
  room.phase = 'finished';
  room.loser = loserId;
  const loser = room.players.find(p => p.id === loserId);
  io.to(roomCode).emit('gameOver', { loserId, loserName: loser?.name });
  broadcastState(roomCode);
}

// ─── RESOLVE CLEAN ROUND ──────────────────────────────────────────────────────
// All active players have played. No interruption.
// Cards go to waste pile. Biggest base suit card wins.
// Then check endgame conditions.
function resolveRound(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

  const winnerEntry = findHighest(round, room.baseSuit) || round[0];
  const winnerPlayer = room.players.find(p => p.id === winnerEntry.playerId);

  // Cards always go to waste pile in clean rounds
  room.wastePile.push(...allCards);
  room.currentRound = [];
  room.firstRound = false;

  io.to(roomCode).emit('roundResolved', {
    winnerId: winnerEntry.playerId,
    winnerName: winnerPlayer.name,
    cards: allCards,
    toWaste: true,
  });

  // ── ENDGAME CHECK ──
  // After playing, check who now has 0 cards
  const zeroCardPlayerIds = round
    .map(e => e.playerId)
    .filter(id => {
      const p = room.players.find(pl => pl.id === id);
      return p && p.hand.length === 0;
    });

  if (zeroCardPlayerIds.length === 0) {
    // Nobody ran out — normal round, winner leads next
    eliminateZeroCardPlayers(room, []);
    const stillActive = activePlayers(room.players);
    if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }
    room.roundLeaderId = winnerEntry.playerId;
    room.currentTurnPlayerId = winnerEntry.playerId;
    room.roundNumber++;
    broadcastState(roomCode);
    return;
  }

  // Some players have 0 cards after this round
  // Find players who still have cards (n-card players)
  const nCardPlayers = room.players.filter(p => !p.eliminated && p.hand.length > 0);

  // ── CASE 1: ALL players played their last card (everyone has 0 cards) ──
  // Winner (highest card) LOSES — they won the round but have nobody to play against
  // All others escape safely
  if (nCardPlayers.length === 0) {
    for (const p of room.players) {
      if (!p.eliminated && p.id !== winnerEntry.playerId) {
        p.eliminated = true;
        io.to(roomCode).emit('playerEliminated', { playerId: p.id, name: p.name });
      }
    }
    endGame(roomCode, winnerEntry.playerId);
    return;
  }

  // ── CASE 2: Some players still have cards ──
  // First eliminate players with 0 cards who are NOT the winner — they escape safely
  // But DON'T eliminate yet — need to check the "bring back" rule first

  // Check: after eliminating 0-card players, how many remain?
  // Remaining = nCardPlayers + (winner if they have 0 cards)
  // But winner with 0 cards may or may not escape depending on who else remains

  // Eliminate all 0-card players EXCEPT winner for now
  for (const p of room.players) {
    if (!p.eliminated && p.hand.length === 0 && p.id !== winnerEntry.playerId) {
      p.eliminated = true;
      io.to(roomCode).emit('playerEliminated', { playerId: p.id, name: p.name });
    }
  }

  // Now check remaining active players (excluding winner if they have 0 cards)
  const remainingWithCards = activePlayers(room.players).filter(p => p.hand.length > 0);

  if (winnerPlayer.hand.length > 0) {
    // Winner still has cards — they are an n-card player
    // Check: only 1 player remains and it's the winner → they lose (won round, no opponent)
    if (remainingWithCards.length === 1 && remainingWithCards[0].id === winnerEntry.playerId) {
      endGame(roomCode, winnerEntry.playerId);
      return;
    }
    // Normal: winner leads next round
    const stillActive = activePlayers(room.players);
    if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }
    room.roundLeaderId = winnerEntry.playerId;
    room.currentTurnPlayerId = winnerEntry.playerId;
    room.roundNumber++;
    broadcastState(roomCode);
    return;
  }

  // Winner has 0 cards — check if they escape or get brought back
  if (remainingWithCards.length === 0) {
    // No one has cards left — winner loses (nobody to play against)
    endGame(roomCode, winnerEntry.playerId);
    return;
  }

  if (remainingWithCards.length >= 1) {
    // Only 1 n-card player remains — apply "bring back" check
    // Check if the sole remaining player played the biggest card
    const remainingIds = remainingWithCards.map(p => p.id);
    // Include winner in the check pool (winner has 0 cards)
    const allRemainingIds = [...remainingIds, winnerEntry.playerId];
    const biggestAmongRemaining = findHighestAmong(round, room.baseSuit, allRemainingIds);

    if (biggestAmongRemaining && biggestAmongRemaining.playerId === remainingWithCards[0]?.id) {
      // The n-card player played the biggest card among remaining → they LOSE (Bhabhi)
      // Winner (0 cards) escapes
      winnerPlayer.eliminated = true;
      io.to(roomCode).emit('playerEliminated', { playerId: winnerPlayer.id, name: winnerPlayer.name });
      endGame(roomCode, remainingWithCards[0].id);
      return;
    } else {
      // n-card player did NOT play biggest → bring back winner (0 cards) to play from waste pile
      // Winner does NOT escape — they become the showdown drawer
      // Start 1v1 showdown: winner draws from waste pile, n-card player plays from hand
      const nCardPlayer = remainingWithCards[0];
      room.endgameActive = true;
      room.showdownDrawerId = winnerEntry.playerId;

      // Winner leads (biggest card) — they draw from waste pile
      room.roundLeaderId = winnerEntry.playerId;
      room.currentTurnPlayerId = winnerEntry.playerId;
      room.roundNumber++;

      io.to(roomCode).emit('showdownStarted', {
        drawerId: winnerEntry.playerId,
        drawerName: winnerPlayer.name,
        nCardPlayerId: nCardPlayer.id,
        nCardPlayerName: nCardPlayer.name,
      });

      broadcastState(roomCode);
      return;
    }
  }

  // 2+ n-card players remain — winner (0 cards) escapes safely
  winnerPlayer.eliminated = true;
  io.to(roomCode).emit('playerEliminated', { playerId: winnerPlayer.id, name: winnerPlayer.name });

  const stillActive = activePlayers(room.players);
  if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }

  // Among remaining players, biggest base suit card leads next round
  const remainingIdsAll = stillActive.map(p => p.id);
  const newLeaderEntry = findHighestAmong(round, room.baseSuit, remainingIdsAll);
  const newLeader = newLeaderEntry
    ? room.players.find(p => p.id === newLeaderEntry.playerId)
    : stillActive[0];

  room.roundLeaderId = newLeader.id;
  room.currentTurnPlayerId = newLeader.id;
  room.roundNumber++;
  broadcastState(roomCode);
}

// ─── RESOLVE INTERRUPTED ROUND ────────────────────────────────────────────────
// A player had no base suit — plays off suit — round stops.
// Highest base suit card played so far picks up ALL cards → becomes round leader.
// Interrupting player WINS that confrontation.
function resolveInterrupted(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

  // Highest base suit card in round picks up all cards
  const pickerEntry = findHighest(round, room.baseSuit) || round[0];
  const pickerPlayer = room.players.find(p => p.id === pickerEntry.playerId);

  pickerPlayer.hand.push(...allCards);
  room.currentRound = [];
  room.firstRound = false;

  io.to(roomCode).emit('roundResolved', {
    winnerId: pickerEntry.playerId,
    winnerName: pickerPlayer.name,
    cards: allCards,
    toWaste: false,
    interrupted: true,
  });

  // Players who played before interruption and now have 0 cards escape safely
  eliminateZeroCardPlayers(room, []);

  const stillActive = activePlayers(room.players);
  if (stillActive.length <= 1) {
    endGame(roomCode, stillActive[0]?.id);
    return;
  }

  // Picker (who picked up cards) leads next round
  room.roundLeaderId = pickerEntry.playerId;
  room.currentTurnPlayerId = pickerEntry.playerId;
  room.roundNumber++;
  broadcastState(roomCode);
}

// ─── RESOLVE 1v1 SHOWDOWN ROUND ───────────────────────────────────────────────
// Drawer played from waste pile. nCard player responded.
// Biggest card leads next. If someone can't follow → they WIN (other picks up = Bhabhi).
function resolveShowdownRound(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

  const winnerEntry = findHighest(round, room.baseSuit) || round[0];
  const winnerPlayer = room.players.find(p => p.id === winnerEntry.playerId);

  // Cards go to waste pile
  room.wastePile.push(...allCards);
  room.currentRound = [];

  io.to(roomCode).emit('roundResolved', {
    winnerId: winnerEntry.playerId,
    winnerName: winnerPlayer.name,
    cards: allCards,
    toWaste: true,
    showdown: true,
  });

  // Winner of this round leads next — biggest card leads
  // If winner is the drawer (0 cards) → they draw again from waste pile
  // If winner is nCard player → they play from hand, drawer must draw from waste pile
  room.roundLeaderId = winnerEntry.playerId;
  room.currentTurnPlayerId = winnerEntry.playerId;
  room.roundNumber++;

  // Update showdown drawer: whoever is NOT the winner now must draw from waste pile next
  // Actually the rule is: whoever leads plays their card (sets base suit)
  // The other player follows. If drawer leads → draws from waste pile. If nCard leads → plays from hand.
  // The "drawer" role stays with the player who has 0 cards (they always draw from waste pile)
  // showdownDrawerId stays fixed — they always draw from waste pile regardless of who leads

  broadcastState(roomCode);
}

// ─── Socket Events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('createRoom', ({ name }) => {
    const code = Math.random().toString(36).substr(2, 5).toUpperCase();
    initRoom(code);
    const room = rooms[code];
    room.players.push({ id: socket.id, socketId: socket.id, name, hand: [], eliminated: false });
    room.host = socket.id;
    socket.join(code);
    socket.emit('roomCreated', { code, playerId: socket.id });
    broadcastState(code);
  });

  socket.on('joinRoom', ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { msg: 'Room not found' });
    if (room.started) return socket.emit('error', { msg: 'Game already started' });
    if (room.players.length >= 8) return socket.emit('error', { msg: 'Room full (max 8 players)' });
    room.players.push({ id: socket.id, socketId: socket.id, name, hand: [], eliminated: false });
    socket.join(code);
    socket.emit('roomJoined', { code, playerId: socket.id });
    io.to(code).emit('playerJoined', { name, id: socket.id });
    broadcastState(code);
  });

  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { msg: 'Only host can start' });
    if (room.players.length < 3) return socket.emit('error', { msg: 'Need at least 3 players' });
    startGame(code);
  });

  socket.on('playCard', ({ code, cardIndex }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    if (room.currentTurnPlayerId !== socket.id) return socket.emit('error', { msg: 'Not your turn' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;

    // ── SHOWDOWN: drawer draws from waste pile ──
    // In showdown, the drawer picks a card from waste pile by index
    // cardIndex here is the waste pile index they chose
    if (room.endgameActive && room.showdownDrawerId === socket.id && player.hand.length === 0) {
      if (room.wastePile.length === 0) return socket.emit('error', { msg: 'Waste pile is empty!' });
      const wasteIdx = cardIndex % room.wastePile.length; // they pick a number, we mod to valid range
      const drawnCard = room.wastePile.splice(wasteIdx, 1)[0];
      player.hand.push(drawnCard);
      io.to(code).emit('drewFromWaste', {
        playerId: socket.id,
        playerName: player.name,
        card: drawnCard,
        wasteIdx,
      });
      // Now they play that card immediately
      player.hand.splice(player.hand.indexOf(drawnCard), 1);
      room.baseSuit = drawnCard.suit;
      room.currentRound.push({ playerId: socket.id, playerName: player.name, card: drawnCard });
      io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card: drawnCard, baseSuit: room.baseSuit });

      // Move to other player's turn
      const active = activePlayers(room.players);
      const currentIdx = active.findIndex(p => p.id === socket.id);
      const nextIdx = (currentIdx + 1) % active.length;
      room.currentTurnPlayerId = active[nextIdx].id;
      broadcastState(code);
      return;
    }

    if (cardIndex < 0 || cardIndex >= player.hand.length) return;
    const card = player.hand[cardIndex];

    // ── ENFORCE BASE SUIT (all rounds including first) ──
    if (room.currentRound.length > 0 && room.baseSuit) {
      const hasSuit = player.hand.some(c => c.suit === room.baseSuit);
      if (hasSuit && card.suit !== room.baseSuit) {
        return socket.emit('error', { msg: 'You must play ' + room.baseSuit + ' — you have it!' });
      }
    }

    player.hand.splice(cardIndex, 1);

    // First card of round sets base suit
    if (room.currentRound.length === 0) {
      room.baseSuit = card.suit;
    }

    room.currentRound.push({ playerId: socket.id, playerName: player.name, card });
    io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card, baseSuit: room.baseSuit });

    // ── SHOWDOWN INTERRUPTION ──
    // In showdown, if nCard player has no base suit → they interrupt → they WIN → drawer is Bhabhi
    // If drawer draws wrong suit → they interrupt → they WIN → nCard player is Bhabhi
    if (room.endgameActive && room.currentRound.length === 2) {
      // Both played — check if anyone played off suit (interruption)
      const offSuitEntry = room.currentRound.find(e => e.card.suit !== room.baseSuit);
      if (offSuitEntry) {
        // Off-suit player interrupts → they WIN → the other is Bhabhi
        const loserEntry = room.currentRound.find(e => e.playerId !== offSuitEntry.playerId);
        room.wastePile.push(...room.currentRound.map(e => e.card));
        room.currentRound = [];
        io.to(code).emit('showdownOver', {
          winnerId: offSuitEntry.playerId,
          loserId: loserEntry.playerId,
        });
        endGame(code, loserEntry.playerId);
        return;
      }
      // Both played base suit — resolve showdown round normally
      resolveShowdownRound(code);
      return;
    }

    // ── NORMAL INTERRUPTION (round 2+ only, not first round) ──
    if (!room.firstRound && !room.endgameActive && card.suit !== room.baseSuit) {
      io.to(code).emit('roundInterrupted', { playerId: socket.id, playerName: player.name });
      resolveInterrupted(code);
      return;
    }

    // Check if all active players have played
    const active = activePlayers(room.players);
    const playersWhoPlayed = new Set(room.currentRound.map(e => e.playerId));
    const allPlayed = active.every(p => playersWhoPlayed.has(p.id));

    if (allPlayed) {
      resolveRound(code);
    } else {
      const currentIdx = active.findIndex(p => p.id === socket.id);
      const nextIdx = (currentIdx + 1) % active.length;
      room.currentTurnPlayerId = active[nextIdx].id;
      broadcastState(code);
    }
  });

  // ── DRAW FROM WASTE (showdown drawer picks a number) ──
  socket.on('drawFromWaste', ({ code, wasteNumber }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    if (!room.endgameActive) return;
    if (room.showdownDrawerId !== socket.id) return socket.emit('error', { msg: 'Not your draw' });
    if (room.currentTurnPlayerId !== socket.id) return socket.emit('error', { msg: 'Not your turn' });
    if (room.wastePile.length === 0) return socket.emit('error', { msg: 'Waste pile is empty' });

    const player = room.players.find(p => p.id === socket.id);

    // wasteNumber is 1-based choice, mod to valid index
    const wasteIdx = (wasteNumber - 1) % room.wastePile.length;
    const drawnCard = room.wastePile.splice(wasteIdx, 1)[0];

    io.to(code).emit('drewFromWaste', {
      playerId: socket.id,
      playerName: player.name,
      card: drawnCard,
      wasteNumber,
    });

    // Set as base suit and play it
    room.baseSuit = drawnCard.suit;
    room.currentRound.push({ playerId: socket.id, playerName: player.name, card: drawnCard });
    io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card: drawnCard, baseSuit: room.baseSuit });

    // Move to other player's turn
    const active = activePlayers(room.players);
    const currentIdx = active.findIndex(p => p.id === socket.id);
    const nextIdx = (currentIdx + 1) % active.length;
    room.currentTurnPlayerId = active[nextIdx].id;
    broadcastState(code);
  });

  socket.on('stealCards', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    if (room.roundLeaderId !== socket.id) return;
    if (room.currentRound.length > 0) return;

    const idx = getPlayerIndex(room.players, socket.id);
    const nextIdx = nextActiveIndex(room.players, idx);
    if (nextIdx === -1) return;

    const target = room.players[nextIdx];
    if (!target || target.id === socket.id) return;

    const thief = room.players.find(p => p.id === socket.id);
    const stolen = [...target.hand];
    thief.hand.push(...stolen);
    target.hand = [];
    target.eliminated = true;

    io.to(code).emit('cardsStolen', {
      thiefId: socket.id, thiefName: thief.name,
      targetId: target.id, targetName: target.name,
      count: stolen.length,
    });

    const stillActive = activePlayers(room.players);
    if (stillActive.length <= 1) { endGame(code, stillActive[0]?.id || socket.id); return; }
    broadcastState(code);
  });

  socket.on('resign', ({ code }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const active = activePlayers(room.players);
    if (active.length !== 2) return socket.emit('error', { msg: 'Resign only when 2 players remain' });
    endGame(code, socket.id);
  });

  socket.on('restartGame', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.host !== socket.id) return socket.emit('error', { msg: 'Only host can restart' });
    for (const p of room.players) { p.hand = []; p.eliminated = false; }
    Object.assign(room, {
      wastePile: [], currentRound: [], baseSuit: null,
      phase: 'lobby', started: false, firstRound: true,
      endgameActive: false, showdownDrawerId: null,
      loser: null, roundNumber: 0,
      roundLeaderId: null, currentTurnPlayerId: null,
    });
    broadcastState(code);
    io.to(code).emit('gameRestarted');
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx === -1) continue;
      const player = room.players[idx];
      io.to(code).emit('playerLeft', { name: player.name, id: socket.id });
      if (!room.started) {
        room.players.splice(idx, 1);
        if (room.host === socket.id && room.players.length > 0) {
          room.host = room.players[0].socketId;
          io.to(code).emit('newHost', { id: room.host });
        }
      } else {
        player.eliminated = true;
        if (room.currentTurnPlayerId === socket.id) {
          const active = activePlayers(room.players);
          if (active.length <= 1) { endGame(code, active[0]?.id); }
          else {
            const cidx = active.findIndex(p => p.id === socket.id);
            room.currentTurnPlayerId = active[(cidx + 1) % active.length]?.id;
          }
        }
      }
      broadcastState(code);
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bhabhi server on port ${PORT}`));
