const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Deck Helpers
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

// Player Helpers
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

//  Round Helpers 
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

// Room Init 
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
    endgameActive: false,  
    showdownDrawerId: null, 
    loser: null,
    host: null,
    currentTurnPlayerId: null,
  };
}

// State Broadcasting
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

// Game Start 
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

// Game End 
function endGame(roomCode, loserId) {
  const room = rooms[roomCode];
  room.phase = 'finished';
  room.loser = loserId;
  const loser = room.players.find(p => p.id === loserId);
  io.to(roomCode).emit('gameOver', { loserId, loserName: loser?.name });
  broadcastState(roomCode);
}

// RESOLVE CLEAN ROUND 
function resolveRound(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

  const winnerEntry = findHighest(round, room.baseSuit) || round[0];
  const winnerPlayer = room.players.find(p => p.id === winnerEntry.playerId);

  room.wastePile.push(...allCards);
  room.currentRound = [];
  room.firstRound = false;

  io.to(roomCode).emit('roundResolved', {
    winnerId: winnerEntry.playerId,
    winnerName: winnerPlayer.name,
    cards: allCards,
    toWaste: true,
  });

  //  ENDGAME CHECK 
  const zeroCardPlayerIds = round
    .map(e => e.playerId)
    .filter(id => {
      const p = room.players.find(pl => pl.id === id);
      return p && p.hand.length === 0;
    });

  if (zeroCardPlayerIds.length === 0) {
    eliminateZeroCardPlayers(room, []);
    const stillActive = activePlayers(room.players);
    if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }
    room.roundLeaderId = winnerEntry.playerId;
    room.currentTurnPlayerId = winnerEntry.playerId;
    room.roundNumber++;
    broadcastState(roomCode);
    return;
  }

  const nCardPlayers = room.players.filter(p => !p.eliminated && p.hand.length > 0);

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

  for (const p of room.players) {
    if (!p.eliminated && p.hand.length === 0 && p.id !== winnerEntry.playerId) {
      p.eliminated = true;
      io.to(roomCode).emit('playerEliminated', { playerId: p.id, name: p.name });
    }
  }

  const remainingWithCards = activePlayers(room.players).filter(p => p.hand.length > 0);

  if (winnerPlayer.hand.length > 0) {
    if (remainingWithCards.length === 1 && remainingWithCards[0].id === winnerEntry.playerId) {
      endGame(roomCode, winnerEntry.playerId);
      return;
    }

    const stillActive = activePlayers(room.players);
    if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }
    room.roundLeaderId = winnerEntry.playerId;
    room.currentTurnPlayerId = winnerEntry.playerId;
    room.roundNumber++;
    broadcastState(roomCode);
    return;
  }

  if (remainingWithCards.length === 0) {
    endGame(roomCode, winnerEntry.playerId);
    return;
  }

  if (remainingWithCards.length >= 1) {
    const remainingIds = remainingWithCards.map(p => p.id);
    const allRemainingIds = [...remainingIds, winnerEntry.playerId];
    const biggestAmongRemaining = findHighestAmong(round, room.baseSuit, allRemainingIds);

    if (biggestAmongRemaining && biggestAmongRemaining.playerId === remainingWithCards[0]?.id) {
      winnerPlayer.eliminated = true;
      io.to(roomCode).emit('playerEliminated', { playerId: winnerPlayer.id, name: winnerPlayer.name });
      endGame(roomCode, remainingWithCards[0].id);
      return;
    } else {
      const nCardPlayer = remainingWithCards[0];
      room.endgameActive = true;
      room.showdownDrawerId = winnerEntry.playerId;

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

  winnerPlayer.eliminated = true;
  io.to(roomCode).emit('playerEliminated', { playerId: winnerPlayer.id, name: winnerPlayer.name });

  const stillActive = activePlayers(room.players);
  if (stillActive.length <= 1) { endGame(roomCode, stillActive[0]?.id); return; }

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

// RESOLVE INTERRUPTED ROUND

function resolveInterrupted(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

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


  eliminateZeroCardPlayers(room, []);

  const stillActive = activePlayers(room.players);
  if (stillActive.length <= 1) {
    endGame(roomCode, stillActive[0]?.id);
    return;
  }

  room.roundLeaderId = pickerEntry.playerId;
  room.currentTurnPlayerId = pickerEntry.playerId;
  room.roundNumber++;
  broadcastState(roomCode);
}

// RESOLVE 1v1 SHOWDOWN ROUND 

function resolveShowdownRound(roomCode) {
  const room = rooms[roomCode];
  const round = room.currentRound;
  const allCards = round.map(e => e.card);

  const winnerEntry = findHighest(round, room.baseSuit) || round[0];
  const winnerPlayer = room.players.find(p => p.id === winnerEntry.playerId);

  room.wastePile.push(...allCards);
  room.currentRound = [];

  io.to(roomCode).emit('roundResolved', {
    winnerId: winnerEntry.playerId,
    winnerName: winnerPlayer.name,
    cards: allCards,
    toWaste: true,
    showdown: true,
  });

  room.roundNumber++;

  room.roundLeaderId = winnerEntry.playerId;
  room.currentTurnPlayerId = winnerEntry.playerId;

  broadcastState(roomCode);
}

// Socket Events
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

    // SHOWDOWN: drawer draws from waste pile
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

      player.hand.splice(player.hand.indexOf(drawnCard), 1);
      room.baseSuit = drawnCard.suit;
      room.currentRound.push({ playerId: socket.id, playerName: player.name, card: drawnCard });
      io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card: drawnCard, baseSuit: room.baseSuit });

      const active = activePlayers(room.players);
      const currentIdx = active.findIndex(p => p.id === socket.id);
      const nextIdx = (currentIdx + 1) % active.length;
      room.currentTurnPlayerId = active[nextIdx].id;
      broadcastState(code);
      return;
    }

    if (cardIndex < 0 || cardIndex >= player.hand.length) return;
    const card = player.hand[cardIndex];

    if (room.currentRound.length > 0 && room.baseSuit) {
      const hasSuit = player.hand.some(c => c.suit === room.baseSuit);
      if (hasSuit && card.suit !== room.baseSuit) {
        return socket.emit('error', { msg: 'You must play ' + room.baseSuit + ' — you have it!' });
      }
    }

    player.hand.splice(cardIndex, 1);

    if (room.currentRound.length === 0) {
      room.baseSuit = card.suit;
    }

    room.currentRound.push({ playerId: socket.id, playerName: player.name, card });
    io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card, baseSuit: room.baseSuit });


    if (room.endgameActive && room.currentRound.length === 2) {
      const offSuitEntry = room.currentRound.find(e => e.card.suit !== room.baseSuit);
      if (offSuitEntry) {
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
      resolveShowdownRound(code);
      return;
    }

    if (!room.firstRound && !room.endgameActive && card.suit !== room.baseSuit) {
      io.to(code).emit('roundInterrupted', { playerId: socket.id, playerName: player.name });
      resolveInterrupted(code);
      return;
    }

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

  socket.on('drawFromWaste', ({ code, wasteNumber }) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    if (!room.endgameActive) return;
    if (room.showdownDrawerId !== socket.id) return socket.emit('error', { msg: 'Not your draw' });
    if (room.currentTurnPlayerId !== socket.id) return socket.emit('error', { msg: 'Not your turn' });
    if (room.wastePile.length === 0) return socket.emit('error', { msg: 'Waste pile is empty' });

    const player = room.players.find(p => p.id === socket.id);

    const wasteIdx = (wasteNumber - 1) % room.wastePile.length;
    const drawnCard = room.wastePile.splice(wasteIdx, 1)[0];

    io.to(code).emit('drewFromWaste', {
      playerId: socket.id,
      playerName: player.name,
      card: drawnCard,
      wasteNumber,
    });

    if (room.currentRound.length === 0) {
      room.baseSuit = drawnCard.suit;
      room.currentRound.push({ playerId: socket.id, playerName: player.name, card: drawnCard });
      io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card: drawnCard, baseSuit: room.baseSuit });

      const active = activePlayers(room.players);
      const currentIdx = active.findIndex(p => p.id === socket.id);
      const nextIdx = (currentIdx + 1) % active.length;
      room.currentTurnPlayerId = active[nextIdx].id;
      broadcastState(code);
      return;
    }

    room.currentRound.push({ playerId: socket.id, playerName: player.name, card: drawnCard });
    io.to(code).emit('cardPlayed', { playerId: socket.id, playerName: player.name, card: drawnCard, baseSuit: room.baseSuit });

    if (drawnCard.suit !== room.baseSuit) {
      const nCardEntry = room.currentRound.find(e => e.playerId !== socket.id);
      room.wastePile.push(...room.currentRound.map(e => e.card));
      room.currentRound = [];
      io.to(code).emit('showdownOver', {
        winnerId: socket.id,
        loserId: nCardEntry.playerId,
      });
      endGame(code, nCardEntry.playerId);
      return;
    }

    resolveShowdownRound(code);
    return;

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
