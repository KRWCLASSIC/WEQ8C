import { FilterType } from "./spec";

export function filterHasGain(type: FilterType | "noop"): boolean {
  return (
    type === "lowshelf12" ||
    type === "lowshelf24" ||
    type === "highshelf12" ||
    type === "highshelf24" ||
    type === "peaking12" ||
    type === "peaking24"
  );
}

export function filterHasFrequency(type: FilterType | "noop"): boolean {
  return type !== "noop";
}

export function filterHasQ(type: FilterType | "noop"): boolean {
  return (
    type === "lowpass12" ||
    type === "lowpass24" ||
    type === "highpass12" ||
    type === "highpass24" ||
    type === "bandpass12" ||
    type === "bandpass24" ||
    type === "peaking12" ||
    type === "peaking24" ||
    type === "notch12" ||
    type === "notch24"
  );
}

export function getBiquadFilterType(filterType: FilterType): BiquadFilterType {
  switch (filterType) {
    case "lowpass12":
    case "lowpass24":
      return "lowpass";
    case "highpass12":
    case "highpass24":
      return "highpass";
    case "bandpass12":
    case "bandpass24":
      return "bandpass";
    case "lowshelf12":
    case "lowshelf24":
      return "lowshelf";
    case "highshelf12":
    case "highshelf24":
      return "highshelf";
    case "peaking12":
    case "peaking24":
      return "peaking";
    case "notch12":
    case "notch24":
      return "notch";
  }
}

export function getBiquadFilterOrder(
  filterType: FilterType | "noop"
): 0 | 1 | 2 {
  switch (filterType) {
    case "noop":
      return 0;
    case "lowpass12":
    case "highpass12":
    case "bandpass12":
    case "lowshelf12":
    case "highshelf12":
    case "peaking12":
    case "notch12":
      return 1;
    case "lowpass24":
    case "highpass24":
    case "bandpass24":
    case "lowshelf24":
    case "highshelf24":
    case "peaking24":
    case "notch24":
      return 2;
  }
}

export function toLog10(lin: number, minLin: number, maxLin: number) {
  let minLog = Math.log10(minLin);
  let maxLog = Math.log10(maxLin);
  return (Math.log10(clamp(lin, minLin, maxLin)) - minLog) / (maxLog - minLog);
}

export function toLin(log: number, minLin: number, maxLin: number) {
  let minLog = Math.log10(minLin);
  let maxLog = Math.log10(maxLin);
  return clamp(Math.pow(10, log * (maxLog - minLog) + minLog), minLin, maxLin);
}

export function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

export function formatFrequency(freq: number, keepHz = false) {
  if (freq >= 1000 && !keepHz) {
    return (freq / 1000).toFixed(2);
  }
  return freq.toFixed(0);
}

export function formatFrequencyUnit(freq: number, keepHz = false) {
  if (freq >= 1000 && !keepHz) {
    return "kHz";
  }
  return "Hz";
}

export function buildHardClipCurve(length: number, threshold: number): Float32Array {
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1; // range [-1, 1]
    curve[i] = clamp(x, -threshold, threshold);
  }
  return curve;
}

export function buildSoftClipCurve(length: number, threshold: number): Float32Array {
  const curve = new Float32Array(length);
  // Using a soft-clip approach: linear below threshold * 0.5, tanh-like/smooth mapping up to/above threshold
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1; // range [-1, 1]
    // tanh soft clipping: we can scale x by 1/threshold then apply tanh, then scale back
    // Or just a standard soft clipping function: f(x) = tanh(x / threshold) * threshold
    curve[i] = Math.tanh(x / threshold) * threshold;
  }
  return curve;
}

export function buildFoldbackCurve(length: number, threshold: number): Float32Array {
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let x = (i / (length - 1)) * 2 - 1; // range [-1, 1]
    // Foldback: if x exceeds threshold, fold it back.
    // e.g. if x > threshold: x = threshold - (x - threshold) = 2*threshold - x
    // similarly for negative values
    if (x > threshold) {
      x = 2 * threshold - x;
    } else if (x < -threshold) {
      x = -2 * threshold - x;
    }
    curve[i] = clamp(x, -1, 1);
  }
  return curve;
}

