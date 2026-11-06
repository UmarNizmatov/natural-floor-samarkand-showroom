// Wall designs drawn as vectors in metres, filled with the real Natural Floor stone samples.
// Every shape is large enough to be laid by hand on a vertical wall.
import { WORD } from './word.js';

const STONE_NAMES = ['Grafit', 'Arktika', 'Kanyon', 'Safari', 'Rubin', 'Saxro', 'Zumrad', 'Koksaroy', 'Novvot', 'Terra', 'Marvarid', 'BlackCoffee',
  'Bodom', 'Soxil', 'Riverstone', 'Mozayka', 'Nurtosh', 'Bahor', 'Chashma', 'Galaktika', 'Zarafshon', 'Xazon', 'Anor', 'Terrachcho', 'Panda', 'Zamin', 'Safed'];
const images = {};
export const loadStones = () => Promise.all(STONE_NAMES.map((name) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => { images[name] = image; resolve(); };
  image.onerror = reject;
  image.src = `assets/stone/${name}.jpg`;
})));

const STONE_TILE_METRES = 0.3;
function brush(ctx) {
  const cache = {};
  return (name) => {
    if (!cache[name]) {
      const pattern = ctx.createPattern(images[name], 'repeat');
      pattern.setTransform(new DOMMatrix().scale(STONE_TILE_METRES / 512));
      cache[name] = pattern;
    }
    return cache[name];
  };
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Small drawing kit: every filled shape gets a thin separator strip like a real stone-carpet joint.
function kit(ctx) {
  const stone = brush(ctx);
  const fill = (name, build) => {
    ctx.beginPath();
    build();
    ctx.fillStyle = stone(name);
    ctx.fill('evenodd');
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = 'rgba(25,22,20,.55)';
    ctx.stroke();
  };
  const rect = (name, x, y, w, h) => fill(name, () => ctx.rect(x, y, w, h));
  const circle = (name, x, y, r) => fill(name, () => ctx.arc(x, y, r, 0, Math.PI * 2));
  const poly = (name, points) => fill(name, () => points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))) || ctx.closePath());
  // Rounded silhouette through the midpoints of a control polygon.
  const smooth = (name, points, x = 0, y = 0, scale = 1, flip = 1) => fill(name, () => {
    const at = (i) => { const p = points[(i + points.length) % points.length]; return [x + p[0] * scale * flip, y + p[1] * scale]; };
    const start = at(0), prev = at(-1);
    ctx.moveTo((start[0] + prev[0]) / 2, (start[1] + prev[1]) / 2);
    for (let i = 0; i < points.length; i++) {
      const p = at(i), n = at(i + 1);
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
    }
    ctx.closePath();
  });
  return { ctx, stone, fill, rect, circle, poly, smooth };
}

const CAMEL = [[.08, .46], [.12, .52], [.2, .55], [.26, .69], [.32, .57], [.4, .55], [.47, .69], [.53, .56], [.62, .52], [.7, .5], [.76, .62], [.79, .76], [.85, .8], [.93, .78], [.99, .73], [.98, .69], [.88, .69], [.84, .62], [.82, .48], [.76, .37], [.69, .31], [.68, .16], [.7, 0], [.64, 0], [.62, .16], [.6, .29], [.4, .27], [.26, .29], [.25, .16], [.27, 0], [.21, 0], [.18, .16], [.13, .3], [.07, .38], [.04, .28], [.06, .4]];

const star = (x, y, r, inner = 0.42, tips = 8, rotation = Math.PI / 8) => Array.from({ length: tips * 2 }, (_, i) => {
  const radius = i % 2 ? r * inner : r, a = rotation + i * Math.PI / tips;
  return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
});

