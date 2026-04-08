//  AUDIO ENGINE
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
      for (let i = 0; i < 4; i++) setTimeout(() => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.connect(gn); gn.connect(ctx.destination);
        o.frequency.setValueAtTime(700-i*100, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime+0.12);
        gn.gain.setValueAtTime(0.12, ctx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.12);
        o.start(); o.stop(ctx.currentTime+0.12);
      }, i*60);
    } else if (type === 'waste') {
      const o = ctx.createOscillator();
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.25);
      o.connect(g);
      o.frequency.setValueAtTime(400, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(100, ctx.currentTime+0.25);
      o.type = 'sine'; o.start(); o.stop(ctx.currentTime+0.25);
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
    } else if (type === 'escape') {
      [800, 1000, 1200].forEach((f,i) => setTimeout(() => {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.connect(gn); gn.connect(ctx.destination);
        o.frequency.value = f; o.type = 'sine';
        gn.gain.setValueAtTime(0.1, ctx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.2);
        o.start(); o.stop(ctx.currentTime+0.2);
      }, i*80));
    }
  } catch(e) {}
}

//  STATE

let socket, myId = null, roomCode = null, isHost = false;
let lastState = null, myName = '';

let pendingState = null;  
let animating = false;    

let lastRound = [];        
let lastBaseSuit = null;

//  TOAST

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

