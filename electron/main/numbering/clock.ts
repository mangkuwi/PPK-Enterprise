/** Jam yang dapat diganti pada pengujian. */
export const clock = { now: (): Date => new Date() };
export const nowIso = () => clock.now().toISOString();
