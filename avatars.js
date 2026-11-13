// Avatares de jugador: personajes SVG dibujados por piezas, o una foto propia.
// Adaptado de secrethitlet. Sin DOM: el anfitrión lo usa para validar el avatar elegido.
(function (root) {
  'use strict';
const INK = '#2a2219';
const PAPER = '#ece0c2';
const BG = ['#7d8a5e', '#8a6f9e', '#5f8585', '#a8875a', '#5f6f7f', '#9a7466', '#6d7d55', '#7a6a8a'];
const SKIN = ['#f1cba8', '#ddab82', '#b98159', '#8f5d3d', '#62402a'];

// Piezas (viewBox 64x64). c = colores del personaje.
const P = {
  body: (c) => `<path d="M9 64c0-13 10-20 23-20s23 7 23 20z" fill="${c.coat}"/><path d="M26 44l6 8 6-8z" fill="${PAPER}"/>`,
  head: (c) => `<rect x="27.5" y="36" width="9" height="9" fill="${c.skin}"/><ellipse cx="32" cy="28" rx="11" ry="12.5" fill="${c.skin}"/>`,
  face: () => `<circle cx="28" cy="28.5" r="1.4" fill="${INK}"/><circle cx="36" cy="28.5" r="1.4" fill="${INK}"/><path d="M29.5 34.5q2.5 1.4 5 0" stroke="${INK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  short: (c) => `<path d="M21 27c0-9 5-14.5 11-14.5S43 18 43 27c-2-5-6-7.5-11-7.5S23 22 21 27z" fill="${c.hair}"/>`,
  bob: (c) => `<path d="M19.5 33c0-14 6-20.5 12.5-20.5S44.5 19 44.5 33v5h-4.5V24c-3.5-.5-6.5-2.5-8-5-1.5 2.5-4.5 4.5-8 5v14h-4.5z" fill="${c.hair}"/>`,
  bun: (c) => `${P.short(c)}<circle cx="32" cy="12" r="5" fill="${c.hair}"/>`,
  bowler: (c) => `<path d="M22 21.5c0-8 4.5-12 10-12s10 4 10 12z" fill="${c.hat}"/><path d="M17 21.5h30" stroke="${c.hat}" stroke-width="3" stroke-linecap="round"/>`,
  fedora: (c) => `<path d="M15 21c5 2.5 29 2.5 34 0l-2.5 3.5h-29z" fill="${c.hat}"/><path d="M22 21.5c0-6.5 3-11.5 10-11.5s10 5 10 11.5c-4 1-16 1-20 0z" fill="${c.hat}"/><path d="M22.3 18.5h19.4v2.4H22.3z" fill="${c.band}"/>`,
  tophat: (c) => `<path d="M23 3.5h18v17H23z" fill="${c.hat}"/><path d="M17 20h30v3.2H17z" fill="${c.hat}"/><path d="M23 16.5h18v2.6H23z" fill="${c.band}"/>`,
  beret: (c) => `<ellipse cx="30" cy="17" rx="13.5" ry="5.2" fill="${c.hat}"/><circle cx="30" cy="11.3" r="1.6" fill="${c.hat}"/>`,
  newsboy: (c) => `<path d="M20 21c0-7.5 5-11 12-11s12 3.5 12 11z" fill="${c.hat}"/><path d="M29 20.5h19c-2 3.2-8 4.2-19 3z" fill="${c.band}"/>`,
  cloche: (c) => `<path d="M19 28c0-11.5 6-17 13-17s13 5.5 13 17c-4-2.2-9-3.2-13-3.2S23 25.8 19 28z" fill="${c.hat}"/><path d="M20.5 22.5c6-2 17-2 23 0" stroke="${c.band}" stroke-width="2.2" fill="none"/>`,
  mustache: (c) => `<path d="M26.5 33.8c2-2.4 4.2-2.4 5.5-1.1 1.3-1.3 3.5-1.3 5.5 1.1-2 1-4.2 1-5.5 0-1.3 1-3.5 1-5.5 0z" fill="${c.hair}"/>`,
  beard: (c) => `<path d="M21 29c0 10 5 15.5 11 15.5S43 39 43 29c-2 4.5-6 6.5-11 6.5S23 33.5 21 29z" fill="${c.hair}"/>`,
  glasses: () => `<g fill="none" stroke="${INK}" stroke-width="1.4"><circle cx="28" cy="28.5" r="3.7"/><circle cx="36" cy="28.5" r="3.7"/><path d="M31.7 28.5h.6"/></g>`,
  monocle: () => `<circle cx="36" cy="28.5" r="3.8" fill="none" stroke="#c99b3f" stroke-width="1.4"/><path d="M39.6 30c2 4 2 9-1 13" fill="none" stroke="#c99b3f" stroke-width=".9"/>`,
  pipe: () => `<path d="M35 35.5h6.5v3.5" stroke="#4a2f1a" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="39.5" y="37" width="5" height="6" rx="1.2" fill="#4a2f1a"/>`,
  bowtie: (c) => `<path d="M25.5 44.5l6.5 3.3-6.5 3.3zM38.5 44.5 32 47.8l6.5 3.3z" fill="${c.accent}"/>`,
  tie: (c) => `<path d="M31 44.5h2l1.6 3-2.6 13-2.6-13z" fill="${c.accent}"/>`,
  pearls: () => `<g fill="${PAPER}">${[24.5, 27.5, 30.5, 33.5, 36.5, 39.5].map((x, i) => `<circle cx="${x}" cy="${44 + (i === 0 || i === 5 ? -1 : i === 1 || i === 4 ? 0 : .6)}" r="1.3"/>`).join('')}</g>`,
  scarf: (c) => `<path d="M23.5 41.5c4 3.4 13 3.4 17 0l1.2 4.2c-5.5 3.4-13.9 3.4-19.4 0z" fill="${c.accent}"/><path d="M36 45l3 9 3-1-2-9z" fill="${c.accent}"/>`,
  lips: () => `<path d="M29.6 34.4q2.4 1.6 4.8 0" stroke="#a63a2b" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  earring: () => `<circle cx="21.3" cy="33" r="1.4" fill="#c99b3f"/>`,
};

function draw(c, parts) {
  // El orden importa: pelo largo detrás de la cara; sombreros y accesorios encima.
  const back = parts.filter((p) => p === 'bob').map((p) => P[p](c)).join('');
  const front = parts.filter((p) => p !== 'bob').map((p) => P[p](c)).join('');
  return `<rect width="64" height="64" fill="${c.bg}"/>${back}${P.body(c)}${P.head(c)}${P.face()}${front}`;
}

const DEFS = [
  ['periodista', 'Periodista', { bg: 0, skin: 0, hair: '#5a3a22', coat: '#4a4f45', hat: '#6b5b45', band: '#54473a', accent: '#8c2f22' }, ['short', 'newsboy', 'tie']],
  ['banquera', 'Banquera', { bg: 1, skin: 1, hair: '#2c1d14', coat: '#3b3346', hat: '#2f2a38', band: '#c99b3f', accent: '#c99b3f' }, ['bob', 'cloche', 'pearls', 'lips']],
  ['profesor', 'Profesor', { bg: 2, skin: 2, hair: '#d9d2c4', coat: '#5a4a3a', accent: '#2d4e6a' }, ['short', 'beard', 'glasses', 'bowtie']],
  ['aristocrata', 'Aristócrata', { bg: 3, skin: 0, hair: '#3a2a1e', coat: '#22201d', hat: '#1b1916', band: '#7a2a20', accent: '#22201d' }, ['short', 'mustache', 'monocle', 'tophat', 'bowtie']],
  ['detective', 'Detective', { bg: 4, skin: 3, hair: '#1f1712', coat: '#6e6250', hat: '#4a4036', band: '#2a241f', accent: '#5a2a22' }, ['short', 'mustache', 'fedora', 'tie']],
  ['pintora', 'Pintora', { bg: 5, skin: 1, hair: '#8a3b1f', coat: '#3f5a4a', hat: '#2a2a2a', accent: '#c99b3f' }, ['bob', 'beret', 'scarf', 'earring']],
  ['obrera', 'Obrera', { bg: 6, skin: 4, hair: '#1a1410', coat: '#3c5266', accent: '#a65a2b' }, ['bun', 'scarf']],
  ['diplomatico', 'Diplomático', { bg: 7, skin: 2, hair: '#2a1d14', coat: '#2b2d33', hat: '#1e1e22', band: '#1e1e22', accent: '#6a4a8a' }, ['short', 'mustache', 'bowler', 'tie']],
  ['poeta', 'Poeta', { bg: 0, skin: 1, hair: '#2b1e16', coat: '#5b4636', accent: '#7a2a3a' }, ['short', 'pipe', 'scarf']],
  ['cantante', 'Cantante', { bg: 1, skin: 3, hair: '#120d0a', coat: '#5a2a3a', accent: '#c99b3f' }, ['bob', 'pearls', 'lips', 'earring']],
  ['abogada', 'Abogada', { bg: 2, skin: 0, hair: '#6b4a2e', coat: '#2f3438', accent: '#7a6a3a' }, ['bun', 'glasses', 'tie']],
  ['sindicalista', 'Sindicalista', { bg: 3, skin: 2, hair: '#3a2a1e', coat: '#4a3a2e', hat: '#3a3a34', band: '#2a2a26', accent: '#8c2f22' }, ['short', 'beard', 'newsboy']],
  ['cientifica', 'Científica', { bg: 4, skin: 4, hair: '#1a1410', coat: '#e2dccb', accent: '#2d4e6a' }, ['bob', 'glasses']],
  ['capitan', 'Capitán de barco', { bg: 5, skin: 1, hair: '#e6e0d2', coat: '#26324a', hat: '#26324a', band: '#c99b3f', accent: '#c99b3f' }, ['short', 'beard', 'fedora']],
  ['actriz', 'Actriz', { bg: 6, skin: 2, hair: '#d8b25a', coat: '#3a2a3a', hat: '#6a2a3a', band: '#d8b25a', accent: '#8a6f9e' }, ['bob', 'cloche', 'scarf', 'lips']],
  ['medico', 'Médico', { bg: 7, skin: 3, hair: '#6a6a66', coat: '#d9d3c4', accent: '#4a6a5a' }, ['short', 'glasses', 'mustache', 'tie']],
];

const AVATAR_IDS = DEFS.map((d) => d[0]);
const AVATAR_NAMES = Object.fromEntries(DEFS.map((d) => [d[0], d[1]]));
const AVATAR_ART = Object.fromEntries(DEFS.map(([id, , c, parts]) =>
  [id, draw({ ...c, bg: BG[c.bg], skin: SKIN[c.skin] }, parts)]));

const isAvatar = (id) => typeof id === 'string' && Object.hasOwn(AVATAR_ART, id);

// Avatar estable a partir de un texto (id de jugador) para quien no haya elegido.
function defaultAvatar(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_IDS[h % AVATAR_IDS.length];
}

// Foto subida por el jugador: data URL ya comprimida en su navegador (unos 128x128 px).
// La regex estricta (solo base64) impide colar comillas o HTML en el atributo src.
const PHOTO_MAX = 24000;
const PHOTO_RE = /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const isPhoto = (s) => typeof s === 'string' && s.length <= PHOTO_MAX && PHOTO_RE.test(s);
// Un avatar es un personaje de la lista o una foto propia.
const isValidAvatar = (a) => isAvatar(a) || isPhoto(a);

function avatarSvg(id, cls = '') {
  if (isPhoto(id)) return `<img class="avatar photo ${cls}" src="${id}" alt="Foto de perfil">`;
  const key = isAvatar(id) ? id : defaultAvatar(id);
  return `<svg class="avatar ${cls}" viewBox="0 0 64 64" role="img" aria-label="${AVATAR_NAMES[key]}">${AVATAR_ART[key]}</svg>`;
}

  const api = { AVATAR_IDS, AVATAR_NAMES, PHOTO_MAX, isAvatar, isPhoto, isValidAvatar, defaultAvatar, avatarSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MCAV = api;
})(typeof window !== 'undefined' ? window : globalThis);
