import { qualityOf, qualityOptions, type MediaSourceState, type QualityKey } from './mediaResolver';

/*
 * The pure live quality rules (Story 7.2), used by `createLiveMode`
 * (`playbackMode.ts`). Kept out of the `useLivePlayback` hook module so the
 * pure mode imports no hook module.
 */

/** Story 7.2 (owner decision 2026-10-30): live shows the gear only with a real quality choice. */
export function liveSettingsShown(sources: Parameters<typeof qualityOptions>[0]): boolean {
  return qualityOptions(sources).length > 1;
}

/**
 * Story 7.2 (owner decision 2026-10-30): whether a quality pick switches the
 * live source (true: another source of the same E15 has that quality; false:
 * no ready source, no such quality, or the playing one). The chosen live
 * source plays from the live edge: no position, no stored preference.
 */
export function liveQualitySwitch(
  current: Extract<MediaSourceState, { kind: 'ready' }> | null,
  key: QualityKey,
): boolean {
  const next = current === null ? null : (current.sources.find(source => qualityOf(source) === key) ?? null);
  return current !== null && next !== null && next !== current.source;
}