//  SCREEN HELPERS

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showRules() { showScreen('rulesScreen'); }
function openModal(type) {
  document.getElementById(type === 'create' ? 'createModal' : 'joinModal').classList.add('open');
  setTimeout(() => document.getElementById(type === 'create' ? 'createName' : 'joinName').focus(), 100);
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function copyRoomCode() {
  if (!roomCode) return;
  navigator.clipboard.writeText(roomCode).then(() => toast('Room code copied: ' + roomCode));
}

//  CARD HTML BUILDER

function suitSymbol(suit) {
  return { spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣' }[suit] || suit;
}
function suitColor(suit) {
  return ['hearts','diamonds'].includes(suit) ? 'red' : 'black';
}
function buildCardHTML(card, extraClass = '') {
  const sym = suitSymbol(card.suit);
  const col = suitColor(card.suit);
  return `<div class="card on-table ${col} ${extraClass}">
    <div class="card-corner top-left"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
    <div class="card-center">${sym}</div>
    <div class="card-corner bottom-right"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
  </div>`;
}

//  TABLE RENDERING

function renderTableCards(round, baseSuit, flashWinnerId = null) {
  const tc = document.getElementById('tableCenter');
  const label = '<div class="table-label">Current Round</div>';

  if (!round || round.length === 0) {
    tc.innerHTML = label + '<div class="empty-table-msg">Waiting for round to start...</div>';
    return;
  }

  let highestVal = -1, highestIdx = -1;
  round.forEach((e, i) => {
    if (e.card.suit === baseSuit && e.card.numVal > highestVal) {
      highestVal = e.card.numVal; highestIdx = i;
    }
  });

  tc.innerHTML = label;
  round.forEach((entry, i) => {
    const isWin = i === highestIdx;
    const isFlash = flashWinnerId && entry.playerId === flashWinnerId;
    const w = document.createElement('div');
    w.className = 'played-card-wrapper';
    w.dataset.playerId = entry.playerId;
    w.innerHTML = `
      ${buildCardHTML(entry.card, (isWin ? 'winning' : '') + (isFlash ? ' flash-win' : ''))}
      <div class="played-card-player-name">${entry.playerName}</div>
    `;
    tc.appendChild(w);
  });
}

function animateCardsAway(targetType, callback) {
  const wrappers = document.querySelectorAll('#tableCenter .played-card-wrapper');
  if (wrappers.length === 0) { callback && callback(); return; }

  const tc = document.getElementById('tableCenter');
  const tcRect = tc.getBoundingClientRect();

  let targetX, targetY;
  if (targetType === 'waste') {
    const wasteEl = document.getElementById('wasteCount');
    const wr = wasteEl.getBoundingClientRect();
    targetX = wr.left + wr.width/2;
    targetY = wr.top + wr.height/2;
  } else {
    targetX = window.innerWidth / 2;
    targetY = window.innerHeight;
  }

  let done = 0;
  wrappers.forEach((w, i) => {
    const wRect = w.getBoundingClientRect();
    const startX = wRect.left + wRect.width/2;
    const startY = wRect.top + wRect.height/2;
    const dx = targetX - startX;
    const dy = targetY - startY;

    const clone = w.querySelector('.card').cloneNode(true);
    clone.style.cssText = `
      position: fixed;
      left: ${startX}px;
      top: ${startY}px;
      transform: translate(-50%, -50%) scale(1);
      z-index: 9000;
      pointer-events: none;
      transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 1;
    `;
    document.body.appendChild(clone);

    setTimeout(() => {
      playSound(targetType === 'waste' ? 'waste' : 'card');
      clone.style.transform = `translate(-50%, -50%) scale(0.4) rotate(${(Math.random()-0.5)*30}deg)`;
      clone.style.left = targetX + 'px';
      clone.style.top = targetY + 'px';
      clone.style.opacity = '0';
    }, i * 60);

    setTimeout(() => {
      clone.remove();
      done++;
      if (done === wrappers.length) {
        callback && callback();
      }
    }, i * 60 + 500);
  });

  wrappers.forEach(w => {
    w.style.transition = 'opacity 0.15s';
    w.style.opacity = '0';
  });
}

function showCardOnTable(entry, baseSuit, allCards, callback, delay = 0) {
  setTimeout(() => {
    renderTableCards(allCards, baseSuit);
    const wrappers = document.querySelectorAll('#tableCenter .played-card-wrapper');
    const last = wrappers[wrappers.length - 1];
    if (last) {
      last.classList.add('card-fly-in');
      setTimeout(() => last.classList.remove('card-fly-in'), 400);
    }
    playSound('card');
    callback && callback();
  }, delay);
}

//  SOCKET INIT

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

  socket.on('playerJoined', ({ name }) => {
    toast(name + ' joined the room');
    playSound('deal');
  });

  socket.on('playerLeft', ({ name }) => toast(name + ' left', 'error'));

  socket.on('newHost', ({ id }) => {
    if (id === socket.id) { isHost = true; toast('You are now the host', 'good'); }
  });

  // MAIN STATE HANDLER 
 
  socket.on('gameState', (state) => {
    if (animating) {
      pendingState = state;
    } else {
      lastState = state;
      renderGame(state);
    }
  });

  socket.on('gameStarted', () => {
    showScreen('gameScreen');
    animateDeal();
    toast('Game started!', 'good');
  });

  socket.on('cardPlayed', ({ playerId, playerName, card, baseSuit }) => {
    playSound('card');
    lastRound = [...(lastState?.currentRound || [])];
    lastBaseSuit = baseSuit;

    const allOnTable = [...lastRound];
    if (!allOnTable.find(e => e.playerId === playerId)) {
      allOnTable.push({ playerId, playerName, card });
    }
    renderTableCards(allOnTable, baseSuit);

    const wrappers = document.querySelectorAll('#tableCenter .played-card-wrapper');
    const newCard = wrappers[wrappers.length - 1];
    if (newCard) {
      newCard.classList.add('card-fly-in');
      setTimeout(() => newCard.classList.remove('card-fly-in'), 400);
    }
  });

  socket.on('roundInterrupted', ({ playerId, playerName }) => {
    toast(playerName + ' has no ' + (lastBaseSuit || 'base') + ' — round interrupted!', 'error');
  });

  socket.on('roundResolved', ({ winnerId, winnerName, cards, toWaste, interrupted }) => {
    animating = true;

    if (toWaste) {
      const wrappers = document.querySelectorAll('#tableCenter .played-card-wrapper');
      wrappers.forEach(w => {
        if (w.querySelector('.winning')) {
          w.querySelector('.card').classList.add('flash-win');
        }
      });
      setTimeout(() => {
        animateCardsAway('waste', () => {
          animating = false;
          if (pendingState) {
            lastState = pendingState;
            pendingState = null;
            renderGame(lastState);
          }
        });
      }, 500);
    } else {
      toast((winnerName || 'Someone') + ' picks up all cards!', 'error');
      playSound('pickup');
      setTimeout(() => {
        animateCardsAway('pickup', () => {
          animating = false;
          if (pendingState) {
            lastState = pendingState;
            pendingState = null;
            renderGame(lastState);
          }
        });
      }, 400);
    }
  });

  socket.on('playerEliminated', ({ name }) => {
    playSound('escape');
    toast('🎉 ' + name + ' escaped safely!', 'good');
    showEscapeEffect(name);
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
    showShowdownEffect();
  });

  socket.on('showdownOver', ({ winnerId }) => {
    const name = lastState?.players?.find(p => p.id === winnerId)?.name || 'Someone';
    toast(name + ' interrupted — wins the showdown!', 'good');
  });

  socket.on('gameOver', ({ loserId, loserName }) => showGameOver(loserId, loserName));

  socket.on('gameRestarted', () => {
    document.getElementById('gameOverOverlay').classList.remove('show');
    animating = false; pendingState = null; lastRound = [];
    showScreen('lobbyScreen');
    toast('Game reset!');
  });

  socket.on('error', ({ msg }) => {
    toast(msg, 'error');
    document.getElementById('createError').textContent = msg;
    document.getElementById('joinError').textContent = msg;
  });
}

//  DEAL ANIMATION (on game start)

function animateDeal() {
  const tc = document.getElementById('tableCenter');
  tc.innerHTML = '<div class="table-label">Current Round</div><div class="dealing-msg">Dealing cards...</div>';

  for (let i = 0; i < 12; i++) {
    setTimeout(() => {
      const ghost = document.createElement('div');
      ghost.className = 'deal-ghost';
      ghost.style.cssText = `
        position: fixed;
        width: 40px; height: 58px;
        background: linear-gradient(135deg, #2a3a52, #1e2d40);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        left: ${20 + Math.random()*60}%;
        top: ${10 + Math.random()*70}%;
        z-index: 8000;
        pointer-events: none;
        animation: dealGhost 0.6s ease forwards;
      `;
      document.body.appendChild(ghost);
      setTimeout(() => ghost.remove(), 700);
      playSound('deal');
    }, i * 80);
  }

  setTimeout(() => {
    tc.innerHTML = '<div class="table-label">Current Round</div><div class="empty-table-msg">Waiting for round to start...</div>';
  }, 1100);
}

//  ESCAPE EFFECT

function showEscapeEffect(name) {
  const el = document.createElement('div');
  el.className = 'escape-popup';
  el.textContent = '🎉 ' + name + ' escaped!';
  document.getElementById('gameScreen').appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

//  SHOWDOWN EFFECT

function showShowdownEffect() {
  const el = document.createElement('div');
  el.className = 'showdown-popup';
  el.innerHTML = '⚡ FINAL SHOWDOWN ⚡';
  document.getElementById('gameScreen').appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

//  GAME ACTIONS

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
  animating = false; pendingState = null; lastRound = [];
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
  if (confirm('Resign and become The Collector?')) socket.emit('resign', { code: roomCode });
}

function restartGame() { socket.emit('restartGame', { code: roomCode }); }

//  RENDER LOBBY

function renderLobby(state) {
  const list = document.getElementById('playersList');
  list.innerHTML = '';
  document.getElementById('playerCount').textContent = state.players.length;

  state.players.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.style.animationDelay = (idx * 0.05) + 's';
    const isMe = p.id === myId, isHostP = p.id === state.host;
    row.innerHTML = `
      <div class="player-avatar">${p.name[0].toUpperCase()}</div>
      <div class="player-name-label">${p.name}</div>
      ${isHostP ? '<span class="player-badge badge-host">Host</span>' : ''}
      ${isMe ? '<span class="player-badge badge-you">You</span>' : ''}
    `;
    list.appendChild(row);
  });

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

//  RENDER GAME

function renderGame(state) {
  if (!state) return;
  if (state.phase === 'lobby') { renderLobby(state); return; }

  const me = state.players.find(p => p.id === myId);
  const isMyTurn = state.currentTurnPlayerId === myId;
  const opponents = state.players.filter(p => p.id !== myId);

  const bsEl = document.getElementById('baseSuitSymbol');
  if (state.baseSuit) {
    bsEl.textContent = suitSymbol(state.baseSuit);
    bsEl.className = 'suit-symbol ' + state.baseSuit;
  } else {
    bsEl.textContent = '—'; bsEl.className = 'suit-symbol';
  }
  document.getElementById('wasteCount').textContent = state.wastePileCount || 0;
  document.getElementById('roundNum').textContent = state.roundNumber || 0;
  document.getElementById('endgameBadge').className = 'endgame-badge' + (state.endgameActive ? ' show' : '');

  const oz = document.getElementById('opponentsZone');
  const newOppIds = opponents.map(o => o.id + o.handCount + o.eliminated + (state.currentTurnPlayerId === o.id)).join(',');
  if (oz.dataset.lastRender !== newOppIds) {
    oz.dataset.lastRender = newOppIds;
    oz.innerHTML = '';
    opponents.forEach(opp => {
      const isOppTurn = state.currentTurnPlayerId === opp.id;
      const div = document.createElement('div');
      div.className = 'opponent-card' + (opp.eliminated ? ' eliminated' : '') + (isOppTurn ? ' active-turn' : '');
      div.dataset.pid = opp.id;
      const count = opp.handCount || 0;
      const visible = Math.min(count, 7);
      let miniCards = '';
      for (let i = 0; i < visible; i++) {
        miniCards += `<div class="opponent-mini-card" style="left:${i*7}px;transform:rotate(${(i-visible/2)*2.5}deg);z-index:${i}"></div>`;
      }
      div.innerHTML = `
        <div class="opponent-name-tag" title="${opp.name}">${opp.name}</div>
        <div class="opponent-hand" style="width:${Math.max(26,visible*7+20)}px">${miniCards}</div>
        <div class="opp-card-count ${isOppTurn ? 'text-gold' : ''}">${count}${opp.eliminated ? ' ✓' : isOppTurn ? ' ▶' : ''}</div>
      `;
      oz.appendChild(div);
    });
  }

  if (!animating) {
    renderTableCards(state.currentRound, state.baseSuit);
  }

  // Showdown Panel 
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

  const statusEl = document.getElementById('statusMsg');
  if (me?.eliminated) {
    statusEl.textContent = '✓ You escaped safely!';
    statusEl.className = 'status-msg good';
  } else if (isMyDrawTurn) {
    statusEl.textContent = '⚡ Pick a number 1–' + state.wastePileCount + ' to draw!';
    statusEl.className = 'status-msg your-turn';
    playSound('turn');
  } else if (isMyTurn) {
    statusEl.textContent = state.canSteal
      ? '▶ Your turn — Play or steal from ' + state.stealTarget?.name
      : state.endgameActive ? '⚡ Showdown — Play your card!' : '▶ Your turn — Play a card!';
    statusEl.className = 'status-msg your-turn';
    playSound('turn');
  } else {
    const tp = state.players.find(p => p.id === state.currentTurnPlayerId);
    const theirDraw = state.endgameActive && state.showdownDrawerId === tp?.id;
    statusEl.textContent = tp
      ? (theirDraw ? '⚡ ' + tp.name + ' is drawing...' : 'Waiting for ' + tp.name + '...')
      : 'Waiting...';
    statusEl.className = 'status-msg';
  }

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
    if (state.players.filter(p => !p.eliminated).length === 2) {
      const rb = document.createElement('button');
      rb.className = 'btn btn-danger';
      rb.textContent = 'Resign';
      rb.onclick = resign;
      actions.appendChild(rb);
    }
  }

  const hc = document.getElementById('handContainer');
  document.getElementById('myHandCount').textContent = me?.hand?.length || 0;

  if (!me || me.eliminated) {
    hc.innerHTML = '<div class="escaped-msg">You escaped safely! 🎉</div>';
    return;
  }

  if (!me.hand || me.hand.length === 0) {
    hc.innerHTML = isMyDrawTurn
      ? '<div class="pick-prompt">Pick a number above ↑</div>'
      : '<div class="no-cards-msg">No cards in hand</div>';
    return;
  }

  const handKey = me.hand.map(c => c.suit + c.value).join(',') + isMyTurn;
  if (hc.dataset.lastHand === handKey) return;
  hc.dataset.lastHand = handKey;

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
    if (!isValid && canPlay) cardEl.style.opacity = '0.4';
    cardEl.style.animationDelay = (i * 0.04) + 's';
    cardEl.innerHTML = `
      <div class="card-corner top-left"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
      <div class="card-center">${sym}</div>
      <div class="card-corner bottom-right"><div class="card-val">${card.value}</div><div class="card-suit-small">${sym}</div></div>
    `;
    if (isValid && canPlay) {
      cardEl.addEventListener('click', (e) => { if (e.detail === 0) return; playCard(i); });
      addCardTouchEvents(cardEl, () => playCard(i));
    }
    hc.appendChild(cardEl);
  });
}

