// Real survey data from the customer's DWG (X, Y, elevation in metres).
// Everything here is measured except the extensions beyond the surveyed stretch.
const ORIGIN = { X: 3820, Y: 1960, Z: 684 };
const toLocal = ([X, Y, Z]) => [X - ORIGIN.X, Z - ORIGIN.Z, -(Y - ORIGIN.Y)];

export const westFoot = [
  [3771.19, 1840.5, 682.398], [3778.58, 1860.58, 682.927], [3783.34, 1873.52, 683.203], [3789.58, 1890.54, 683.49],
  [3794.57, 1904.36, 683.825], [3800.76, 1922.54, 684.023], [3804.99, 1935.94, 684.136], [3808.05, 1946.31, 684.206],
  [3811.1, 1957.13, 684.217], [3814.92, 1971.77, 684.228], [3817.37, 1981.73, 684.228], [3821.59, 2001.07, 684.248],
  [3824.91, 2015.73, 684.054], [3826.89, 2025.73, 683.95], [3828.72, 2035.16, 683.849], [3830.93, 2046.97, 683.71],
  [3833.27, 2059.38, 683.536], [3835.58, 2071.76, 683.334], [3837.75, 2083.19, 683.153], [3840.11, 2095.2, 682.975],
];
export const westCrest = [
  [3784.46, 1893.28, 686.357], [3789.4, 1906.36, 686.334], [3796.18, 1924.15, 686.202], [3800.95, 1937.25, 686.246],
  [3804.21, 1947.43, 686.253], [3807.24, 1958.08, 686.116], [3810.85, 1972.21, 686.131], [3813.56, 1982.69, 686.138],
  [3818.05, 2002.49, 685.894], [3821.16, 2016.55, 685.37], [3823.29, 2026.49, 685.068], [3825.36, 2035.81, 684.804],
  [3827.94, 2047.62, 684.348], [3830.66, 2059.88, 683.896], [3833.35, 2072.19, 683.491], [3835.84, 2083.42, 683.245],
  [3840.23, 2095.86, 682.985],
];
export const eastFoot = [
  [3823.01, 1850.54, 682.987], [3819.41, 1860.31, 683.126], [3817.93, 1870.16, 683.354], [3817.14, 1881.01, 683.579],
  [3817.56, 1891.67, 683.827], [3819.61, 1902.55, 684.014], [3821.94, 1912.26, 684.124], [3825.07, 1923.32, 684.259],
  [3828.92, 1936.52, 684.314], [3832.26, 1947.97, 684.392], [3835.47, 1958.61, 684.397], [3838.44, 1961.34, 684.617],
  [3839.84, 1966.67, 684.616], [3842.41, 1976.81, 684.581], [3844.42, 1985.18, 684.559], [3847.89, 2001.25, 684.443],
  [3849.97, 2011.55, 684.35], [3852.73, 2025.3, 684.159], [3854.76, 2035.63, 683.946], [3857.6, 2050.35, 683.7],
  [3859.51, 2060.76, 683.545], [3861.13, 2069.93, 683.341], [3862.23, 2075.85, 683.224],
];
export const eastCrest = [
  [3841, 1960.76, 686.224], [3843.94, 1971.28, 686.14], [3847.61, 1984.53, 686.106], [3851.87, 2001.52, 685.863],
  [3853.58, 2012.56, 685.702], [3856.05, 2028.79, 685.315], [3857, 2035.18, 685.137], [3860.49, 2060.82, 683.971],
  [3861.68, 2069.87, 683.462], [3862.41, 2075.81, 683.234],
];
// Tops measured by the surveyor along the low wall (338.70 m2 in the DWG).
export const lowWall = [
  [3823.01, 1850.54, 682.987, 686.32], [3819.41, 1860.31, 683.126, 686.504], [3817.93, 1870.16, 683.354, 686.869],
  [3817.14, 1881.01, 683.579, 686.98], [3817.56, 1891.67, 683.827, 687.033], [3819.61, 1902.55, 684.014, 687.021],
  [3821.94, 1912.26, 684.124, 686.914], [3825.07, 1923.32, 684.259, 686.809], [3828.92, 1936.52, 684.314, 686.72],
  [3832.26, 1947.97, 684.392, 686.656], [3835.47, 1958.61, 684.397, 686.561],
];
// High wall (288.94 m2): only the base was surveyed, the height follows from area / length.
const HIGH_WALL_HEIGHT = 288.94 / 53.2;
export const highWall = westFoot.slice(0, 4).map(([X, Y, Z]) => [X, Y, Z, Z + HIGH_WALL_HEIGHT]);
// Stepped wall (43.22 m2): three steps, the top level changes at points 19 and 22.
export const stepWall = [
  [3821.86, 1830.3, 682.543, 686.786], [3818.9, 1835.8, 682.549, 686.776], [3818.8, 1835.85, 682.549, 685.848],
  [3817.4, 1838.6, 682.544, 685.8], [3817.35, 1838.65, 682.544, 684.369], [3815.8, 1841.37, 682.534, 684.367],
];

