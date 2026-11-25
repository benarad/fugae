// The room the page's instruments are heard in, on the fugue's page and in a clip: what a convolver is given.

/** The sound of a room: a burst of noise dying away over `seconds`, duller as it goes. Always the same. */
export function echo(ctx, seconds = 1.9) {
  const RATE = ctx.sampleRate;
  const length = Math.ceil(seconds * RATE), room = ctx.createBuffer(2, length, RATE), first = Math.round(0.012 * RATE);
  for (let c = 0; c < 2; c++) {
    const data = room.getChannelData(c);
    let seed = 1234567 + c * 7654321, low = 0;
    for (let i = first; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const t = (i - first) / RATE, keep = 0.25 + 0.6 * Math.min(1, t / 0.6);
      low = low * keep + (seed / 2147483648) * (1 - keep);
      data[i] = low * Math.exp(-t * 6.9 / seconds);
    }
    // Scaled so that what comes back is as strong, in all, as what went in: the mix then says how much room.
    let power = 0;
    for (let i = 0; i < length; i++) power += data[i] * data[i];
    const scale = 1 / Math.sqrt(power);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return room;
}