//  GAME OVER

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

//  TOUCH ANIMATION SYSTEM

function addCardTouchEvents(cardEl, onTap) {
  let touchTimer = null;
  let isTouching = false;

  cardEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isTouching = true;
    cardEl.classList.add('touching');
    playSound('deal');
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: false });

  cardEl.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isTouching) return;
    isTouching = false;
    touchTimer = setTimeout(() => {
      cardEl.classList.remove('touching');
      touchTimer = null;
    }, 180);
    if (onTap) onTap();
  }, { passive: false });

  cardEl.addEventListener('touchcancel', () => {
    isTouching = false;
    cardEl.classList.remove('touching');
    if (touchTimer) clearTimeout(touchTimer);
  }, { passive: true });
}

//  QUOTES

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

//  EVENT LISTENERS

document.getElementById('createName').addEventListener('keydown', e => { if (e.key==='Enter') createRoom(); });
document.getElementById('joinCode').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('joinName').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });
document.getElementById('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.getElementById('wastePickInput').addEventListener('keydown', e => { if (e.key==='Enter') drawFromWaste(); });

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

document.addEventListener('touchstart', () => { try { getAC().resume(); } catch(e){} }, { once: true, passive: true });
document.addEventListener('click', () => { try { getAC().resume(); } catch(e){} }, { once: true });
