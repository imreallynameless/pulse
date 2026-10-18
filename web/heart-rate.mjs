// Bluetooth SIG Heart Rate Measurement, little-endian; RR units are 1/1024 s.
export function decodeHeartRate(value) {
  let offset = 0;
  const take = (width) => {
    if (offset + width > value.byteLength) throw new Error('Malformed heart-rate packet');
    const result = width === 1 ? value.getUint8(offset) : value.getUint16(offset, true);
    offset += width;
    return result;
  };
  const flags = take(1);
  const bpm = take(flags & 1 ? 2 : 1);
  const contact = flags & 4 ? Boolean(flags & 2) : null;
  const energy = flags & 8 ? take(2) : null;
  const rrMs = [];
  if (flags & 16) {
    if (offset === value.byteLength) throw new Error('Malformed heart-rate packet: missing RR interval');
    while (offset < value.byteLength) rrMs.push(take(2) * 1000 / 1024);
  }
  if (offset !== value.byteLength) throw new Error('Malformed heart-rate packet: unexpected bytes');
  return { bpm, contact, energy, rrMs };
}

export function summarizeIntervals(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
  return { count: sorted.length, median: rank(0.5), p95: rank(0.95), max: sorted.at(-1) ?? null };
}

export function readingState(connected, lastReceived, now) {
  if (!connected) return 'Offline';
  if (lastReceived === null) return 'Waiting for readings';
  return now - lastReceived >= 5000 ? 'Stale' : 'Live';
}