const lerp = (a, b, t) => a + (b - a) * t;
const interpByY = (points, Y, col) => {
  if (Y <= points[0][1]) return points[0][col] + (points[1][col] - points[0][col]) / (points[1][1] - points[0][1]) * (Y - points[0][1]);
  for (let i = 1; i < points.length; i++) {
    if (Y <= points[i][1]) {
      const a = points[i - 1], b = points[i];
      const t = (Y - a[1]) / (b[1] - a[1]), t0 = points[i - 2], t1 = points[i + 1];
      // Catmull-Rom keeps the surveyed curve smooth between picket points.
      const p0 = (t0 || a)[col], p3 = (t1 || b)[col], p1 = a[col], p2 = b[col];
      return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    }
  }
  const n = points.length;
  return points[n - 1][col] + (points[n - 1][col] - points[n - 2][col]) / (points[n - 1][1] - points[n - 2][1]) * (Y - points[n - 1][1]);
};

// Road stations from the surveyed part plus gently bending extensions on both ends.
const SOUTH_Y = 1490, NORTH_Y = 2540, STEP = 2;
export const SURVEY = { yMin: 1830, yMax: 2096, ...ORIGIN };

const edgeAt = (Y) => {
  // South of the side street the east edge swings west, leaving the stepped wall outside the road.
  const eastPoints = [[3796, 1800, 682.1], [3806, 1826, 682.48], [3812.5, 1840, 682.7], ...eastFoot];
  let wx = interpByY(westFoot, Math.max(Y, 1840.5), 0), wz = interpByY(westFoot, Math.max(Y, 1840.5), 2);
  let ex = interpByY(eastPoints, Math.max(Y, 1800), 0), ez = interpByY(eastPoints, Math.max(Y, 1800), 2);
  if (Y > 2075.85) { ex = interpByY(westFoot, Y, 0) + 26.4; ez = Math.max(681, interpByY(eastFoot, 2075.85, 2) - (Y - 2075.85) * 0.012); }
  if (Y < 1840.5) { wx += (Y - 1840.5) * 0.36; wz = 682.398 + (Y - 1840.5) * 0.012; }
  if (Y < 1800) { const k = (1800 - Y); wx = interpByY(westFoot, 1840.5, 0) + (Y - 1840.5) * 0.36; ex = wx + 30; ez = 682.1 - k * 0.006; wz = ez; }
  if (Y > 2095.2) { const k = Y - 2095.2; wx = 3840.11 + k * 0.2 + k * k * 0.00022; ex = wx + 26.4; wz = Math.max(680.5, 682.975 - k * 0.01); ez = wz; }
  return { wx, wz, ex, ez };
};

