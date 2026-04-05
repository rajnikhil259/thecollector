// ═══════════════════════════════════════════
//  AUDIO ENGINE
// ═══════════════════════════════════════════
let AC;
function getAC() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}

function playSound(type) {
  try {
    const ctx = getAC();
    if (ctx.state === 'suspended') ctx.resume();
    const g = ctx.createGain();
    g.connect(ctx.destination);

    if (type === 'card') {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.07, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*(1-i/d.length)*0.3;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 2000;
      s.connect(f); f.connect(g);
      g.gain.setValueAtTime(0.4, ctx.currentTime);
      s.start();
    } else if (type === 'pickup') {
      for (let i = 0; i < 3; i++) setTimeout(() => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.connect(gn); gn.connect(ctx.destination);
        o.frequency.setValueAtTime(700-i*120, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime+0.1);
        gn.gain.setValueAtTime(0.12, ctx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.1);
        o.start(); o.stop(ctx.currentTime+0.1);
      }, i*55);
    } else if (type === 'win') {
      [523,659,784,1047].forEach((f,i) => setTimeout(() => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.connect(gn); gn.connect(ctx.destination);
        o.frequency.value = f; o.type = 'triangle';
        gn.gain.setValueAtTime(0.18, ctx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.4);
        o.start(); o.stop(ctx.currentTime+0.4);
      }, i*90));
    } else if (type === 'lose') {
      [380,320,260,200].forEach((f,i) => setTimeout(() => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.connect(gn); gn.connect(ctx.destination);
        o.frequency.value = f; o.type = 'sawtooth';
        gn.gain.setValueAtTime(0.12, ctx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.3);
        o.start(); o.stop(ctx.currentTime+0.3);
      }, i*110));
    } else if (type === 'steal') {
      const o = ctx.createOscillator();
      g.gain.setValueAtTime(0.18, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.3);
      o.connect(g);
      o.frequency.setValueAtTime(550, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime+0.3);
      o.type = 'square'; o.start(); o.stop(ctx.currentTime+0.3);
    } else if (type === 'turn') {
      const o = ctx.createOscillator();
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.12);
      o.connect(g); o.frequency.value = 880; o.type = 'sine';
      o.start(); o.stop(ctx.currentTime+0.12);
    } else if (type === 'deal') {
      const buf = ctx.createBuffer(1, ctx.sampleRate*0.05, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1)*Math.exp(-i/(d.length*0.25))*0.35;
      const s = ctx.createBufferSource();
      s.buffer = buf; s.connect(g); g.gain.value = 0.45; s.start();
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════
//  QUOTES
// ═══════════════════════════════════════════
const quotes = [
  { text: "The Collector never meant to win — they just couldn't let go.", author: "Ancient wisdom of the card table" },
  { text: "Hold your Ace like a burden, not a blessing.", author: "Every experienced Collector player" },
  { text: "The game where smaller cards are more valuable than gold.", author: "Card game proverb" },
  { text: "He who plays last, picks up most.", author: "The first Collector rule" },
  { text: "A small card played wisely defeats the mightiest Ace.", author: "Grandma, probably" },
  { text: "Your 2 of clubs is worth more than their Ace of spades.", author: "The Collector philosophy" },
  { text: "Escape while you can. Cards in hand are chains.", author: "The Collector lore" },
  { text: "The waste pile remembers everything. Do you?", author: "Final showdown wisdom" },
  { text: "The Collector doesn't lose — they just accumulate too much.", author: "Post-game wisdom" },
];

let quoteIdx = 0;
function rotateQuote() {
  quoteIdx = (quoteIdx + 1) % quotes.length;
  const el = document.getElementById('quoteText');
  const au = document.getElementById('quoteAuthor');
  el.style.opacity = 0; au.style.opacity = 0;
  setTimeout(() => {
    el.textContent = quotes[quoteIdx].text;
    au.textContent = '— ' + quotes[quoteIdx].author;
    el.style.opacity = 1; au.style.opacity = 1;
  }, 500);
}
setInterval(rotateQuote, 5000);

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
let socket, myId = null, roomCode = null, isHost = false, lastState = null, myName = '';

// ═══════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function showRules() { showScreen('rulesScreen'); }

function openModal(type) {
  const id = type === 'create' ? 'createModal' : 'joinModal';
  document.getElementById(id).classList.add('open');
  setTimeout(() => document.getElementById(type === 'create' ? 'createName' : 'joinName').focus(), 300);
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  const c = document.getElementById('toastContainer');
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function copyRoomCode() {
  if (!roomCode) return;
  navigator.clipboard?.writeText(roomCode).then(() => toast('Code copied: ' + roomCode, 'good'))
    .catch(() => toast('Room code: ' + roomCode));
}

// ═══════════════════════════════════════════
//  SOCKET INIT
// ═══════════════════════════════════════════
function initSocket() {
  if (socket) return;
  socket = io();

  socket.on('roomCreated', ({ code, playerId }) => {
    myId = playerId; roomCode = code; isHost = true;
    closeModal('createModal');
    document.getElementById('roomCodeDisplay').textContent = code;
    showScreen('lobbyScreen');
    toast('Room created! Code: ' + code, 'good');
  });

  socket.on('roomJoined', ({ code, playerId }) => {
    myId = playerId; roomCode = code;
    closeModal('joinModal');
    document.getElementById('roomCodeDisplay').textContent = code;
    showScreen('lobbyScreen');
    toast('Joined room ' + code, 'good');
  });

  socket.on('playerJoined', ({ name }) => { toast(name + ' joined!'); playSound('deal'); });
  socket.on('playerLeft', ({ name }) => toast(name + ' left', 'error'));

  socket.on('newHost', ({ id }) => {
    if (id === socket.id) { isHost = true; toast('You are now the host', 'good'); }
  });

  socket.on('gameState', (state) => { lastState = state; renderGame(state); });

  socket.on('gameStarted', () => {
    showScreen('gameScreen');
    playSound('deal');
    toast('Game started!', 'good');
  });

  socket.on('cardPlayed', () => playSound('card'));

  socket.on('roundInterrupted', ({ playerName }) => {
    toast(playerName + ' interrupted the round!', 'error');
  });

  socket.on('roundResolved', ({ winnerId, winnerName, toWaste, interrupted }) => {
    if (!toWaste) {
      playSound('pickup');
      toast((winnerName || 'Someone') + ' picks up all cards!', 'error');
    }
  });

  socket.on('playerEliminated', ({ name }) => {
    playSound('win');
    toast('🎉 ' + name + ' escaped safely!', 'good');
  });

  socket.on('cardsStolen', ({ thiefName, targetName, count }) => {
    playSound('steal');
    toast(thiefName + ' stole ' + count + ' cards from ' + targetName + '!', 'error');
  });

  socket.on('drewFromWaste', ({ playerName, card, wasteNumber }) => {
    playSound('deal');
    toast(playerName + ' drew #' + wasteNumber + ' → ' + card.value + ' of ' + card.suit);
  });

  socket.on('showdownStarted', ({ drawerName, nCardPlayerName }) => {
    playSound('steal');
    toast('⚡ SHOWDOWN! ' + drawerName + ' vs ' + nCardPlayerName, 'error');
  });

  socket.on('showdownOver', ({ winnerId }) => {
    const name = lastState?.players?.find(p => p.id === winnerId)?.name || 'Someone';
    toast(name + ' interrupted — wins the showdown!', 'good');
  });

  socket.on('gameOver', ({ loserId, loserName }) => showGameOver(loserId, loserName));

  socket.on('gameRestarted', () => {
    document.getElementById('gameOverOverlay').classList.remove('show');
    showScreen('lobbyScreen');
    toast('Game reset!');
  });

  socket.on('error', ({ msg }) => {
    toast(msg, 'error');
    document.getElementById('createError').textContent = msg;
    document.getElementById('joinError').textContent = msg;
  });
}

// ═══════════════════════════════════════════
//  GAME ACTIONS
// ═══════════════════════════════════════════
function createRoom() {
  const name = document.getElementById('createName').value.trim();
  if (!name) { document.getElementById('createError').textContent = 'Enter your name'; return; }
  myName = name; initSocket(); socket.emit('createRoom', { name });
}

function joinRoom() {
  const name = document.getElementById('joinName').value.trim();
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!name) { document.getElementById('joinError').textContent = 'Enter your name'; return; }
  if (code.length < 4) { document.getElementById('joinError').textContent = 'Enter valid room code'; return; }
  myName = name; initSocket(); socket.emit('joinRoom', { name, code });
}

function startGame() { socket.emit('startGame', { code: roomCode }); }

function leaveRoom() {
  roomCode = null; myId = null; isHost = false; lastState = null;
  if (socket) { socket.disconnect(); socket = null; }
  document.getElementById('gameOverOverlay').classList.remove('show');
  showScreen('homeScreen');
}

function playCard(cardIndex) {
  if (!lastState) return;
  const me = lastState.players.find(p => p.id === myId);
  if (!me?.hand) return;
  const card = me.hand[cardIndex];
  if (lastState.currentRound.length > 0 && lastState.baseSuit) {
    const hasSuit = me.hand.some(c => c.suit === lastState.baseSuit);
    if (hasSuit && card.suit !== lastState.baseSuit) {
      toast('Must play ' + lastState.baseSuit + ' — you have it!', 'error');
      return;
    }
  }
  playSound('card');
  socket.emit('playCard', { code: roomCode, cardIndex });
}

function drawFromWaste() {
  if (!lastState?.endgameActive || lastState.showdownDrawerId !== myId) return;
  if (lastState.currentTurnPlayerId !== myId) { toast('Not your turn!', 'error'); return; }
  const input = document.getElementById('wastePickInput');
  const num = parseInt(input.value);
  const max = lastState.wastePileCount;
  if (!num || num < 1 || num > max) { toast('Pick 1 to ' + max, 'error'); return; }
  playSound('deal');
  socket.emit('drawFromWaste', { code: roomCode, wasteNumber: num });
  input.value = '';
}

function stealCards() { socket.emit('stealCards', { code: roomCode }); }

function resign() {
  if (confirm('Resign and become Bhabhi?')) socket.emit('resign', { code: roomCode });
}

function restartGame() { socket.emit('restartGame', { code: roomCode }); }

// ═══════════════════════════════════════════
//  RENDER LOBBY
// ═══════════════════════════════════════════
function renderLobby(state) {
  const list = document.getElementById('playersList');
  list.innerHTML = '';
  document.getElementById('playerCount').textContent = state.players.length;

  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const isMe = p.id === myId, isHostP = p.id === state.host;
    row.innerHTML = `
      <div class="player-avatar">${p.name[0].toUpperCase()}</div>
      <div class="player-name-label">${p.name}</div>
      ${isHostP ? '<span class="player-badge badge-host">Host</span>' : ''}
      ${isMe ? '<span class="player-badge badge-you">You</span>' : ''}
    `;
    list.appendChild(row);
  }

  const startBtn = document.getElementById('startBtn');
  if (state.host === myId) {
    startBtn.style.display = 'block';
    const need = 3 - state.players.length;
    startBtn.textContent = need > 0 ? `Need ${need} more player${need>1?'s':''}` : `Start Game (${state.players.length} players)`;
    startBtn.disabled = state.players.length < 3;
  } else {
    startBtn.style.display = 'none';
  }

  document.getElementById('lobbyInfo').textContent = state.host === myId
    ? 'You are the host. Start when ready.'
    : 'Waiting for host to start...';
}

