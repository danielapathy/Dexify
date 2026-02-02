function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// --- Color conversions (sRGB D65) ---
function srgbToLinear(u) {
  u /= 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function linearToSrgb(u) {
  u = clamp01(u);
  return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
}

function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  return [x, y, z];
}

function xyzToLab(x, y, z) {
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  let fx = x / Xn;
  let fy = y / Yn;
  let fz = z / Zn;
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  fx = fx > eps ? Math.cbrt(fx) : (kappa * fx + 16) / 116;
  fy = fy > eps ? Math.cbrt(fy) : (kappa * fy + 16) / 116;
  fz = fz > eps ? Math.cbrt(fz) : (kappa * fz + 16) / 116;
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [L, a, b];
}

function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labToXyz(L, a, b) {
  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  const fx3 = fx ** 3;
  const fy3 = fy ** 3;
  const fz3 = fz ** 3;
  const xr = fx3 > eps ? fx3 : (116 * fx - 16) / kappa;
  const yr = L > kappa * eps ? fy3 : L / kappa;
  const zr = fz3 > eps ? fz3 : (116 * fz - 16) / kappa;
  return [xr * Xn, yr * Yn, zr * Zn];
}

function xyzToRgb(x, y, z) {
  let R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let G = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  R = Math.round(255 * linearToSrgb(R));
  G = Math.round(255 * linearToSrgb(G));
  B = Math.round(255 * linearToSrgb(B));
  return [clamp(R, 0, 255), clamp(G, 0, 255), clamp(B, 0, 255)];
}

function labToRgb(L, a, b) {
  const [x, y, z] = labToXyz(L, a, b);
  return xyzToRgb(x, y, z);
}

function isLikelySkin(r, g, b) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return Cr > 133 && Cr < 173 && Cb > 77 && Cb < 127 && Y > 40;
}

function weightedKMeansLab(samples, weights, k, iters) {
  if (samples.length === 0) return null;
  const safeK = Math.max(2, Math.min(k, Math.max(2, Math.floor(samples.length / 16))));

  const centers = [];
  let first = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] > weights[first]) first = i;
  }
  centers.push(samples[first].slice());

  // Deterministic k-means++-like init (weighted): pick farthest weighted samples.
  while (centers.length < safeK) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let best = Infinity;
      for (const c of centers) {
        const dL = s[0] - c[0];
        const da = s[1] - c[1];
        const db = s[2] - c[2];
        const d = dL * dL + da * da + db * db;
        if (d < best) best = d;
      }
      const score = weights[i] * best;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (!(bestIdx >= 0) || !(bestScore > 0)) break;
    centers.push(samples[bestIdx].slice());
  }

  const assignments = new Array(samples.length).fill(0);
  for (let iter = 0; iter < iters; iter++) {
    // Assign
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let best = 0;
      let bestD = Infinity;
      for (let ci = 0; ci < centers.length; ci++) {
        const c = centers[ci];
        const dL = s[0] - c[0];
        const da = s[1] - c[1];
        const db = s[2] - c[2];
        const d = dL * dL + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      }
      assignments[i] = best;
    }

    // Update
    const sumL = new Array(centers.length).fill(0);
    const suma = new Array(centers.length).fill(0);
    const sumb = new Array(centers.length).fill(0);
    const sumw = new Array(centers.length).fill(0);
    for (let i = 0; i < samples.length; i++) {
      const ci = assignments[i];
      const w = weights[i];
      const s = samples[i];
      sumL[ci] += s[0] * w;
      suma[ci] += s[1] * w;
      sumb[ci] += s[2] * w;
      sumw[ci] += w;
    }
    for (let ci = 0; ci < centers.length; ci++) {
      const w = sumw[ci];
      if (!(w > 0)) continue;
      centers[ci][0] = sumL[ci] / w;
      centers[ci][1] = suma[ci] / w;
      centers[ci][2] = sumb[ci] / w;
    }
  }

  const clusterWeights = new Array(centers.length).fill(0);
  for (let i = 0; i < samples.length; i++) {
    clusterWeights[assignments[i]] += weights[i];
  }

  return { centers, clusterWeights };
}

export async function extractPrimaryColorFromImageUrl(
  url,
  {
    maxRes = 220,
    k = 8,
    iters = 10,
    centerBias = true,
    edgeWeight = true,
    skinDownweight = true,
    avoidNeutrals = true,
  } = {},
) {
  const src = String(url || "").trim();
  if (!src) return null;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.loading = "eager";

  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve(true);
    img.onerror = () => reject(new Error("image load failed"));
  });

  img.src = src;
  await loaded;

  const iw = img.naturalWidth || 0;
  const ih = img.naturalHeight || 0;
  if (!iw || !ih) return null;

  const scale = Math.min(1, Number(maxRes) / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  // Cap samples to keep clustering fast.
  const targetSamples = 18000;
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / targetSamples)));
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;

  const samples = [];
  const weights = [];

  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgW = 0;

  const idxOf = (x, y) => (y * w + x) * 4;
  const lumaAt = (x, y) => {
    const i = idxOf(x, y);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = idxOf(x, y);
      const a = data[i + 3];
      if (a < 40) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const [L, A, B] = rgbToLab(r, g, b);
      const chroma = Math.sqrt(A * A + B * B);

      let weight = a / 255;
      if (centerBias) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
        const t = 1 - clamp01(d);
        weight *= 0.35 + 0.65 * t * t;
      }

      if (edgeWeight) {
        const right = x + step < w ? lumaAt(x + step, y) : lumaAt(Math.max(0, x - step), y);
        const down = y + step < h ? lumaAt(x, y + step) : lumaAt(x, Math.max(0, y - step));
        const cur = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const grad = (Math.abs(cur - right) + Math.abs(cur - down)) / (255 * 2);
        weight *= 0.55 + 0.45 * clamp01(grad * 2.2);
      }

      if (avoidNeutrals) {
        if (chroma < 10) weight *= 0.12;
        if (L < 6 || L > 96) weight *= 0.15;
      }

      if (skinDownweight && isLikelySkin(r, g, b)) {
        weight *= 0.35;
      }

      // Favor colorful pixels.
      weight *= 0.35 + 0.65 * clamp01(chroma / 70);
      if (!(weight > 0.001)) continue;

      samples.push([L, A, B]);
      weights.push(weight);

      avgR += r * weight;
      avgG += g * weight;
      avgB += b * weight;
      avgW += weight;
    }
  }

  if (samples.length === 0 || !(avgW > 0)) return null;

  const km = weightedKMeansLab(samples, weights, k, iters);
  if (!km) {
    return { r: Math.round(avgR / avgW), g: Math.round(avgG / avgW), b: Math.round(avgB / avgW) };
  }

  // Pick a cluster that is prominent, colorful, and not extreme light/dark.
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < km.centers.length; i++) {
    const c = km.centers[i];
    const wgt = km.clusterWeights[i] || 0;
    const chroma = Math.sqrt(c[1] * c[1] + c[2] * c[2]);
    const L = c[0];
    const lightPenalty = 1 - clamp01(Math.abs(L - 55) / 55);
    const neutralPenalty = avoidNeutrals ? clamp01(chroma / 22) : 1;
    const score = wgt * (0.35 + 0.65 * clamp01(chroma / 70)) * (0.35 + 0.65 * lightPenalty) * (0.25 + 0.75 * neutralPenalty);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const [r, g, b] = labToRgb(km.centers[bestIdx][0], km.centers[bestIdx][1], km.centers[bestIdx][2]);
  return { r, g, b };
}