// 1. The wall as a cut through the hill: it shows what it holds back.
function strata(k, { L, H, seed }) {
  const random = mulberry(seed);
  const layers = ['BlackCoffee', 'Soxil', 'Bodom', 'Kanyon', 'Terra', 'Saxro', 'Novvot'];
  const phases = layers.map(() => [random() * 9, random() * 9, 0.08 + random() * 0.08]);
  const top = (i, x) => (H * (i + 1)) / layers.length + Math.sin(x * phases[i][2] + phases[i][0]) * H * 0.05 + Math.sin(x * phases[i][2] * 2.7 + phases[i][1]) * H * 0.024 + (i === layers.length - 1 ? H : 0);
  for (let i = layers.length - 1; i >= 0; i--) {
    const points = [[-1, -1], [L + 1, -1]];
    for (let x = L + 1; x >= -1; x -= 0.5) points.push([x, top(i, x)]);
    k.poly(layers[i], points);
  }
  const jug = (x, y, s, name) => k.smooth(name, [[-.2, 0], [.2, 0], [.34, .3], [.42, .6], [.3, .85], [.13, .96], [.13, 1.16], [.24, 1.26], [-.24, 1.26], [-.13, 1.16], [-.13, .96], [-.3, .85], [-.42, .6], [-.34, .3]], x, y, s);
  const arrow = (x, y, s, name) => k.poly(name, [[x, y + s], [x + s * .3, y], [x + s * .1, y + s * .12], [x - s * .1, y + s * .12], [x - s * .3, y]]);
  for (let x = 2 + random() * 2; x < L - 1.5; x += 3.2 + random() * 3.2) {
    const level = random(), y = H * (0.08 + level * 0.62), size = (0.28 + random() * 0.26) * Math.min(H, 3.6);
    const kind = Math.floor(random() * 5);
    if (kind === 0) jug(x, y, size, 'Zumrad');
    if (kind === 1) { k.circle('Safari', x, y + size * .4, size * .42); k.circle('Bodom', x, y + size * .4, size * .12); }
    if (kind === 2) k.poly('Arktika', star(x, y + size * .45, size * .55));
    if (kind === 3) arrow(x, y, size, 'Grafit');
    if (kind === 4) k.smooth('Rubin', CAMEL, x - size, y, size * 1.9);
  }
}

// 2. A real voice recording of the word "Самарканд" as one long sound wave.
function word(k, { L, H }) {
  k.rect('Arktika', -1, -1, L + 2, H + 2);
  const bar = 0.5, gap = 0.2, centre = H * 0.47, step = bar + gap;
  const voiced = WORD.filter((v) => v > .06);
  const count = Math.floor(L / step);
  for (let i = 0; i < count; i++) {
    const at = Math.floor(i * 1.6) % voiced.length;
    const half = Math.max(0.12, Math.sqrt(voiced[at]) * H * 0.44);
    const syllable = Math.floor(at / (voiced.length / 3));
    k.rect(['Rubin', 'BlackCoffee', 'Zumrad'][syllable], i * step + gap, centre - half, bar, half * 2);
  }
}