// ═══════════════════════════════════════════
//  RENDER GAME
// ═══════════════════════════════════════════
function suitSymbol(suit) {
  return { spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣' }[suit] || suit;
}
function suitColor(suit) {
  return ['hearts','diamonds'].includes(suit) ? 'red' : 'black';
}

function renderGame(state) {
  if (!state) return;
  if (state.phase === 'lobby') { renderLobby(state); return; }

  const me = state.players.find(p => p.id === myId);
  const isMyTurn = state.currentTurnPlayerId === myId;
  const opponents = state.players.filter(p => p.id !== myId);

  // Top bar
  const bsEl = document.getElementById('baseSuitSymbol');
  if (state.baseSuit) {
    bsEl.textContent = suitSymbol(state.baseSuit);
    bsEl.className = 'suit-symbol ' + state.baseSuit;
  } else {
    bsEl.textContent = '—'; bsEl.className = 'suit-symbol';
  }
  document.getElementById('wasteCount').textContent = state.wastePileCount || 0;
  document.getElementById('roundNum').textContent = state.roundNumber || 0;

  const badge = document.getElementById('endgameBadge');
  badge.className = 'endgame-badge' + (state.endgameActive ? ' show' : '');

  // Opponents
  const oz = document.getElementById('opponentsZone');
  oz.innerHTML = '';
  for (const opp of opponents) {
    const isOppTurn = state.currentTurnPlayerId === opp.id;
    const div = document.createElement('div');
    div.className = 'opponent-card' + (opp.eliminated ? ' eliminated' : '') + (isOppTurn ? ' active-turn' : '');
    const count = opp.handCount || 0;
    const visible = Math.min(count, 7);
    let miniCards = '';
    for (let i = 0; i < visible; i++) {
      miniCards += `<div class="opponent-mini-card" style="left:${i*7}px;transform:rotate(${(i-visible/2)*2.5}deg);z-index:${i}"></div>`;
    }
    div.innerHTML = `
      <div class="opponent-name-tag" title="${opp.name}">${opp.name}</div>
      <div class="opponent-hand" style="width:${Math.max(28, visible*7+22)}px">${miniCards}</div>
      <div class="opp-card-count ${isOppTurn ? 'text-gold' : ''}">${count}${opp.eliminated ? ' ✓' : isOppTurn ? ' ▶' : ''}</div>
    `;
    oz.appendChild(div);
  }

  // Table
  const tc = document.getElementById('tableCenter');
  const label = '<div class="table-label">Current Round</div>';
  if (state.currentRound && state.currentRound.length > 0) {
    let highestVal = -1, highestIdx = -1;
    state.currentRound.forEach((e, i) => {
      if (e.card.suit === state.baseSuit && e.card.numVal > highestVal) {
        highestVal = e.card.numVal; highestIdx = i;
      }
    });
    tc.innerHTML = label;
    state.currentRound.forEach((entry, i) => {
      const sym = suitSymbol(entry.card.suit);
      const col = suitColor(entry.card.suit);
      const isWin = i === highestIdx;
      const w = document.createElement('div');
      w.className = 'played-card-wrapper';
      w.innerHTML = `
        <div class="card on-table ${col} ${isWin ? 'winning' : ''}">
          <div class="card-corner top-left"><div class="card-val">${entry.card.value}</div><div class="card-suit-small">${sym}</div></div>
          <div class="card-center">${sym}</div>
          <div class="card-corner bottom-right"><div class="card-val">${entry.card.value}</div><div class="card-suit-small">${sym}</div></div>
        </div>
        <div class="played-card-player-name">${entry.playerName}</div>
      `;
      tc.appendChild(w);
    });
  } else {
    tc.innerHTML = label + '<div id="emptyTableMsg" class="empty-table-msg">Waiting for round to start...</div>';
  }

  // Showdown panel
  const isDrawer = state.endgameActive && state.showdownDrawerId === myId;
  const isMyDrawTurn = isDrawer && isMyTurn && me && me.hand.length === 0;
  const showdownPanel = document.getElementById('showdownPanel');
  if (isMyDrawTurn) {
    showdownPanel.classList.add('show');
    document.getElementById('wastePickMax').textContent = '/ ' + state.wastePileCount + ' cards';
    document.getElementById('wastePickInput').max = state.wastePileCount;
  } else {
    showdownPanel.classList.remove('show');
  }

  // Status
  const statusEl = document.getElementById('statusMsg');
  if (me?.eliminated) {
    statusEl.textContent = '✓ You escaped safely!';
    statusEl.className = 'status-msg good';
  } else if (isMyDrawTurn) {
    statusEl.textContent = '⚡ Pick a number 1–' + state.wastePileCount + ' to draw your card!';
    statusEl.className = 'status-msg your-turn';
    playSound('turn');
  } else if (isMyTurn) {
    statusEl.textContent = state.canSteal
      ? '▶ Your turn — Play a card or steal from ' + state.stealTarget?.name
      : state.endgameActive ? '⚡ Showdown — Play your card!' : '▶ Your turn — Play a card!';
    statusEl.className = 'status-msg your-turn';
    playSound('turn');
  } else {
    const tp = state.players.find(p => p.id === state.currentTurnPlayerId);
    const theirDraw = state.endgameActive && state.showdownDrawerId === tp?.id;
    statusEl.textContent = tp
      ? (theirDraw ? '⚡ ' + tp.name + ' is drawing from waste pile...' : 'Waiting for ' + tp.name + '...')
      : 'Waiting...';
    statusEl.className = 'status-msg';
  }

  // Actions
  const actions = document.getElementById('playerActions');
  actions.innerHTML = '';
  if (!me?.eliminated) {
    if (isMyTurn && state.canSteal && state.stealTarget) {
      const sb = document.createElement('button');
      sb.className = 'steal-btn';
      sb.textContent = '⚔ Steal · ' + state.stealTarget.name + ' (' + state.stealTarget.cardCount + ')';
      sb.onclick = stealCards;
      actions.appendChild(sb);
    }
    const activePls = state.players.filter(p => !p.eliminated);
    if (activePls.length === 2) {
      const rb = document.createElement('button');
      rb.className = 'btn btn-danger';
      rb.textContent = 'Resign';
      rb.onclick = resign;
      actions.appendChild(rb);
    }
  }

  // Hand
  const hc = document.getElementById('handContainer');
  document.getElementById('myHandCount').textContent = me?.hand?.length || 0;

  if (!me || me.eliminated) {
    hc.innerHTML = '<div style="color:var(--green);font-size:0.8rem;padding:1rem;text-align:center;">You escaped safely! 🎉</div>';
    return;
  }

  if (!me.hand || me.hand.length === 0) {
    if (isMyDrawTurn) {
      hc.innerHTML = '<div style="color:var(--red2);font-size:0.75rem;padding:1rem;text-align:center;animation:pulse 1.5s ease infinite;">Pick a number above ↑</div>';
    } else {
      hc.innerHTML = '<div style="color:var(--text3);font-size:0.75rem;padding:1rem;text-align:center;">No cards in hand</div>';
    }
    return;
  }

  hc.innerHTML = '';
  me.hand.forEach((card, i) => {
    const canPlay = isMyTurn && !isMyDrawTurn;
    let isValid = canPlay;
    if (canPlay && state.currentRound.length > 0 && state.baseSuit) {
      const hasSuit = me.hand.some(c => c.suit === state.baseSuit);
      if (hasSuit && card.suit !== state.baseSuit) isValid = false;
    }
    const sym = suitSymbol(card.suit);
    const col = suitColor(card.suit);
    const cardEl = document.createElement('div');
    cardEl.className = `card card-enter ${col}` + (isValid && canPlay ? ' playable' : ' disabled');
    if (!isValid && canPlay) cardEl.style.opacity = '0.45';
    cardEl.innerHTML = `
      <div class="card-corner top-left"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
      <div class="card-center">${sym}</div>
      <div class="card-corner bottom-right"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
    `;
    if (isValid && canPlay) {
      // Desktop click
      cardEl.addEventListener('click', (e) => {
        // Only fire on real click (not touch-triggered ghost click)
        if (e.detail === 0) return; // synthesized, skip
        playCard(i);
      });
      // Touch with animation
      addCardTouchEvents(cardEl, () => playCard(i));
    }
    hc.appendChild(cardEl);
  });
}

function showGameOver(loserId, loserName) {
  const isMe = loserId === myId;
  document.getElementById('gameOverTitle').textContent = isMe ? "You're The Collector!" : loserName + ' is The Collector!';
  document.getElementById('gameOverTitle').className = 'game-over-title' + (isMe ? '' : ' winner');
  document.getElementById('gameOverEmoji').textContent = isMe ? '😭' : '🎉';
  document.getElementById('gameOverName').textContent = isMe
    ? 'Congratulations — you collected them all! 🃏'
    : 'You escaped! ' + loserName + ' is left holding the cards.';
  document.getElementById('restartBtn').style.display = isHost ? 'block' : 'none';
  document.getElementById('gameOverOverlay').classList.add('show');
  playSound(isMe ? 'lose' : 'win');
}

// ═══════════════════════════════════════════
//  TOUCH ANIMATION SYSTEM
// ═══════════════════════════════════════════
// Adds smooth lift animation on touch for card elements
// Uses touchstart/touchend to mimic hover on mobile

function addCardTouchEvents(cardEl, onTap) {
  let touchTimer = null;
  let isTouching = false;

  cardEl.addEventListener('touchstart', (e) => {
    e.preventDefault(); // prevent ghost click
    isTouching = true;
    cardEl.classList.add('touching');
    playSound('deal');
    // Clear any pending removal
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: false });

  cardEl.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isTouching) return;
    isTouching = false;
    // Keep animation briefly then settle
    touchTimer = setTimeout(() => {
      cardEl.classList.remove('touching');
      touchTimer = null;
    }, 180);
    // Fire the tap callback
    if (onTap) onTap();
  }, { passive: false });

  cardEl.addEventListener('touchcancel', () => {
    isTouching = false;
    cardEl.classList.remove('touching');
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: true });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('createName').addEventListener('keydown', e => { if (e.key==='Enter') createRoom(); });
document.getElementById('joinCode').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('joinName').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('wastePickInput').addEventListener('keydown', e => { if (e.key==='Enter') drawFromWaste(); });

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// Unlock audio on first touch
document.addEventListener('touchstart', () => { try { getAC().resume(); } catch(e){} }, { once: true, passive: true });
document.addEventListener('click', () => { try { getAC().resume(); } catch(e){} }, { once: true });