export const stations = [];
let arc = 0;
for (let Y = SOUTH_Y; Y <= NORTH_Y; Y += STEP) {
  const { wx, wz, ex, ez } = edgeAt(Y);
  const W = [wx - ORIGIN.X, wz - ORIGIN.Z, -(Y - ORIGIN.Y)];
  const E = [ex - ORIGIN.X, ez - ORIGIN.Z, -(Y - ORIGIN.Y)];
  const s = { Y, W, E };
  if (stations.length) {
    const p = stations[stations.length - 1];
    arc += Math.hypot((W[0] + E[0]) / 2 - (p.W[0] + p.E[0]) / 2, W[2] - p.W[2]);
  }
  s.arc = arc;
  s.width = Math.hypot(E[0] - W[0], E[2] - W[2]);
  stations.push(s);
}
// Smooth the junction transitions: a kink is visible at road scale otherwise.
for (let pass = 0; pass < 18; pass++) {
  const copy = stations.map((s) => ({ wx: s.W[0], ex: s.E[0], wy: s.W[1], ey: s.E[1] }));
  for (let i = 2; i < stations.length - 2; i++) {
    const Y = stations[i].Y;
    const surveyedWest = Y > 1844 && Y < 2094, surveyedEast = Y > 1852 && Y < 2074;
    if (!surveyedWest) { stations[i].W[0] = (copy[i - 2].wx + copy[i - 1].wx + copy[i].wx + copy[i + 1].wx + copy[i + 2].wx) / 5; stations[i].W[1] = (copy[i - 2].wy + copy[i - 1].wy + copy[i].wy + copy[i + 1].wy + copy[i + 2].wy) / 5; }
    if (!surveyedEast) { stations[i].E[0] = (copy[i - 2].ex + copy[i - 1].ex + copy[i].ex + copy[i + 1].ex + copy[i + 2].ex) / 5; stations[i].E[1] = (copy[i - 2].ey + copy[i - 1].ey + copy[i].ey + copy[i + 1].ey + copy[i + 2].ey) / 5; }
  }
}
export const station = (Y) => stations[Math.max(0, Math.min(stations.length - 1, Math.round((Y - SOUTH_Y) / STEP)))];
// A point across the road at a given station: u = 0 on the west edge, 1 on the east edge.
export const across = (s, u) => [lerp(s.W[0], s.E[0], u), lerp(s.W[1], s.E[1], u), lerp(s.W[2], s.E[2], u)];

export function crestAt(points, Y) {
  if (Y < points[0][1] || Y > points[points.length - 1][1]) return null;
  return [interpByY(points, Y, 0) - ORIGIN.X, interpByY(points, Y, 2) - ORIGIN.Z, -(Y - ORIGIN.Y)];
}

// A wall as a curve in local coordinates: base, top, arc length.
export function wallCurve(points, subdiv = 8) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    for (let k = 0; k < subdiv; k++) {
      const t = k / subdiv, get = (col) => {
        const p0 = (points[i - 1] || a)[col], p1 = a[col], p2 = b[col], p3 = (points[i + 2] || b)[col];
        return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
      };
      out.push([get(0), get(1), get(2), get(3)]);
    }
  }
  out.push(points[points.length - 1]);
  let s = 0;
  return out.map((p, i) => {
    if (i) s += Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]);
    const [x, base, z] = toLocal([p[0], p[1], p[2]]);
    return { x, z, base, top: p[3] - ORIGIN.Z, s };
  });
}

export const walls = {
  high: { id: 'high', title: 'Высокая стена', area: 288.94, curve: wallCurve(highWall), normalSign: 1 },
  low: { id: 'low', title: 'Длинная стена', area: 338.7, curve: wallCurve(lowWall), normalSign: -1 },
};
// The stepped wall keeps hard corners between the steps.
{
  let s = 0;
  const curve = stepWall.map((p, i) => {
    if (i) s += Math.hypot(p[0] - stepWall[i - 1][0], p[1] - stepWall[i - 1][1]);
    const [x, base, z] = toLocal(p);
    return { x, z, base, top: p[3] - ORIGIN.Z, s };
  });
  walls.step = { id: 'step', title: 'Ступенчатая стена', area: 43.22, curve, normalSign: 1 };
}
// Bare concrete bays inside the tiled slopes, 68 m2 and 52 m2 in the DWG.
export const bays = {
  zone68: { id: 'zone68', title: 'Откос, 68 м²', side: 'west', yFrom: 1981.8, yTo: 2001.8 },
  zone52: { id: 'zone52', title: 'Откос, 52 м²', side: 'east', yFrom: 1975.4, yTo: 1995 },
};
export const ROAD = { SIDEWALK: 5.8, LANE: 6.6, CURB_DROP: 0.15 };