// 3. The sky of Ulugh Beg's star catalogue, real coordinates, 24 hours along the wall.
const STARS = [[5.92, 7.4, .5], [5.24, -8.2, .1], [5.42, 6.35, 1.6], [5.6, -1.2, 1.7], [5.68, -1.9, 1.8], [5.53, -.3, 2.2], [5.8, -9.7, 2], [6.75, -16.7, -1.4], [7.65, 5.2, .4], [7.75, 28, 1.1], [7.58, 31.9, 1.6], [4.6, 16.5, .9], [5.28, 46, .1], [3.4, 49.9, 1.8], [2.07, 42.3, 2.1], [1.16, 35.6, 2.1], [.14, 29.1, 2.1], [11.06, 61.8, 1.8], [11.03, 56.4, 2.4], [11.9, 53.7, 2.4], [12.26, 57, 3.3], [12.9, 56, 1.8], [13.4, 54.9, 2.2], [13.8, 49.3, 1.9], [14.26, 19.2, -.1], [13.42, -11.2, 1], [10.14, 12, 1.4], [10.33, 19.8, 2], [11.82, 14.6, 2.1], [11.24, 20.5, 2.6], [18.62, 38.8, 0], [20.69, 45.3, 1.3], [19.51, 28, 3.1], [20.37, 40.3, 2.2], [19.75, 45.1, 2.9], [20.77, 33.97, 2.5], [19.85, 8.9, .8], [16.49, -26.4, 1], [.68, 56.5, 2.2], [.15, 59.1, 2.3], [.95, 60.7, 2.5], [1.43, 60.2, 2.7], [1.91, 63.7, 3.4], [2.53, 89.3, 2], [22.96, -29.6, 1.2]];
const LINES = [[0, 2], [2, 5], [0, 3], [1, 5], [3, 4], [4, 6], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [17, 20], [31, 33], [33, 32], [33, 34], [33, 35], [38, 39], [38, 40], [40, 41], [41, 42], [26, 27], [27, 29], [29, 28], [26, 28], [13, 14], [14, 15], [15, 16]];
function sky(k, { L, H }) {
  k.rect('BlackCoffee', -1, -1, L + 2, H + 2);
  const X = (ra) => (((ra + 12) % 24) / 24) * L, Y = (dec) => ((dec + 35) / 130) * H;
  k.fill('Koksaroy', () => {
    k.ctx.moveTo(-1, H * .15);
    for (let x = 0; x <= L + 1; x += 1) k.ctx.lineTo(x, H * (.45 + Math.sin(x / L * Math.PI * 2 + 1) * .3));
    for (let x = L + 1; x >= -1; x -= 1) k.ctx.lineTo(x, H * (.68 + Math.sin(x / L * Math.PI * 2 + 1) * .3));
    k.ctx.closePath();
  });
  LINES.forEach(([a, b]) => {
    const A = STARS[a], B = STARS[b];
    if (Math.abs(A[0] - B[0]) > 10) return;
    const ax = X(A[0]), ay = Y(A[1]), bx = X(B[0]), by = Y(B[1]), len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len * .06, ny = (bx - ax) / len * .06;
    k.poly('Grafit', [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  });
  STARS.forEach(([ra, dec, mag]) => {
    const r = Math.max(.16, (3.8 - mag) * Math.min(H, 3.4) * .062);
    if (mag < 1) k.poly(mag < .3 ? 'Safari' : 'Novvot', star(X(ra), Y(dec), r * 1.5));
    else k.circle('Arktika', X(ra), Y(dec), r);
  });
}

// 4. Adras cloth scaled up a thousand times: its blurred edge becomes a stepped stone edge.
function adras(k, { L, H, seed }) {
  const random = mulberry(seed);
  k.rect('Arktika', -1, -1, L + 2, H + 2);
  const colors = ['Rubin', 'BlackCoffee', 'Zumrad', 'Safari'];
  const row = 0.28;
  let x = -1, c = 0;
  while (x < L + 1) {
    const width = 2.1 + random() * 3.2, name = colors[c++ % colors.length], points = [], back = [];
    const belly = random() * 6;
    for (let y = -row; y < H + row; y += row) {
      const swell = Math.sin(y / H * Math.PI * 2 + belly) * width * .24, jitter = (Math.floor(random() * 3) - 1) * .14;
      points.push([x + width * .22 + swell + jitter, y], [x + width * .22 + swell + jitter, y + row]);
      back.unshift([x + width * .78 - swell + jitter * -1, y], [x + width * .78 - swell - jitter, y + row]);
    }
    k.poly(name, [...points, ...back.reverse().reverse()]);
    if (c % 2) k.poly(c % 4 === 1 ? 'Arktika' : 'Novvot', star(x + width / 2, H * .5, Math.min(H * .3, width * .22), .48, 4, 0));
    x += width;
  }
}

// 5. Only the shadow of the caravan, as if the sun sat low behind you. Nothing casts it.
function shadow(k, { L, H, seed }) {
  const random = mulberry(seed);
  k.rect('Saxro', -1, -1, L + 2, H + 2);
  const c = k.ctx;
  for (let x = -H; x < L; x += 7 + random() * 4) {
    c.save();
    c.transform(1, 0, -1.25, 1, x + H * .25, 0);
    const size = Math.min(H * .78, 3);
    k.smooth('Kanyon', CAMEL, 0, 0, size * 1.25);
    k.smooth('Kanyon', CAMEL, size * 1.5, 0, size * 1.12);
    if (random() > .35) { k.rect('Kanyon', size * 3.1, 0, size * .28, H * .95); k.circle('Kanyon', size * 3.24, H * .95, size * .22); }
    c.restore();
  }
  k.rect('Bodom', -1, -1, L + 2, Math.min(.16, H * .05) + 1);
}

// 6. 2750 years of the same road: camel, cart, truck, Afrosiyob train, airliner.
function journey(k, { L, H }) {
  k.rect('Novvot', -1, -1, L + 2, H + 2);
  k.rect('Grafit', -1, -1, L + 2, H * .09 + 1);
  const u = Math.min(H, 3.4);
  const floor = H * .09;
  const camel = (x) => k.smooth('Bodom', CAMEL, x, floor, u * 1.05);
  const cart = (x) => { k.rect('Rubin', x, floor + u * .3, u * 1.1, u * .32); k.circle('BlackCoffee', x + u * .3, floor + u * .22, u * .22); k.smooth('Kanyon', CAMEL, x + u * 1.15, floor, u * .72); };
  const truck = (x) => { k.rect('Zumrad', x, floor + u * .2, u * 1.5, u * .5); k.rect('Arktika', x + u * 1.52, floor + u * .2, u * .52, u * .36); k.circle('BlackCoffee', x + u * .35, floor + u * .13, u * .13); k.circle('BlackCoffee', x + u * 1.65, floor + u * .13, u * .13); };
  const train = (x) => { k.smooth('Arktika', [[0, 0], [3, 0], [3.5, .05], [3.9, .3], [3.5, .62], [0, .62]], x, floor + u * .1, u); k.rect('Zarafshon', x + u * .1, floor + u * .42, u * 3, u * .1); };
  const plane = (x) => { const y = H * .55; k.smooth('Marvarid', [[0, .05], [2.4, 0], [2.9, .09], [2.4, .2], [.4, .2], [0, .5], [-.15, .5], [.05, .16]], x, y, u * .8); k.poly('BlackCoffee', [[x + u, y + u * .1], [x + u * 1.6, y + u * .1], [x + u * .8, y - u * .34], [x + u * .55, y - u * .34]]); };
  const sequence = [camel, camel, camel, cart, cart, truck, truck, train, plane];
  const spacing = Math.max(u * 1.9, Math.min(u * 2.6, L / sequence.length));
  let x = spacing * .12, i = 0;
  while (x < L - u) {
    sequence[i % sequence.length](x);
    x += sequence[i % sequence.length] === train ? spacing * 1.3 : spacing;
    i++;
  }
  k.circle('Safari', L * .86, H * .72, u * .24);
}

// 7. The wall becomes a lake: the city stands on the horizon and breaks up in the water.
function lake(k, { L, H }) {
  const horizon = H * .46;
  k.rect('Arktika', -1, horizon, L + 2, H);
  k.rect('Zumrad', -1, -1, L + 2, horizon + 1);
  const u = H * .4;
  const skyline = (mirror) => {
    for (let x = u * .2; x < L; x += u * 3.2) {
      const y = (v) => horizon + v * mirror;
      const color = mirror > 0 ? 'Zarafshon' : 'Koksaroy';
      k.poly(mirror > 0 ? 'Grafit' : 'Terrachcho', [[x, y(0)], [x, y(u * .78)], [x + u * .5, y(u * .78)], [x + u * .5, y(u * .3)], [x + u, y(u * .3)], [x + u, y(u * .78)], [x + u * 1.5, y(u * .78)], [x + u * 1.5, y(0)]]);
      k.smooth(mirror > 0 ? 'Zumrad' : 'Bahor', [[0, 0], [.1, .34], [.4, .55], [.5, .85], [.6, .55], [.9, .34], [1, 0]], x + u * 1.75, horizon + u * .1 * mirror, u * .9, 1);
      if (mirror > 0) k.smooth('Zumrad', [[0, 0], [1, 0], [1, .1], [0, .1]], x + u * 1.75, horizon, u * .9);
      k.poly(color, [[x + u * 2.8, y(0)], [x + u * 2.8, y(u * .95)], [x + u * 2.95, y(u * 1.05)], [x + u * 3.1, y(u * .95)], [x + u * 3.1, y(0)]]);
    }
  };
  skyline(1);
  skyline(-1);
  for (let row = 0; row < 5; row++) {
    const y = horizon - (row + .7) * H * .085, gap = 1.4 + row * .9;
    for (let x = (row % 2) * 2; x < L; x += gap + 2) k.rect('Zumrad', x, y, gap, H * .022 + row * .018);
  }
  k.circle('Safari', L * .72, H * .78, u * .34);
}

// 8. Cut pomegranates at the scale of a house; each seed is one simple hand-laid tile.
function pomegranate(k, { L, H, seed }) {
  const random = mulberry(seed);
  k.rect('Anor', -1, -1, L + 2, H + 2);
  const R = H * .62;
  for (let x = R * .3; x < L + R; x += R * 2.4) {
    const y = H * (.42 + random() * .16);
    k.circle('Bodom', x, y, R);
    k.circle('Novvot', x, y, R * .9);
    for (let sector = 0; sector < 6; sector++) {
      const a0 = sector * Math.PI / 3 + .1 + .06, a1 = (sector + 1) * Math.PI / 3 + .1 - .06;
      for (let ring = 0; ring < 3; ring++) {
        const r0 = R * (.2 + ring * .23), r1 = r0 + R * .2;
        const seeds = ring + 2;
        for (let n = 0; n < seeds; n++) {
          const b0 = a0 + (a1 - a0) * n / seeds + .025, b1 = a0 + (a1 - a0) * (n + 1) / seeds - .025, mid = (b0 + b1) / 2;
          k.smooth(random() > .86 ? 'Zamin' : 'Rubin', [[Math.cos(mid) * r0, Math.sin(mid) * r0], [Math.cos(b0) * (r0 + r1) / 2, Math.sin(b0) * (r0 + r1) / 2], [Math.cos(b0) * r1, Math.sin(b0) * r1], [Math.cos(b1) * r1, Math.sin(b1) * r1], [Math.cos(b1) * (r0 + r1) / 2, Math.sin(b1) * (r0 + r1) / 2]], x, y);
        }
      }
    }
    k.circle('Arktika', x, y, R * .12);
  }
}

// 9. Flat squares that swell into a wave you drive past; continues the zigzag of the slopes.
function bulge(k, { L, H }) {
  const rows = 6, rowH = H / rows, cell = 1.5;
  k.rect('Novvot', -1, -1, L + 2, H + 2);
  const zig = (r) => Math.abs(((r % 4) + 4) % 4 - 2) * cell * .5;
  const warp = (x, r) => x + zig(r) + Math.sin(x * .13) * 1.6;
  const bump = (x, r) => (r - rows / 2 + .5) * rowH * .16 * Math.sin(x * .13 + .6);
  for (let c = -8; c * cell < L + 8; c++) {
    if (((c % 4) + 4) % 4 > 1) continue;
    const dark = ((c % 8) + 8) % 8 < 2;
    for (let r = -1; r <= rows; r++) {
      const q = (x, rr) => [warp(x, r), rr * rowH + bump(x, rr)];
      k.poly(dark ? 'BlackCoffee' : 'Rubin', [q(c * cell, r), q((c + 2) * cell, r), q((c + 2) * cell, r + 1), q(c * cell, r + 1)]);
    }
  }
}

// 10. From one marked spot the shards click into a single star; from anywhere else they are abstract.
function assembly(k, { L, H, wall, id }) {
  k.rect('Novvot', -1, -1, L + 2, H + 2);
  k.rect('Kanyon', -1, -1, L + 2, H * .12 + 1);
  const markers = wall?.anamorph?.[id] || [];
  markers.forEach(({ rings }) => {
    rings.forEach(({ stone: name, points }) => k.poly(name, points));
  });
  if (!markers.length) {
    const r = H * .36;
    for (let x = r * 1.3; x < L; x += r * 3) { k.circle('Arktika', x, H * .54, r); k.poly('Rubin', star(x, H * .54, r * .86)); k.poly('BlackCoffee', star(x, H * .54, r * .4)); }
  }
}

// Base: the concrete as poured, cleaned, for comparison.
function plain(k, { L, H }) { k.rect('Marvarid', -1, -1, L + 2, H + 2); }

export const DESIGNS = [
  { id: 'pomegranate', title: 'Большой гранат', hint: 'Каждое зерно: одна простая плитка из камня', paint: pomegranate },
  { id: 'sky', title: 'Небо 1437 года', hint: 'Настоящие координаты звёзд, 24 часа вдоль стены', paint: sky },
  { id: 'strata', title: 'Что держит стена', hint: 'Разрез холма: слои земли и находки Афрасиаба', paint: strata },
  { id: 'word', title: 'Форма слова', hint: 'Настоящая звуковая волна слова «Самарканд»', paint: word },
  { id: 'adras', title: 'Адрас в тысячу раз', hint: 'Размытый край ткани становится ступенчатым краем камня', paint: adras },
  { id: 'shadow', title: 'Тень каравана', hint: 'На стене только тень, верблюдов нигде нет', paint: shadow },
  { id: 'journey', title: 'Та же дорога', hint: 'Верблюд, арба, грузовик, Афросиёб, самолёт: 2750 лет за 100 метров', paint: journey },
  { id: 'lake', title: 'Город над водой', hint: 'Стена становится озером, город отражается и дробится', paint: lake },
  { id: 'bulge', title: 'Волна', hint: 'Ступени зигзага с откосов переходят на стену и плывут, пока едешь мимо', paint: bulge },
  { id: 'assembly', title: 'Точка сборки', hint: 'С одной отметки на тротуаре осколки складываются в звезду', paint: assembly, marker: true },
  { id: 'plain', title: 'Без рисунка', hint: 'Один камень, для сравнения', paint: plain },
];

export function paintDesign(ctx, design, { L, H, s0 = 0, pxPerMetre, wall, seed = 1 }) {
  ctx.save();
  ctx.setTransform(pxPerMetre, 0, 0, -pxPerMetre, -s0 * pxPerMetre, ctx.canvas.height);
  design.paint(kit(ctx), { L, H, wall, seed, id: design.id });
  ctx.restore();
}
