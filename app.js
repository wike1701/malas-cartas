// Red (PeerJS) e interfaz. El anfitrión guarda la partida y manda a cada uno lo que puede ver.
(function () {
  'use strict';

  const PREFIX = 'malascartas-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Pausas en ms: [normal, partida rápida].
  const TRICK_PAUSE = [2200, 600];
  const BOT_DELAY = [2500, 1200];   // jugada automática de un desconectado
  const BOT_THINK = [1000, 250];    // lo que "piensa" un bot
  const ROUND_AUTO = 2000;          // en partida rápida la ronda pasa sola
  const EMOTES = ['😂', '😡', '😱', '👍', '👎', '🔥', '😭', '🤡', '🙏', '😎'];
  const EMOTE_GAP = 1200;
  // Modo dev: solo si se abre la página con ?dev. Permite añadir bots en la sala.
  const DEV = new URLSearchParams(location.search).has('dev');
  const DEV_Q = DEV ? 'dev&' : '';
  const TV_ROUND_PAUSE = 15000; // en modo TV la siguiente ronda empieza sola

  const URLP = new URLSearchParams(location.search);
  // Modo TV: esta pantalla crea la sala y muestra la mesa, pero no juega. Se juega desde los móviles.
  const TV = URLP.has('tv');

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  // Id por pestaña (sessionStorage): sobrevive a recargar, pero dos pestañas son dos jugadores.
  function getCid() {
    let id = null;
    try { id = sessionStorage.getItem('mc-cid'); } catch (e) { /* nada */ }
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem('mc-cid', id); } catch (e) { /* nada */ }
    }
    return id;
  }

  const myCid = getCid();
  let myName = '';
  let role = null;     // 'host' | 'guest'
  let peer = null;
  let code = null;
  let view = null;
  // Anfitrión
  let game = null;
  const conns = new Map(); // cid -> conexión
  const emoteSeen = new Map(); // cid -> último emoticono (para no saturar)
  let timer = null;
  // Invitado
  let hostConn = null;
  let leaving = false;

  // Temporizador en un Web Worker: el navegador congela los setTimeout de las pestañas en segundo
  // plano, y si el anfitrión cambia de pestaña la partida se pararía.
  const later = (function () {
    let worker = null;
    const cbs = new Map();
    let seq = 0;
    try {
      const src = 'onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = e => { const f = cbs.get(e.data); cbs.delete(e.data); if (f) f(); };
    } catch (e) { worker = null; }
    return {
      set(fn, ms) {
        if (!worker) return setTimeout(fn, ms);
        const id = ++seq; cbs.set(id, fn); worker.postMessage({ id, ms }); return id;
      },
      clear(id) { if (!worker) clearTimeout(id); else cbs.delete(id); },
    };
  })();

  // ---------- Utilidades de interfaz ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }
  // ---------- Pantalla completa ----------
  const FS_OK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function renderFs() {
    const fs = isFs();
    // En el fondo de la página principal solo hace falta el botón flotante; en partida, el de la barra.
    document.querySelectorAll('.fs-btn').forEach(b => {
      b.classList.toggle('hidden', !FS_OK);
      b.textContent = fs ? '🗗' : '⛶';
      b.title = fs ? 'Salir de pantalla completa' : 'Pantalla completa';
      b.setAttribute('aria-pressed', String(fs));
    });
    document.querySelectorAll('.fs-only').forEach(b => b.classList.toggle('hidden', !FS_OK));
  }
  // landscape: además intenta girar la pantalla a horizontal (Android; iPhone no lo permite).
  async function setFullscreen(on, landscape) {
    try {
      if (!on) {
        if (isFs()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      if (!isFs()) {
        const el = document.documentElement;
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
      }
      if (landscape && screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) {
      if (!isFs()) toast('Este navegador no deja poner la pantalla completa');
    }
  }
  document.addEventListener('fullscreenchange', renderFs);
  document.addEventListener('webkitfullscreenchange', renderFs);

  function showScreen(id) {
    $('#home').classList.toggle('hidden', id !== 'home');
    $('#game').classList.toggle('hidden', id !== 'game');
    $('#tv').classList.toggle('hidden', id !== 'tv');
  }
  let modalHtml = null;
  function modal(html) {
    if (!html) { modalHtml = null; $('#modal').classList.add('hidden'); return; }
    // Mismo contenido: no se repinta (evita parpadeos con cada vista nueva).
    if (html !== modalHtml || $('#modal').classList.contains('hidden')) $('#modal-body').innerHTML = html;
    modalHtml = html;
    $('#modal').classList.remove('hidden');
  }
  function inviteLink() {
    return location.origin + location.pathname + '?sala=' + code; // la invitación nunca lleva ?dev
  }
  // Código QR (SVG) con el enlace de invitación. Si la librería no ha cargado, nada.
  function qrSVG(text) {
    if (typeof qrcode === 'undefined') return '';
    try {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch (e) { return ''; }
  }

  // Símbolos de los palos dibujados en una caja de 40×40.
  const SUIT_G = {
    oros: '<circle cx="20" cy="20" r="15" fill="#e8b23a" stroke="#8a5a00" stroke-width="2"/><circle cx="20" cy="20" r="8.5" fill="none" stroke="#8a5a00" stroke-width="2"/><circle cx="20" cy="20" r="3" fill="#8a5a00"/>',
    copas: '<path d="M9 5h22c0 10-4 16-11 16S9 15 9 5z" fill="#d23b44" stroke="#7a1218" stroke-width="2"/><path d="M11.5 8h17" stroke="#f3a0a5" stroke-width="1.5" stroke-linecap="round"/><rect x="18" y="21" width="4" height="9" fill="#7a1218"/><path d="M12 30h16l2 6H10z" fill="#d23b44" stroke="#7a1218" stroke-width="2" stroke-linejoin="round"/>',
    espadas: '<path d="M20 1l4 6v19h-8V7z" fill="#4a86d6" stroke="#173f73" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 5v20" stroke="#cfe0f7" stroke-width="1.2"/><rect x="9" y="26" width="22" height="4" rx="2" fill="#173f73"/><rect x="18" y="30" width="4" height="6" fill="#173f73"/><circle cx="20" cy="37.5" r="2.2" fill="#173f73"/>',
    bastos: '<path d="M13 5c4-4 11-2 12 4l4 25c0 4-7 5-8 1L12 12c-2-3-1-5 1-7z" fill="#46a868" stroke="#1d5632" stroke-width="2" stroke-linejoin="round"/><circle cx="17" cy="11" r="1.8" fill="#1d5632"/><circle cx="21.5" cy="19" r="1.8" fill="#1d5632"/><circle cx="24" cy="27" r="1.8" fill="#1d5632"/>',
  };
  const SUIT_COL = { oros: '#b8860b', copas: '#c8323b', espadas: '#2563b0', bastos: '#2e8b57' };
  const SUIT_TINT = { oros: '#fbefc8', copas: '#f8dcdc', espadas: '#dce7f7', bastos: '#dcefe1' };
  // "Pintas": cortes en el marco que indican el palo, como en la baraja española.
  const PINTAS = { oros: [], copas: [50], espadas: [42, 58], bastos: [36, 50, 64] };
  const FIG = { 1: 'As', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };
  // Posiciones (centro) de los símbolos en las cartas del 2 al 7.
  const PIPS = {
    2: [[50, 45], [50, 105]],
    3: [[50, 38], [50, 75], [50, 112]],
    4: [[34, 45], [66, 45], [34, 105], [66, 105]],
    5: [[34, 42], [66, 42], [50, 75], [34, 108], [66, 108]],
    6: [[34, 40], [66, 40], [34, 75], [66, 75], [34, 110], [66, 110]],
    7: [[34, 38], [66, 38], [50, 57], [34, 80], [66, 80], [34, 112], [66, 112]],
  };
  // Dibujos sencillos de las figuras, centrados en (0,0). COL se cambia por el color del palo.
  const FIG_ART = {
    10: '<path d="M-13 22c0-9 6-13 13-13s13 4 13 13z" fill="COL"/><circle cx="0" cy="0" r="9" fill="#f1c9a0" stroke="#8a5a3a" stroke-width="1"/>' +
      '<path d="M-12-5c2-9 22-9 24 0c-6-3-18-3-24 0z" fill="COL" stroke="#3a2a1a" stroke-width="1"/><path d="M8-9c6-8 12-10 16-9c-4 3-8 7-12 10" fill="#fff" stroke="#3a2a1a" stroke-width="1"/>' +
      '<circle cx="-3" cy="1" r="1" fill="#3a2a1a"/><circle cx="3" cy="1" r="1" fill="#3a2a1a"/><path d="M-3 5q3 2 6 0" stroke="#8a3a2a" fill="none" stroke-width="1"/>',
    11: '<path d="M-14 22l3-14c-3-6-2-16 6-20l2-6 4 6c7 2 13 9 12 16l-4 3-6-3-4 6 3 12z" fill="#9a6532" stroke="#4a2a12" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M-5-12c-6 3-9 10-8 18l3-1c0-6 2-11 6-14z" fill="#3a2414"/><circle cx="4" cy="-6" r="1.6" fill="#1a0f06"/>' +
      '<path d="M-9 4h16l2 6h-20z" fill="COL" stroke="#3a2a1a" stroke-width="1"/>',
    12: '<path d="M-15 24c0-10 7-14 15-14s15 4 15 14z" fill="COL"/><circle cx="0" cy="2" r="9" fill="#f1c9a0" stroke="#8a5a3a" stroke-width="1"/>' +
      '<path d="M-9 4c1 10 17 10 18 0c-3 4-15 4-18 0z" fill="#d9d2c4" stroke="#8a8070" stroke-width="1"/>' +
      '<path d="M-11-6v-12l5.5 6 5.5-9 5.5 9 5.5-6v12z" fill="#e8b23a" stroke="#8a5a00" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<circle cx="0" cy="-11" r="1.6" fill="#c8323b"/><circle cx="-3" cy="2" r="1" fill="#3a2a1a"/><circle cx="3" cy="2" r="1" fill="#3a2a1a"/>',
  };

  const pip = (s, x, y, size) => '<g transform="translate(' + (x - size / 2) + ' ' + (y - size / 2) + ') scale(' + size / 40 + ')">' + SUIT_G[s] + '</g>';

  function frameSVG(s) {
    const gap = 3;
    let edges = '';
    for (const y of [5, 145]) {
      let x0 = 5;
      for (const cx of PINTAS[s].concat([95 + gap])) {
        edges += '<line x1="' + x0 + '" y1="' + y + '" x2="' + (cx - gap) + '" y2="' + y + '"/>';
        x0 = cx + gap;
      }
    }
    return '<g stroke="' + SUIT_COL[s] + '" stroke-width="1.6" fill="none">' + edges +
      '<line x1="5" y1="5" x2="5" y2="145"/><line x1="95" y1="5" x2="95" y2="145"/></g>';
  }

  function faceSVG(card) {
    const s = card.s, n = card.n, c = SUIT_COL[s];
    let body;
    if (PIPS[n]) {
      body = PIPS[n].map(([x, y]) => pip(s, x, y, 24)).join('');
    } else if (n === 1) {
      body = '<circle cx="50" cy="75" r="31" fill="' + SUIT_TINT[s] + '" stroke="' + c + '" stroke-width="1.5"/>' +
        '<circle cx="50" cy="75" r="26" fill="none" stroke="' + c + '" stroke-width="1" stroke-dasharray="2 3"/>' + pip(s, 50, 75, 44);
    } else {
      body = '<rect x="21" y="20" width="58" height="110" rx="5" fill="' + SUIT_TINT[s] + '" stroke="' + c + '" stroke-width="1.5"/>' +
        '<g transform="translate(50 52)">' + FIG_ART[n].replace(/COL/g, c) + '</g>' + pip(s, 50, 96, 26) +
        '<rect x="24" y="114" width="52" height="12" rx="2" fill="' + c + '"/>' +
        '<text x="50" y="123" text-anchor="middle" font-size="8.5" font-weight="700" letter-spacing="1" fill="#fff">' + FIG[n].toUpperCase() + '</text>';
    }
    const corner = '<text x="13" y="21" text-anchor="middle" font-size="15" font-weight="800" fill="' + c + '">' + n + '</text>' + pip(s, 13, 30, 10);
    return '<svg class="face" viewBox="0 0 100 150" aria-hidden="true" font-family="Georgia, serif">' + frameSVG(s) + body +
      corner + '<g transform="rotate(180 50 75)">' + corner + '</g></svg>';
  }

  function cardHTML(card, o) {
    o = o || {};
    const cls = (o.sm ? ' sm' : '') + (o.playable ? ' playable' : '');
    const tag = o.button ? 'button' : 'div';
    const attrs = o.button ? (' data-play="' + esc(o.key) + '"' + (o.playable ? '' : ' disabled')) : '';
    if (!card) return '<' + tag + ' class="card back' + cls + '"' + attrs + ' aria-label="Carta oculta"><span class="medallion">MC</span></' + tag + '>';
    const label = (FIG[card.n] || card.n) + ' de ' + card.s;
    return '<' + tag + ' class="card s-' + card.s + cls + '"' + attrs + ' aria-label="' + label + '" title="' + label + '">' +
      faceSVG(card) + '</' + tag + '>';
  }

  // Corazones; los `lost` recién perdidos se "rompen" con una animación.
  function livesHTML(n, lost) {
    let s = '';
    for (let i = 0; i < MC.START_LIVES; i++) {
      if (i < n) s += '♥';
      else s += '<span class="empty' + (lost && i < n + lost ? ' break' : '') + '">♥</span>';
    }
    return s;
  }

  // ---------- Avatares ----------
  let myAvatar = (() => { const a = store('mc-avatar'); return MCAV.isValidAvatar(a) ? a : MCAV.defaultAvatar(myCid); })();
  let avatarOpen = false; // selector desplegado en la sala de espera
  const av = (a, cls) => MCAV.avatarSvg(a, cls || '');

  function avatarPicker() {
    const photo = store('mc-photo');
    const upload = '<button class="av-pick upload" data-act="photo" title="Subir una foto">📷</button>';
    const mine = MCAV.isPhoto(photo)
      ? '<button class="av-pick' + (photo === myAvatar ? ' sel' : '') + '" data-av="photo" title="Tu foto">' + av(photo) + '</button>' : '';
    return '<div class="avatar-grid" role="group" aria-label="Elige tu avatar">' + upload + mine +
      MCAV.AVATAR_IDS.map(id => '<button class="av-pick' + (id === myAvatar ? ' sel' : '') + '" data-av="' + id +
        '" aria-pressed="' + (id === myAvatar) + '" title="' + esc(MCAV.AVATAR_NAMES[id]) + '">' + av(id) + '</button>').join('') +
      '</div>';
  }

  function renderHomeAvatar() {
    $('#my-avatar').innerHTML = av(myAvatar, 'big');
    $('#avatar-pick').innerHTML = avatarPicker();
  }

  // Elige mi avatar y, si ya estoy en una sala, lo comunica.
  function setMyAvatar(a) {
    if (!MCAV.isValidAvatar(a)) return;
    myAvatar = a;
    store('mc-avatar', a);
    renderHomeAvatar();
    if (role) { avatarOpen = false; send({ t: 'avatar', avatar: a }); }
  }

  // Recorta la imagen en cuadrado y la comprime hasta que quepa en un mensaje.
  async function photoFromFile(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('no es una imagen');
    let src = null, url = null;
    if (window.createImageBitmap) { try { src = await createImageBitmap(file); } catch (e) { src = null; } }
    if (!src) {
      url = URL.createObjectURL(file);
      src = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = url; });
    }
    try {
      const w = src.width, h = src.height, side = Math.min(w, h);
      if (!side) throw new Error('imagen vacía');
      for (const size of [128, 96, 64]) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = '#0c3d27';
        g.fillRect(0, 0, size, size);
        g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
        for (const q of [0.85, 0.7, 0.55]) {
          const data = c.toDataURL('image/jpeg', q);
          if (MCAV.isPhoto(data)) return data;
        }
      }
      throw new Error('demasiado grande');
    } finally {
      if (src.close) src.close();
      if (url) URL.revokeObjectURL(url);
    }
  }

  // El selector de archivos vive fuera de lo que se repinta.
  let photoInput = null;
  function choosePhoto() {
    if (!photoInput) {
      photoInput = document.createElement('input');
      photoInput.type = 'file';
      photoInput.accept = 'image/*';
      photoInput.hidden = true;
      photoInput.addEventListener('change', async () => {
        const file = photoInput.files && photoInput.files[0];
        photoInput.value = '';
        if (!file) return;
        try {
          const data = await photoFromFile(file);
          store('mc-photo', data);
          setMyAvatar(data);
        } catch (e) { toast('No se ha podido usar esa imagen'); }
      });
      document.body.appendChild(photoInput);
    }
    photoInput.click();
  }

  // ---------- Sonido y efectos ----------
  let fx = {}; // efectos del repintado actual (se calculan al llegar cada vista nueva)

  function renderMute() {
    const m = MCSND.isMuted();
    document.querySelectorAll('.mute-btn').forEach(b => {
      b.textContent = m ? '🔇' : '🔊';
      b.title = m ? 'Activar sonido' : 'Silenciar';
      b.setAttribute('aria-pressed', String(m));
    });
  }

  // Compara la vista anterior con la nueva: suena lo que toca y marca qué animar.
  function applyView(next) {
    const prev = view;
    const events = MCFX.detectEvents(prev, next);
    view = next;
    fx = { bids: {}, lives: {}, out: {}, deal: false, trick: -1, over: false };
    const S = MCSND.play;
    let turnDelay = 0.15;
    for (const e of events) {
      if (e.type === 'join') S('join');
      else if (e.type === 'deal') { fx.deal = true; S('deal', 0, e.n); turnDelay = 0.2 + e.n * 0.09; }
      else if (e.type === 'bid') { fx.bids[e.pi] = true; S('bid'); }
      else if (e.type === 'play') S('play');
      else if (e.type === 'trick') { fx.trick = e.pi; S(e.mine ? 'trickMine' : 'trickOther', 0.25); }
      else if (e.type === 'lives') { fx.lives[e.pi] = e.n; if (e.mine || TV) S('lifeLost', 0.2); }
      else if (e.type === 'out') { fx.out[e.pi] = true; S('eliminated', 0.5); }
      else if (e.type === 'over') { fx.over = true; S(e.win || TV ? 'victory' : 'defeat', 0.9); }
      else if (e.type === 'turn') { fx.turn = true; S('turn', turnDelay); }
    }
    render();
    if (fx.trick >= 0 && !isFast()) later.set(sweepTrick, 1500);
    fx = {}; // otros repintados (p. ej. abrir el selector) no repiten las animaciones
  }

  const isFast = () => !!(view && view.settings && view.settings.fast);

  // ---------- Mesa redonda ----------
  // Ángulo del asiento i: yo siempre abajo (90°) y los demás en orden alrededor de la mesa.
  function seatAngle(i, v) {
    const n = v.players.length;
    const me = v.me >= 0 ? v.me : 0;
    return 90 + (((i - me) % n) + n) % n * (360 / n);
  }

  // ---------- Emoticonos ----------
  function renderEmoteBar() {
    $('#emote-bar').innerHTML = EMOTES.map(e => '<button class="emote-pick" data-emote="' + e + '" title="Enviar ' + e + '">' + e + '</button>').join('');
  }
  function toggleEmoteBar(open) {
    const bar = $('#emote-bar');
    const show = open === undefined ? bar.classList.contains('hidden') : open;
    bar.classList.toggle('hidden', !show);
    $('#btn-emote').setAttribute('aria-expanded', String(show));
  }
  // Burbuja sobre el asiento de quien lo manda. Vive fuera de #seats para que el repintado no la borre.
  function showEmote(pi, e) {
    if (!view || view.phase === 'lobby' || !view.players[pi] || EMOTES.indexOf(e) < 0) return;
    if (TV) { tvEmote(pi, e); return; }
    const ring = $('#ring');
    ring.querySelectorAll('.emote-bubble[data-pi="' + pi + '"]').forEach(el => el.remove());
    const b = document.createElement('div');
    b.className = 'emote-bubble';
    b.dataset.pi = pi;
    b.style.setProperty('--a', seatAngle(pi, view) + 'deg');
    b.textContent = e;
    b.setAttribute('aria-label', view.players[pi].name + ': ' + e);
    ring.appendChild(b);
    MCSND.play('emote');
    setTimeout(() => b.remove(), 2600);
  }

  // En la tele, la burbuja sale encima del asiento (fuera de #tv-seats para que el repintado no la borre).
  function tvEmote(pi, e) {
    const seat = $('#tv-seats').children[pi];
    if (!seat) return;
    document.querySelectorAll('.tv-emote[data-pi="' + pi + '"]').forEach(el => el.remove());
    const r = seat.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'tv-emote';
    b.dataset.pi = pi;
    b.style.left = (r.left + r.width / 2) + 'px';
    b.style.top = (r.top + r.height * 0.35) + 'px';
    b.textContent = e;
    document.body.appendChild(b);
    MCSND.play('emote');
    setTimeout(() => b.remove(), 2600);
  }

  // ---------- Perfil ampliado ----------
  let profileOpen = -1;
  function profileHTML(v, i) {
    const p = v.players[i];
    const tags = [];
    if (i === 0) tags.push('Anfitrión');
    if (p.bot) tags.push('🤖 Bot');
    if (v.phase !== 'lobby' && !p.alive) tags.push('Eliminado');
    if (!p.connected) tags.push('Desconectado');
    return '<div class="profile">' + av(p.avatar, 'profile-av') +
      '<h2>' + esc(p.name) + (i === v.me ? ' (tú)' : '') + '</h2>' +
      (v.phase !== 'lobby' ? '<div class="lives big-lives" aria-label="' + p.lives + ' vidas">' + livesHTML(p.lives) + '</div>' : '') +
      (tags.length ? '<p class="muted">' + tags.join(' · ') + '</p>' : '') +
      '<div class="row"><button class="btn" data-act="close-profile">Cerrar</button></div></div>';
  }

  // Las cartas de la mesa se deslizan hacia el asiento de quien ganó la mini ronda.
  function sweepTrick() {
    if (!view || view.phase !== 'trickEnd' || !view.lastTrick) return;
    const seat = $(TV ? '#tv-seats' : '#seats').children[view.lastTrick.winner];
    if (!seat) return;
    const to = seat.getBoundingClientRect();
    $(TV ? '#tv-table' : '#table').querySelectorAll('.play').forEach(el => {
      const r = el.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (r.left + r.width / 2);
      const dy = to.top + to.height / 2 - (r.top + r.height / 2);
      el.classList.remove('new');
      el.style.setProperty('--dx', dx + 'px');
      el.style.setProperty('--dy', dy + 'px');
      el.classList.add('sweep');
    });
  }

  function confetti() {
    const colors = ['#e9b949', '#e0505a', '#4a86d6', '#46a868', '#fffdf6'];
    let s = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < 40; i++) {
      s += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] +
        ';animation-delay:' + (Math.random() * 0.8).toFixed(2) + 's;animation-duration:' + (2 + Math.random() * 1.5).toFixed(2) + 's"></i>';
    }
    return s + '</div>';
  }

  // ---------- Render ----------
  function render() {
    if (!view) return;
    if (TV) { renderTV(); return; }
    const v = view;
    // Móvil en una partida con tele: hace de mando (solo tu mano y tus apuestas).
    const ctl = !!v.tv && role === 'guest' && v.phase !== 'lobby';
    document.body.classList.toggle('ctl', ctl);
    $('#ctl').classList.toggle('hidden', !ctl);
    $('#log-box').classList.toggle('hidden', ctl);
    if (ctl) { renderCtl(v); return; }
    const me = v.players[v.me];
    const isHost = role === 'host';
    const canLead = isHost || v.leader; // en modo TV manda el primer jugador
    const leadIdx = v.players.findIndex(p => p.connected && !p.bot);
    const leaderName = leadIdx >= 0 ? v.players[leadIdx].name : '';
    $('#btn-code').textContent = code;
    showScreen('game');
    const fast = isFast();
    document.body.classList.toggle('fast', fast);
    $('#btn-emote').classList.toggle('hidden', v.phase === 'lobby');
    if (v.phase === 'lobby') toggleEmoteBar(false);

    if (v.phase === 'lobby') {
      $('#lobby').classList.remove('hidden');
      $('#table-wrap').classList.add('hidden');
      $('#round-info').textContent = 'Sala de espera';
      const n = v.players.length;
      const qr = isHost ? qrSVG(inviteLink()) : '';
      const full = n >= MC.MAX_PLAYERS;
      $('#lobby').innerHTML =
        (v.tv ? '<p class="tv-hint">📺 Estás en la sala de la tele. La mesa se ve en la pantalla y tus cartas, aquí.</p>' : '') +
        '<p class="muted">Código de la sala</p><p class="big-code">' + esc(code) + '</p>' +
        (qr ? '<div class="lobby-qr" title="Escanéalo con el móvil para unirte">' + qr + '</div>' : '') +
        '<div class="row"><button class="btn" data-act="copy">Copiar enlace de invitación</button></div>' +
        '<p class="muted small">Pásales el código o el enlace a tus amigos' + (qr ? ', o que escaneen el QR' : '') + '. Máximo ' + MC.MAX_PLAYERS + ' jugadores.</p>' +
        '<ul class="lobby-list">' + v.players.map((p, i) =>
          '<li><span class="who"><button class="av-btn" data-profile="' + i + '" title="Ver perfil de ' + esc(p.name) + '">' + av(p.avatar, 'sm') + '</button>' +
          '<span>' + esc(p.name) + (i === v.me ? ' (tú)' : '') + '</span>' + (p.bot ? '<span class="badge bot">Bot</span>' : '') + '</span>' +
          (i === v.me ? '<button class="btn small-btn" data-act="toggle-av" aria-expanded="' + avatarOpen + '">Cambiar avatar</button>' : '') +
          (p.bot && isHost && DEV ? '<button class="btn small-btn" data-rmbot="' + i + '" title="Quitar bot">✕</button>' : '') +
          '<span class="muted small">' + (v.tv ? (i === leadIdx ? '👑 Manda' : '') : (i === 0 ? 'Anfitrión' : '')) + '</span></li>').join('') + '</ul>' +
        (avatarOpen ? avatarPicker() : '') +
        (isHost && DEV ? '<div class="dev-box"><span class="badge bot">DEV</span>' +
          '<button class="btn small-btn" data-act="addBot"' + (full ? ' disabled' : '') + '>🤖 Añadir bot</button></div>' : '') +
        '<label class="opt' + (isHost ? '' : ' readonly') + '"><input type="checkbox" data-set="fast"' + (fast ? ' checked' : '') +
          (isHost ? '' : ' disabled') + '> <span>⚡ <b>Partida rápida</b><span class="muted small"> · sin animaciones, pausas mínimas y las rondas pasan solas</span></span></label>' +
        (canLead
          ? '<button class="btn primary big" data-act="start"' + (n < MC.MIN_PLAYERS ? ' disabled' : '') + '>' +
            (n < MC.MIN_PLAYERS ? 'Esperando jugadores…' : 'Empezar partida (' + n + ' jugadores)') + '</button>' +
            (v.tv ? '<p class="muted small">👑 Eres el primero de la sala: tú decides cuándo empezar (también se puede con el mando de la tele).</p>'
              : '<p class="muted small">No cierres esta pestaña: la partida vive en tu navegador.</p>')
          : '<p class="muted">' + (v.tv ? 'Esperando a que ' + esc(leaderName) + ' empiece la partida…' : 'Esperando a que el anfitrión empiece la partida…') + '</p>');
      renderLog(v);
      renderModal(v);
      return;
    }

    $('#lobby').classList.add('hidden');
    $('#table-wrap').classList.remove('hidden');
    $('#round-info').textContent = 'Ronda ' + v.round + ' · ' + v.cards + (v.cards === 1 ? ' carta' : ' cartas') +
      (v.phase === 'playing' || v.phase === 'trickEnd' ? ' · Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + '/' + v.cards : '');

    // Asientos
    $('#seats').innerHTML = v.players.map((p, i) => {
      const cls = ['seat'];
      if (i === v.me) cls.push('me');
      if (i === v.turn) cls.push('turn');
      if (!p.alive) cls.push('dead');
      if (fx.lives && fx.lives[i]) cls.push('shake');
      if (fx.trick === i) cls.push('won-trick');
      const badges = (i === v.dealer && p.alive ? '<span class="badge">Reparte</span>' : '') +
        (p.bot ? '<span class="badge bot">Bot</span>' : '') +
        (!p.connected ? '<span class="badge off">Desconectado</span>' : '') +
        (!p.alive ? '<span class="badge dead' + (fx.out && fx.out[i] ? ' stamp' : '') + '">Eliminado</span>' : '');
      const bidTxt = p.bid === null ? '–' : p.bid;
      const ok = p.bid !== null && p.bid === p.won;
      // Ronda de 1 carta: ves las de los demás. Espectador (eliminado): ves todas.
      const showMini = p.alive && p.hand && p.hand.length && (v.spectator || (v.blind && i !== v.me));
      const mini = showMini
        ? '<div class="mini-hand' + (p.hand.length > 1 ? ' fan' : '') + '">' +
          p.hand.slice().sort((a, b) => MC.rank(a) - MC.rank(b)).map(c => cardHTML(c, { sm: true })).join('') + '</div>' : '';
      return '<div class="' + cls.join(' ') + '" style="--a:' + seatAngle(i, v) + 'deg"><div class="seat-head">' +
        '<button class="av-btn" data-profile="' + i + '" title="Ver perfil de ' + esc(p.name) + '">' + av(p.avatar, 'seat-av') + '</button>' +
        '<div class="seat-info"><div class="seat-top"><span class="name">' + esc(p.name) +
        (i === v.me ? ' (tú)' : '') + '</span>' + badges + '</div>' +
        '<div class="lives" aria-label="' + p.lives + ' vidas">' + livesHTML(p.lives, fx.lives && fx.lives[i]) + '</div></div></div>' +
        (p.alive ? '<div class="score">Dice <b class="' + (fx.bids && fx.bids[i] ? 'stamp' : '') + '">' + bidTxt +
          '</b> · Lleva <b class="' + (ok ? 'ok' : '') + (fx.trick === i ? ' pop' : '') + '">' + p.won + '</b></div>' : '') +
        mini + '</div>';
    }).join('');

    // Mesa: contador global de lo dicho + cartas jugadas
    const winner = v.lastTrick ? v.lastTrick.winner : -1;
    const shown = $('#table').querySelectorAll('.play').length;
    let counter = '';
    if (v.phase === 'bidding' || v.phase === 'playing' || v.phase === 'trickEnd') {
      const sum = v.bidSum !== undefined ? v.bidSum : v.players.reduce((s, p) => s + (p.alive && p.bid !== null ? p.bid : 0), 0);
      const diff = sum - v.cards;
      const allBid = v.players.every(p => !p.alive || p.bid !== null);
      const hint = !allBid ? 'van diciendo' : diff > 0 ? 'sobran ' + diff : 'faltan ' + (-diff);
      counter = '<div class="counter ' + (!allBid ? 'pending' : diff > 0 ? 'over' : 'under') + '" title="Suma de lo que ha dicho cada jugador">' +
        'Dicho <b>' + sum + '</b> / ' + v.cards + ' <span>· ' + hint + '</span></div>';
    }
    $('#table').innerHTML = counter + '<div class="plays">' + (v.trick.length
      ? v.trick.map((t, i) => '<div class="play' + (i >= shown ? ' new' : '') + (t.pi === winner ? ' win' : '') + '">' + cardHTML(t.card) +
          '<span class="who">' + av(v.players[t.pi].avatar, 'xs') + '<span>' + esc(v.players[t.pi].name) + '</span></span></div>').join('')
      : '<div class="table-empty">' + (v.phase === 'bidding'
          ? (v.blind ? 'Ronda de 1 carta: ves las de los demás, pero no la tuya' : 'Fase de apuestas')
          : 'Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + ' de ' + v.cards) + '</div>') + '</div>';

    // Estado
    const myTurn = v.turn === v.me;
    const turnName = v.turn >= 0 ? v.players[v.turn].name : '';
    let status = '';
    if (!me.alive && v.phase !== 'gameOver') {
      status = '👀 Modo espectador: ves las cartas de todos. ' + (v.phase === 'bidding' ? 'Dice ' + turnName + '…'
        : v.phase === 'playing' ? 'Tira ' + turnName + '…' : v.phase === 'trickEnd' ? v.players[winner].name + ' gana la mini ronda' : '');
    }
    else if (v.phase === 'bidding') status = myTurn ? '¿Cuántas mini rondas vas a ganar?' : 'Esperando a que ' + turnName + ' diga cuántas gana…';
    else if (v.phase === 'playing') status = myTurn ? 'Te toca: tira una carta' : 'Turno de ' + turnName;
    else if (v.phase === 'trickEnd') status = v.players[winner].name + ' gana la mini ronda';
    else if (v.phase === 'roundEnd') status = 'Fin de la ronda';
    $('#status').textContent = status;
    $('#status').classList.toggle('mine', myTurn);

    // Acciones (apuestas)
    let actions = '';
    if (v.phase === 'bidding' && me.alive) {
      if (myTurn) {
        for (let n = 0; n <= v.cards; n++) {
          const forb = n === v.forbidden;
          actions += '<button class="btn bid-btn' + (forb ? ' forbidden' : '') + '" data-bid="' + n + '"' +
            (forb ? ' disabled title="Prohibido"' : '') + '>' + n + '</button>';
        }
        if (v.forbidden !== null) actions += '<p class="note">No puedes decir ' + v.forbidden +
          ': la suma de todos daría ' + v.cards + ', igual que las mini rondas.</p>';
      }
    }
    $('#actions').innerHTML = actions;

    // Mano
    const canPlay = v.phase === 'playing' && myTurn;
    let hand = '';
    if (me.alive) {
      if (me.hand) {
        const sorted = me.hand.slice().sort((a, b) => MC.rank(a) - MC.rank(b));
        hand = sorted.map(c => cardHTML(c, { button: true, key: c.id, playable: canPlay })).join('');
      } else {
        for (let i = 0; i < me.handCount; i++) hand += cardHTML(null, { button: true, key: '#' + i, playable: canPlay });
      }
    }
    $('#hand').innerHTML = hand;
    $('#hand').classList.toggle('waiting', !canPlay);
    $('#hand').classList.toggle('my-turn', canPlay);
    if (fx.deal && !fast) Array.from($('#hand').children).forEach((el, i) => { el.classList.add('deal'); el.style.setProperty('--i', i); });

    renderLog(v);
    renderModal(v);
  }

  // ---------- Móvil como mando (modo TV) ----------
  function renderCtl(v) {
    const me = v.players[v.me];
    const fast = isFast();
    showScreen('game');
    document.body.classList.toggle('fast', fast);
    $('#btn-code').textContent = code;
    $('#btn-emote').classList.remove('hidden');
    $('#lobby').classList.add('hidden');
    $('#table-wrap').classList.add('hidden');
    $('#round-info').textContent = 'Ronda ' + v.round + ' · ' + v.cards + (v.cards === 1 ? ' carta' : ' cartas') +
      (v.phase === 'playing' || v.phase === 'trickEnd' ? ' · Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + '/' + v.cards : '');

    const ok = me.bid !== null && me.bid === me.won;
    $('#ctl-me').innerHTML = av(me.avatar, 'sm') + '<b class="ctl-name">' + esc(me.name) + '</b>' +
      '<span class="lives" aria-label="' + me.lives + ' vidas">' + livesHTML(me.lives, fx.lives && fx.lives[v.me]) + '</span>' +
      (me.alive ? '<span class="ctl-score">Dices <b class="' + (fx.bids && fx.bids[v.me] ? 'stamp' : '') + '">' + (me.bid === null ? '–' : me.bid) +
        '</b> · Llevas <b class="' + (ok ? 'ok' : '') + (fx.trick === v.me ? ' pop' : '') + '">' + me.won + '</b></span>' : '<span class="badge dead">Eliminado</span>');

    // La tele no enseña ninguna carta: en la ronda de 1 carta (o eliminado) las de los demás se ven aquí.
    const others = v.players.map((p, i) => ({ p, i })).filter(o => o.i !== v.me && o.p.alive && o.p.hand && o.p.hand.length);
    $('#ctl-others').innerHTML = others.length
      ? '<span class="muted small">' + (me.alive ? 'Cartas de los demás:' : 'Cartas de todos:') + '</span>' +
        others.map(o => '<span class="ctl-other">' + o.p.hand.map(c => cardHTML(c, { sm: true })).join('') +
          '<span>' + esc(o.p.name) + '</span></span>').join('')
      : '';

    const myTurn = v.turn === v.me;
    const turnName = v.turn >= 0 ? esc(v.players[v.turn].name) : '';
    const winner = v.lastTrick ? v.lastTrick.winner : -1;
    let status;
    if (!me.alive) status = 'Estás eliminado. Sigue la partida en la tele 📺';
    else if (v.phase === 'bidding') status = myTurn ? (v.blind ? '¿Cuántas vas a ganar? (tu carta no la ves)' : '¿Cuántas mini rondas vas a ganar?')
      : 'Turno de ' + turnName + ' · mira la tele 📺';
    else if (v.phase === 'playing') status = myTurn ? 'Te toca: tira una carta' : 'Turno de ' + turnName + ' · mira la tele 📺';
    else if (v.phase === 'trickEnd') status = winner === v.me ? '¡Ganas la mini ronda!' : esc(v.players[winner].name) + ' gana la mini ronda';
    else status = 'Mira la tele 📺';
    $('#ctl-status').innerHTML = status;
    $('#ctl-status').classList.toggle('mine', myTurn);

    let actions = '';
    if (v.phase === 'bidding' && me.alive && myTurn) {
      for (let n = 0; n <= v.cards; n++) {
        const forb = n === v.forbidden;
        actions += '<button class="btn bid-btn' + (forb ? ' forbidden' : '') + '" data-bid="' + n + '"' +
          (forb ? ' disabled title="Prohibido"' : '') + '>' + n + '</button>';
      }
      if (v.forbidden !== null) actions += '<p class="note">No puedes decir ' + v.forbidden + ': la suma daría ' + v.cards + '.</p>';
    }
    $('#ctl-actions').innerHTML = actions;

    const canPlay = v.phase === 'playing' && myTurn;
    let hand = '';
    if (me.alive) {
      if (me.hand) hand = me.hand.slice().sort((a, b) => MC.rank(a) - MC.rank(b))
        .map(c => cardHTML(c, { button: true, key: c.id, playable: canPlay })).join('');
      else for (let i = 0; i < me.handCount; i++) hand += cardHTML(null, { button: true, key: '#' + i, playable: canPlay });
    }
    $('#ctl-hand').innerHTML = hand;
    $('#ctl-hand').classList.toggle('waiting', !canPlay);
    $('#ctl-hand').classList.toggle('my-turn', canPlay);
    if (fx.deal && !fast) Array.from($('#ctl-hand').children).forEach((el, i) => { el.classList.add('deal'); el.style.setProperty('--i', i); });
    if (canPlay && navigator.vibrate && fx.turn) { try { navigator.vibrate(120); } catch (e) { /* nada */ } }
    renderModal(v);
  }

  // Resumen corto en el móvil-mando: el detalle se ve en la tele.
  function ctlModal(v) {
    const me = v.players[v.me];
    const lead = v.leader;
    let html = '';
    if (v.phase === 'gameOver') {
      const iWin = v.winners.indexOf(v.me) >= 0;
      html += (fx.over && iWin && !isFast() ? confetti() : '') +
        '<h2>' + (iWin ? '¡Has ganado! 🏆' : 'Gana ' + v.winners.map(i => esc(v.players[i].name)).join(' y ')) + '</h2>' +
        '<div class="row">' + (lead ? '<button class="btn primary" data-act="again">Otra partida</button>' : '') +
        '<button class="btn" data-act="leave">Salir</button></div>' +
        (lead ? '' : '<p class="muted small" style="text-align:center">El primero de la sala o el mando de la tele pueden empezar otra partida.</p>');
    } else {
      const s = (v.summary || []).find(x => x.pi === v.me);
      html += '<h2>Fin de la ronda ' + v.round + '</h2>' +
        (s ? '<p class="ctl-result">Dijiste <b>' + s.bid + '</b> y ganaste <b>' + s.won + '</b>: ' +
          (s.lost ? '<span class="lost">pierdes ' + s.lost + (s.lost === 1 ? ' vida' : ' vidas') + '</span>' : '<span class="zero">¡clavado!</span>') +
          '<br><span class="lives">' + livesHTML(me.lives) + '</span>' + (me.lives ? '' : ' Eliminado') + '</p>'
          : '<p class="ctl-result">Mira el resumen en la tele 📺</p>') +
        (lead && !isFast() ? '<div class="row"><button class="btn primary" data-act="next">Siguiente ronda</button></div>' : '') +
        '<p class="muted small" style="text-align:center">La siguiente ronda empieza sola en unos segundos.</p>';
    }
    return '<div class="ctl-modal">' + html + '</div>';
  }

  function renderLog(v) {
    $('#log').innerHTML = v.log.slice().reverse().map(l => '<li>' + esc(l) + '</li>').join('');
  }

  function renderModal(v) {
    const isHost = role === 'host' || v.leader;
    const tvGuest = v.tv && role !== 'host';
    const fast = isFast();
    if ((v.phase === 'roundEnd' || v.phase === 'gameOver') && tvGuest) {
      profileOpen = -1;
      modal(ctlModal(v));
    } else if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
      profileOpen = -1;
      let html = '';
      if (v.phase === 'gameOver') {
        const names = v.winners.map(i => esc(v.players[i].name)).join(' y ');
        const iWin = v.winners.indexOf(v.me) >= 0;
        html += (fx.over && (iWin || TV) && !fast ? confetti() : '') +
          '<div class="medals">' + v.winners.map(i => '<span class="medal">' + av(v.players[i].avatar, 'medal-av') + '</span>').join('') + '</div>' +
          '<h2>' + (iWin ? '¡Has ganado!' : 'Gana ' + names) + '</h2>';
      } else {
        html += '<h2>Fin de la ronda ' + v.round + '</h2>';
      }
      if (v.summary) {
        html += '<table class="sum-table"><tr><th>Jugador</th><th>Dijo</th><th>Ganó</th><th>Pierde</th><th>Vidas</th></tr>' +
          v.summary.map(s => '<tr><td><span class="who">' + av(v.players[s.pi].avatar, 'xs') + '<span>' + esc(v.players[s.pi].name) + '</span></span></td><td>' + s.bid + '</td><td>' + s.won +
            '</td><td class="' + (s.lost ? 'lost' : 'zero') + '">' + (s.lost ? '−' + s.lost : '0') + '</td><td>' +
            (s.lives ? s.lives : 'Eliminado') + '</td></tr>').join('') + '</table>';
      }
      const auto = TV || tvGuest ? '<p class="muted small" style="text-align:center">La siguiente ronda empieza sola en unos segundos.</p>' : '';
      if (v.phase === 'roundEnd' && fast) {
        html += '<p class="muted" style="text-align:center">⚡ La siguiente ronda empieza sola…</p>';
      } else if (v.phase === 'roundEnd') {
        html += isHost ? '<div class="row"><button class="btn primary big" data-act="next">Siguiente ronda</button></div>' + auto
          : (auto || '<p class="muted" style="text-align:center">Esperando a que el anfitrión pase de ronda…</p>');
      } else {
        html += '<div class="row">' + (isHost ? '<button class="btn primary' + (TV ? ' big' : '') + '" data-act="again">Otra partida</button>' : '') +
          (TV ? '' : '<button class="btn" data-act="leave">Salir</button>') + '</div>' +
          (isHost ? '' : '<p class="muted small" style="text-align:center">' + (tvGuest ? 'El primero de la sala o el mando de la tele pueden empezar otra partida.' : 'El anfitrión puede empezar otra partida.') + '</p>');
      }
      modal(html);
    } else if (profileOpen >= 0 && v.players[profileOpen]) {
      modal(profileHTML(v, profileOpen));
    } else {
      profileOpen = -1;
      modal(null);
    }
  }

  // ---------- Pantalla de la tele ----------
  function tvSeats(v) {
    return v.players.map((p, i) => {
      const cls = ['tv-seat'];
      if (i === v.turn) cls.push('turn');
      if (!p.alive) cls.push('dead');
      if (fx.lives && fx.lives[i]) cls.push('shake');
      if (fx.trick === i) cls.push('won-trick');
      const badges = (i === v.dealer && p.alive ? '<span class="badge">Reparte</span>' : '') +
        (!p.connected ? '<span class="badge off">Desconectado</span>' : '') +
        (!p.alive ? '<span class="badge dead' + (fx.out && fx.out[i] ? ' stamp' : '') + '">Eliminado</span>' : '');
      const ok = p.bid !== null && p.bid === p.won;
      let backs = '';
      for (let k = 0; k < (p.alive ? p.handCount : 0); k++) backs += '<span class="tv-back"></span>';
      return '<div class="' + cls.join(' ') + '">' + av(p.avatar, 'tv-av') +
        '<div class="tv-name">' + esc(p.name) + '</div><div class="tv-badges">' + badges + '</div>' +
        '<div class="lives" aria-label="' + p.lives + ' vidas">' + livesHTML(p.lives, fx.lives && fx.lives[i]) + '</div>' +
        (p.alive ? '<div class="tv-score">Dice <b class="' + (fx.bids && fx.bids[i] ? 'stamp' : '') + '">' + (p.bid === null ? '–' : p.bid) +
          '</b> · Lleva <b class="' + (ok ? 'ok' : '') + (fx.trick === i ? ' pop' : '') + '">' + p.won + '</b></div>' : '') +
        '<div class="tv-backs" aria-label="' + p.handCount + ' cartas">' + backs + '</div></div>';
    }).join('');
  }

  function renderTV() {
    const v = view;
    showScreen('tv');
    const lobby = v.phase === 'lobby';
    $('#tv-lobby').classList.toggle('hidden', !lobby);
    $('#tv-game').classList.toggle('hidden', lobby);

    if (lobby) {
      const n = v.players.length;
      const link = inviteLink();
      const lead = v.players.findIndex(p => p.connected && !p.bot);
      $('#tv-lobby').innerHTML =
        '<div class="tv-qr">' + (qrSVG(link) || '<p>' + esc(link) + '</p>') + '</div>' +
        '<div class="tv-info">' +
          '<h1>Malas Cartas</h1>' +
          '<p class="tv-lead">Escanea el código con el móvil para unirte</p>' +
          '<p class="muted">o entra en <b>' + esc(location.host + location.pathname) + '</b> y escribe el código</p>' +
          '<p class="big-code">' + esc(code) + '</p>' +
          (n ? '<ul class="tv-players">' + v.players.map((p, i) => '<li>' + av(p.avatar, 'tv-av') + '<span>' + (i === lead ? '👑 ' : '') + esc(p.name) + '</span></li>').join('') + '</ul>'
            : '<p class="tv-empty">Aún no hay nadie. ¡Sé el primero!</p>') +
          '<div class="row"><button class="btn primary big" data-act="start"' + (n < MC.MIN_PLAYERS ? ' disabled' : '') + '>' +
            (n < MC.MIN_PLAYERS ? 'Hacen falta al menos ' + MC.MIN_PLAYERS + ' jugadores' : 'Empezar partida (' + n + ' jugadores)') + '</button>' +
            '<button class="icon-btn mute-btn" data-act="mute"></button></div>' +
          '<p class="muted small">De ' + MC.MIN_PLAYERS + ' a ' + MC.MAX_PLAYERS + ' jugadores. 👑 El primero en unirse también puede empezar desde su móvil.</p>' +
        '</div>';
      renderMute();
      modal(null);
      tvFocus();
      return;
    }

    const turnName = v.turn >= 0 ? esc(v.players[v.turn].name) : '';
    $('#tv-round').textContent = 'Ronda ' + v.round + ' · ' + v.cards + (v.cards === 1 ? ' carta' : ' cartas') +
      (v.phase === 'playing' || v.phase === 'trickEnd' ? ' · Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + ' de ' + v.cards : '');
    $('#tv-code').textContent = 'Sala ' + code;
    $('#tv-seats').innerHTML = tvSeats(v);
    $('#tv-seats').style.setProperty('--n', v.players.length);

    const winner = v.lastTrick ? v.lastTrick.winner : -1;
    const shown = $('#tv-table').querySelectorAll('.play').length;
    const sum = v.players.reduce((s, p) => s + (p.bid || 0), 0);
    $('#tv-table').innerHTML = v.trick.length
      ? v.trick.map((t, i) => '<div class="play' + (i >= shown ? ' new' : '') + (t.pi === winner ? ' win' : '') + '">' + cardHTML(t.card) +
          '<span class="who">' + av(v.players[t.pi].avatar, 'sm') + '<span>' + esc(v.players[t.pi].name) + '</span></span></div>').join('')
      : '<div class="table-empty">' + (v.phase === 'bidding'
          ? (v.blind ? '<b>Ronda de 1 carta</b><br>Cada uno ve en su móvil las cartas de los demás, pero no la suya' : '<b>Apuestas</b>') +
            '<br><span class="tv-sum">Llevan dicho ' + sum + ' de ' + v.cards + '</span>'
          : 'Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + ' de ' + v.cards) + '</div>';

    let status = '';
    if (v.phase === 'bidding') status = turnName + ' está pensando cuántas va a ganar…' +
      (v.forbidden !== null ? ' <span class="tv-forb">(no puede decir ' + v.forbidden + ')</span>' : '');
    else if (v.phase === 'playing') status = 'Turno de ' + turnName;
    else if (v.phase === 'trickEnd') status = esc(v.players[winner].name) + ' gana la mini ronda';
    else if (v.phase === 'roundEnd') status = 'Fin de la ronda';
    $('#tv-status').innerHTML = status;

    renderModal(v);
    tvFocus();
  }

  // Con el mando: el botón principal visible recibe el foco si nada lo tiene.
  function visibleButtons() {
    const scope = $('#modal').classList.contains('hidden') ? document : $('#modal');
    return Array.from(scope.querySelectorAll('button')).filter(b => !b.disabled && b.getClientRects().length);
  }
  function tvFocus() {
    const btns = visibleButtons();
    if (btns.indexOf(document.activeElement) >= 0) return;
    const main = btns.find(b => b.classList.contains('primary'));
    if (main) main.focus({ preventScroll: true });
  }
  function tvKeys(e) {
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!dir) return;
    const btns = visibleButtons();
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    btns[i < 0 ? 0 : (i + dir + btns.length) % btns.length].focus();
  }

  function tvError(msg) {
    showScreen('tv');
    $('#tv-game').classList.add('hidden');
    $('#tv-lobby').classList.remove('hidden');
    $('#tv-lobby').innerHTML = '<div class="tv-info"><h1>Malas Cartas</h1><p class="tv-lead">' + esc(msg) + '</p>' +
      '<div class="row"><button class="btn primary big" data-act="tv-retry">Reintentar</button></div></div>';
    tvFocus();
  }

  function tvLoading() {
    tvError('Creando sala…');
    $('#tv-lobby .row').remove();
  }

  // ---------- Anfitrión ----------
  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function createRoom() {
    role = 'host';
    code = genCode();
    toast('Creando sala…');
    peer = new Peer(PREFIX + code);
    peer.on('open', () => {
      game = MC.createGame();
      if (!TV) MC.addPlayer(game, myCid, myName, myAvatar);
      sync();
      toast(TV ? 'Sala lista. Escanead el código para uniros' : 'Sala creada. Comparte el código ' + code);
      hostHeartbeat();
    });
    peer.on('connection', conn => {
      conn.lastSeen = Date.now();
      conn.on('data', msg => { conn.lastSeen = Date.now(); handle(conn, msg); });
      conn.on('close', () => onGuestClose(conn));
      conn.on('error', () => onGuestClose(conn));
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && !game) { peer.destroy(); createRoom(); return; }
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') toast('Problema de conexión con el servidor. Reintentando…');
      else if (!game) {
        if (TV) { try { peer.destroy(); } catch (x) { /* nada */ } tvError('No se ha podido crear la sala (' + e.type + '). Revisa la conexión a internet.'); }
        else { toast('No se pudo crear la sala: ' + e.type); resetToHome(); }
      }
    });
  }

  function idxOf(cid) { return game.players.findIndex(p => p.cid === cid); }
  // En modo TV manda (empezar, siguiente ronda, otra partida) el primer jugador conectado.
  function leaderIdx() { return TV && game ? game.players.findIndex(p => p.connected && !p.bot) : -1; }

  function sendTo(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* conexión caída */ } }

  function handle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const cid = conn ? conn.cid : myCid;
    const fromHost = !conn;
    const reply = text => { if (conn) sendTo(conn, { t: 'error', msg: text }); else toast(text); };

    if (msg.t === 'join' && conn) {
      const name = String(msg.name || 'Jugador').slice(0, 16).trim() || 'Jugador';
      const id = String(msg.cid || '');
      conn.cid = id;
      const existing = idxOf(id);
      if (existing >= 0) {
        const old = conns.get(id);
        if (old && old !== conn) { old.replaced = true; try { old.close(); } catch (e) { /* nada */ } }
        conns.set(id, conn);
        game.players[existing].connected = true;
        if (MCAV.isValidAvatar(msg.avatar)) game.players[existing].avatar = msg.avatar;
        game.log.push(game.players[existing].name + ' se ha reconectado');
      } else {
        try { MC.addPlayer(game, id, name, msg.avatar); conns.set(id, conn); }
        catch (e) { sendTo(conn, { t: 'error', msg: e.message, fatal: true }); setTimeout(() => conn.close(), 500); return; }
      }
      sync();
      return;
    }

    const pi = idxOf(cid);
    if (pi < 0 && !fromHost) return;
    const lead = fromHost || (pi >= 0 && pi === leaderIdx());
    // Emoticonos: no cambian la partida; el anfitrión los valida y los reparte a todos.
    if (msg.t === 'emote') {
      if (pi < 0 || EMOTES.indexOf(msg.e) < 0 || game.phase === 'lobby') return;
      const now = Date.now();
      if (now - (emoteSeen.get(cid) || 0) < EMOTE_GAP) return;
      emoteSeen.set(cid, now);
      for (const c of conns.values()) sendTo(c, { t: 'emote', pi, e: msg.e });
      showEmote(pi, msg.e);
      return;
    }

    if (pi < 0 && ['start', 'next', 'again'].indexOf(msg.t) < 0) return; // la tele no juega

    try {
      switch (msg.t) {
        case 'bid': MC.placeBid(game, pi, Number(msg.n)); break;
        case 'avatar': MC.setAvatar(game, pi, msg.avatar); break;
        case 'play': {
          let id = msg.card;
          if (typeof id === 'string' && id[0] === '#') {
            const c = game.players[pi].hand[Number(id.slice(1))];
            id = c && c.id;
          }
          MC.playCard(game, pi, id);
          break;
        }
        case 'start': if (lead && game.phase === 'lobby') MC.startGame(game); break;
        case 'next': if (lead && game.phase === 'roundEnd') MC.advance(game); break;
        case 'again': if (lead && game.phase === 'gameOver') MC.backToLobby(game); break;
        case 'settings': if (fromHost) MC.setSettings(game, { fast: !!msg.fast }); break;
        case 'addBot': if (fromHost && DEV) MC.addBot(game); break;
        case 'removeBot': {
          const bi = Number(msg.i);
          if (fromHost && DEV && game.players[bi] && game.players[bi].bot) MC.removePlayer(game, bi);
          break;
        }
        default: return;
      }
    } catch (e) {
      if (e.game) { reply(e.message); return; }
      throw e;
    }
    sync();
  }

  function onGuestClose(conn) {
    if (conn.replaced || !game || !conn.cid) return;
    if (conns.get(conn.cid) !== conn) return;
    conns.delete(conn.cid);
    const i = idxOf(conn.cid);
    if (i < 0) return;
    if (game.phase === 'lobby') MC.removePlayer(game, i);
    else { game.players[i].connected = false; game.log.push(game.players[i].name + ' se ha desconectado'); }
    sync();
  }

  function sync() {
    const lead = leaderIdx();
    game.players.forEach((p, i) => {
      if (p.cid === myCid || p.bot) return;
      const v = MC.viewFor(game, i);
      if (TV) { v.tv = true; v.leader = i === lead; }
      sendTo(conns.get(p.cid), { t: 'state', view: v, code });
    });
    if (TV) applyView(MC.tableView(game));
    else {
      const mi = idxOf(myCid);
      if (mi >= 0) applyView(MC.viewFor(game, mi));
    }
    schedule();
  }

  // Si el estado no ha cambiado, se respeta el temporizador pendiente: así un mensaje cualquiera
  // (o alguien pulsando botones sin parar) no retrasa indefinidamente la siguiente mini ronda.
  let timerKey = null;
  function schedule() {
    const tp = game.players[game.turn];
    const key = [game.phase, game.round, game.trickNum, game.turn, tp ? tp.connected : ''].join(':');
    if (key === timerKey) return;
    later.clear(timer);
    timerKey = key;
    const f = game.settings && game.settings.fast ? 1 : 0;
    const step = fn => () => {
      timerKey = null;
      if (!game) return;
      try { fn(); } catch (e) { if (!e.game) throw e; }
      sync();
    };
    if (game.phase === 'trickEnd') {
      timer = later.set(step(() => MC.advance(game)), TRICK_PAUSE[f]);
    } else if (game.phase === 'roundEnd' && f) {
      timer = later.set(step(() => { if (game.phase === 'roundEnd') MC.advance(game); }), ROUND_AUTO);
    } else if ((game.phase === 'bidding' || game.phase === 'playing') && game.turn >= 0 && tp.bot) {
      timer = later.set(step(() => MC.botAction(game, game.turn)), BOT_THINK[f]);
    } else if ((game.phase === 'bidding' || game.phase === 'playing') && game.turn >= 0 && !tp.connected) {
      timer = later.set(step(() => MC.autoAction(game, game.turn)), BOT_DELAY[f]);
    } else if (TV && game.phase === 'roundEnd') {
      timer = later.set(step(() => { if (game.phase === 'roundEnd') MC.advance(game); }), TV_ROUND_PAUSE);
    }
  }

  // ---------- Invitado ----------
  function joinRoom(c) {
    role = 'guest';
    code = c;
    leaving = false;
    toast('Conectando con la sala ' + code + '…', 8000);
    peer = new Peer();
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') {
        toast(view ? 'El anfitrión no responde. ¿Ha cerrado la sala?' : 'No existe ninguna sala con el código ' + code, 5000);
        if (!view) resetToHome(); else showLost();
      } else if (!view) {
        toast('No se pudo conectar: ' + e.type, 5000);
        resetToHome();
      }
    });
  }

  // Latido: el anfitrión manda "ping" cada 3 s; si alguien calla 10 s se da por desconectado.
  function hostHeartbeat() {
    if (role !== 'host' || !game) return;
    const now = Date.now();
    for (const conn of Array.from(conns.values())) {
      sendTo(conn, { t: 'ping' });
      if (now - conn.lastSeen > 10000) {
        try { conn.close(); } catch (e) { /* nada */ }
        onGuestClose(conn);
      }
    }
    later.set(hostHeartbeat, 3000);
  }

  let hostSeen = 0;
  let watchToken = 0;
  function guestWatch(token) {
    if (token !== watchToken || leaving || role !== 'guest') return;
    if (Date.now() - hostSeen > 15000) {
      try { hostConn && hostConn.close(); } catch (e) { /* nada */ }
      showLost();
      return;
    }
    later.set(() => guestWatch(token), 3000);
  }

  function connectToHost() {
    hostConn = peer.connect(PREFIX + code, { reliable: true });
    hostConn.on('open', () => {
      hostConn.send({ t: 'join', cid: myCid, name: myName, avatar: myAvatar });
      $('#toast').classList.add('hidden');
      history.replaceState(null, '', location.pathname + '?' + DEV_Q + 'sala=' + code);
      modal(null);
      hostSeen = Date.now();
      guestWatch(++watchToken);
    });
    hostConn.on('data', msg => {
      hostSeen = Date.now();
      if (msg.t === 'ping') { hostConn.send({ t: 'pong' }); return; }
      if (msg.t === 'state') applyView(msg.view);
      else if (msg.t === 'emote') showEmote(Number(msg.pi), msg.e);
      else if (msg.t === 'error') {
        toast(msg.msg, 4000);
        if (msg.fatal) { leaving = true; resetToHome(); }
      }
    });
    hostConn.on('close', () => { if (!leaving) showLost(); });
  }

  function showLost() {
    modal('<h2>Conexión perdida</h2><p style="text-align:center">Se ha perdido la conexión con el anfitrión.</p>' +
      '<div class="row"><button class="btn primary" data-act="reconnect">Reconectar</button>' +
      '<button class="btn" data-act="leave">Salir</button></div>');
  }

  // ---------- Acciones comunes ----------
  function send(msg) {
    if (role === 'host') handle(null, msg);
    else if (hostConn && hostConn.open) hostConn.send(msg);
    else showLost();
  }

  function resetToHome() {
    leaving = true;
    later.clear(timer);
    timerKey = null;
    try { if (peer) peer.destroy(); } catch (e) { /* nada */ }
    peer = null; hostConn = null; game = null; view = null; role = null; conns.clear();
    modal(null);
    document.body.classList.remove('ctl');
    $('#ctl').classList.add('hidden');
    $('#log-box').classList.remove('hidden');
    history.replaceState(null, '', location.pathname + (DEV ? '?dev' : ''));
    profileOpen = -1;
    toggleEmoteBar(false);
    document.body.classList.remove('fast');
    showScreen('home');
  }

  function readName() {
    const n = $('#name').value.trim().slice(0, 16);
    if (!n) { toast('Escribe tu nombre'); $('#name').focus(); return null; }
    store('mc-name', n);
    return n;
  }

  function copyLink() {
    const link = inviteLink();
    const done = () => toast('Enlace copiado: ' + link);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copia este enlace:', link));
    else prompt('Copia este enlace:', link);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.av !== undefined) setMyAvatar(b.dataset.av === 'photo' ? store('mc-photo') : b.dataset.av);
    else if (b.dataset.bid !== undefined) send({ t: 'bid', n: Number(b.dataset.bid) });
    else if (b.dataset.play !== undefined) send({ t: 'play', card: b.dataset.play });
    else if (b.dataset.profile !== undefined) { profileOpen = Number(b.dataset.profile); if (view) renderModal(view); }
    else if (b.dataset.emote !== undefined) { send({ t: 'emote', e: b.dataset.emote }); toggleEmoteBar(false); }
    else if (b.dataset.rmbot !== undefined) send({ t: 'removeBot', i: Number(b.dataset.rmbot) });
    else if (b.dataset.act) {
      const a = b.dataset.act;
      if (a === 'copy') copyLink();
      else if (a === 'photo') choosePhoto();
      else if (a === 'toggle-av') { avatarOpen = !avatarOpen; render(); }
      else if (a === 'mute') { MCSND.toggleMute(); renderMute(); }
      else if (a === 'emote-menu') toggleEmoteBar();
      else if (a === 'close-profile') { profileOpen = -1; if (view) renderModal(view); else modal(null); }
      else if (a === 'leave') resetToHome();
      else if (a === 'tv-retry') { tvLoading(); createRoom(); }
      else if (a === 'fullscreen') setFullscreen(!isFs());
      else if (a === 'landscape') setFullscreen(true, true);
      else if (a === 'portrait-ok') document.body.classList.add('portrait-ok');
      else if (a === 'reconnect') {
        modal(null);
        if (peer && !peer.destroyed && !peer.disconnected) connectToHost();
        else { const c = code; try { peer && peer.destroy(); } catch (x) { /* nada */ } joinRoom(c); }
      } else send({ t: a });
    }
  });

  $('#btn-code').addEventListener('click', copyLink);
  if (TV) document.addEventListener('keydown', tvKeys);

  // Opciones de la partida (casillas de la sala de espera).
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.set === 'fast') send({ t: 'settings', fast: el.checked });
  });

  // Clic fuera del perfil lo cierra; clic fuera de la barra de emoticonos la cierra.
  $('#modal').addEventListener('click', e => {
    if (e.target === $('#modal') && profileOpen >= 0) { profileOpen = -1; if (view) renderModal(view); }
  });
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#emote-bar, #btn-emote')) toggleEmoteBar(false);
  });

  $('#btn-create').addEventListener('click', () => {
    const n = readName(); if (!n) return;
    myName = n;
    createRoom();
  });

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = readName(); if (!n) return;
    const c = $('#code').value.trim().toUpperCase();
    if (c.length !== 5) { toast('El código tiene 5 letras'); $('#code').focus(); return; }
    myName = n;
    joinRoom(c);
  });

  $('#code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  window.addEventListener('beforeunload', e => {
    if (!TV && role === 'host' && game && game.players.length > 1) { e.preventDefault(); e.returnValue = ''; }
  });

  // Los navegadores solo dejan sonar audio tras un gesto del usuario.
  document.addEventListener('pointerdown', MCSND.unlock, true);
  document.addEventListener('keydown', MCSND.unlock, true);

  // Arranque
  $('#name').value = store('mc-name') || '';
  renderHomeAvatar();
  renderMute();
  renderFs();
  renderEmoteBar();
  if (TV) {
    document.documentElement.classList.add('tv');
    document.title = 'Malas Cartas · TV';
    if (typeof Peer === 'undefined') tvError('No se ha podido cargar la conexión. Revisa que la tele tenga internet.');
    else { tvLoading(); createRoom(); }
    return;
  }
  const sala = (URLP.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (sala) {
    $('#code').value = sala;
    toast('Te han invitado a la sala ' + sala + '. Escribe tu nombre y pulsa Unirse.', 5000);
    history.replaceState(null, '', location.pathname + (DEV ? '?dev' : ''));
  }
  ($('#name').value ? (sala ? $('#join-form button') : $('#btn-create')) : $('#name')).focus();
  if (typeof Peer === 'undefined') toast('No se pudo cargar la librería de conexión. Revisa tu internet y recarga.', 8000);
})();
