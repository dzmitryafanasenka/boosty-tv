import type { Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { isGenericVideoTitle } from '../../shared/entities/post';
import { tf, t } from '../../shared/i18n';
import { formatDuration } from '../../shared/i18n/format';
import {
  AuthorAvatar,
  FocusableSurface,
  GearIcon,
  SkipIcon,
  Text,
  colors,
  components,
  focus,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../shared/ui';
import type { PlayerMeta } from './mediaResolver';

/** Focus ids (docs/focus-map.md §1.5). */
export const PLAYER_TIMELINE_ID = 'player/timeline';
export const PLAYER_PLAYPAUSE_ID = 'player/playpause';
export const PLAYER_SETTINGS_ID = 'player/settings';
export const PLAYER_BACK10_ID = 'player/back10';
export const PLAYER_FORWARD10_ID = 'player/forward10';
/** The overlay's controls: raw ← → never seek on them (they move focus natively). */
export const PLAYER_CONTROL_IDS: ReadonlySet<string> = new Set([
  PLAYER_PLAYPAUSE_ID,
  PLAYER_BACK10_ID,
  PLAYER_FORWARD10_ID,
  PLAYER_SETTINGS_ID,
]);

const CONTROL = components['player-control'];
const TIMELINE = components.timeline;
const THUMB = 12;
const THUMB_FOCUSED = 16;
/** The legibility bands' darkening (DESIGN.md: the app's only gradient). */
const BAND_DARK = colors.scrim;

/** Whole seconds → `m:ss` / `h:mm:ss`. */
const time = (sec: number) => formatDuration(sec);


/**
 * The overlay shows the video title only when it adds something (owner
 * decision, Story 4.1 device check): not empty, not generic, not the post
 * title. The MediaRow on the Post keeps its own label rules.
 */
export function isDistinctVideoTitle(videoTitle: string, postTitle: string): boolean {
  const title = videoTitle.trim();
  return !isGenericVideoTitle(title) && title !== postTitle.trim();
}

/** «Позиция 1:23 из 12:34» (or without the duration when it is unknown). */
export function timelineA11yLabel(positionSec: number, durationSec: number): string {
  return durationSec > 0
    ? tf('player.timeline', { elapsed: time(positionSec), duration: time(durationSec) })
    : tf('player.timelineNoDuration', { elapsed: time(positionSec) });
}

/**
 * The bubble over the target, centered on it; near the ends it aligns with
 * the track's start or end instead, so it never crosses the safe area.
 */
function bubblePlacement(target: number) {
  if (target < BUBBLE_EDGE) {
    return { left: 0, alignItems: 'flex-start' as const };
  }
  if (target > 1 - BUBBLE_EDGE) {
    return { right: 0, alignItems: 'flex-end' as const };
  }
  return {
    left: `${target * 100}%` as const,
    marginLeft: -BUBBLE_ANCHOR_WIDTH / 2,
    alignItems: 'center' as const,
  };
}
/**
 * The bubble's box: wide enough for the longest time («1:11:21») on one
 * line, so the anchor never squeezes the text (it wrapped on the device).
 */
const BUBBLE_ANCHOR_WIDTH = 120;
/** Near the ends (≈ half the bubble box on the 864 dp track) it aligns with the track instead. */
const BUBBLE_EDGE = 0.08;

const fraction = (sec: number, durationSec: number) =>
  durationSec > 0 ? Math.max(0, Math.min(1, sec / durationSec)) : 0;

type TimelineProps = {
  positionSec: number;
  durationSec: number;
  /** The bubble's target (pending or in-flight seek); null when not seeking. */
  seekTargetSec: number | null;
  onPress: () => void;
  onFocus: () => void;
  ref?: Ref<HostView>;
};

/**
 * DESIGN.md Timeline: a track with accent progress and a thumb, thicker
 * when focused (no ring: the thicker track and the larger thumb are its
 * focus state). While seeking, a bubble above the track shows the target
 * time. OK toggles play/pause.
 */
function Timeline({ positionSec, durationSec, seekTargetSec, onPress, onFocus, ref }: TimelineProps) {
  const played = fraction(positionSec, durationSec);
  const target = seekTargetSec === null ? null : fraction(seekTargetSec, durationSec);
  // While a target is pending or in flight the thumb and the accent fill
  // follow it (owner decisions 2026-10-27, YouTube-style); afterwards they
  // show the real position.
  const thumbAt = target ?? played;
  return (
    <FocusableSurface
      ref={ref}
      testID={PLAYER_TIMELINE_ID}
      radius={TIMELINE.trackHeightFocus}
      scaleFocus={1}
      scalePressed={1}
      ring={false}
      accessibilityRole="adjustable"
      accessibilityLabel={timelineA11yLabel(positionSec, durationSec)}
      onPress={onPress}
      onFocus={onFocus}
      surfaceStyle={() => styles.timelineHit}
    >
      {({ focused }: SurfaceState) => {
        const track = focused ? TIMELINE.trackHeightFocus : TIMELINE.trackHeight;
        const thumb = focused ? THUMB_FOCUSED : THUMB;
        return (
          <View style={styles.trackBox}>
            {seekTargetSec !== null && target !== null ? (
              <View
                testID="player/bubble"
                style={[styles.bubbleAnchor, bubblePlacement(target)]}
                accessibilityLiveRegion="polite"
                accessibilityLabel={tf('player.seekTarget', { time: time(seekTargetSec) })}
              >
                <View style={styles.bubble}>
                  <Text testID="player/bubble/time" variant="button" numberOfLines={1} style={styles.tabular}>
                    {time(seekTargetSec)}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={[styles.track, { height: track, borderRadius: track / 2 }]}>
              <View
                testID="player/progress"
                style={[styles.fill, { width: `${thumbAt * 100}%`, borderRadius: track / 2 }]}
              />
            </View>
            <View
              testID="player/thumb"
              style={[
                styles.thumb,
                {
                  left: `${thumbAt * 100}%`,
                  width: thumb,
                  height: thumb,
                  borderRadius: thumb / 2,
                  marginLeft: -thumb / 2,
                  marginTop: -thumb / 2,
                },
              ]}
            />
          </View>
        );
      }}
    </FocusableSurface>
  );
}

type PlayPauseProps = {
  paused: boolean;
  onPress: () => void;
  onFocus: () => void;
  ref?: Ref<HostView>;
};

/** DESIGN.md PlayerControl: round, `overlay-badge`; focused: inverted plus ring. */
function PlayPauseControl({ paused, onPress, onFocus, ref }: PlayPauseProps) {
  return (
    <FocusableSurface
      ref={ref}
      testID={PLAYER_PLAYPAUSE_ID}
      radius={CONTROL.radius}
      scaleFocus={focus['scale-button']}
      accessibilityRole="button"
      accessibilityLabel={paused ? t('player.play') : t('player.pause')}
      onPress={onPress}
      onFocus={onFocus}
      surfaceStyle={({ focused }: SurfaceState) => [
        styles.control,
        { backgroundColor: focused ? CONTROL.bgFocus : CONTROL.bg },
      ]}
    >
      {({ focused }: SurfaceState) => {
        const ink = focused ? CONTROL.iconFocus : colors.text;
        return paused ? (
          <View testID={`${PLAYER_PLAYPAUSE_ID}/play`} style={[styles.playGlyph, { borderLeftColor: ink }]} />
        ) : (
          <View testID={`${PLAYER_PLAYPAUSE_ID}/pause`} style={styles.pauseGlyph}>
            <View style={[styles.pauseBar, { backgroundColor: ink }]} />
            <View style={[styles.pauseBar, { backgroundColor: ink }]} />
          </View>
        );
      }}
    </FocusableSurface>
  );
}

type IconControlProps = {
  testID: string;
  label: string;
  /** The icon, drawn in the control's ink (inverted when focused). */
  icon: 'back10' | 'forward10' | 'settings';
  onPress: () => void;
  onFocus: () => void;
  ref?: Ref<HostView>;
};

/**
 * A round PlayerControl with an SVG icon (Story 4.3, ADR 0013): a circular
 * arrow with «10» for ±10 s, a gear for «Настройки». Same tokens and states
 * as play/pause: `overlay-badge`; focused inverted plus ring.
 */
function IconControl({ testID, label, icon, onPress, onFocus, ref }: IconControlProps) {
  return (
    <FocusableSurface
      ref={ref}
      testID={testID}
      radius={CONTROL.radius}
      scaleFocus={focus['scale-button']}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={onFocus}
      surfaceStyle={({ focused }: SurfaceState) => [
        styles.control,
        { backgroundColor: focused ? CONTROL.bgFocus : CONTROL.bg },
      ]}
    >
      {({ focused }: SurfaceState) => {
        const ink = focused ? CONTROL.iconFocus : colors.text;
        return icon === 'settings' ? (
          <GearIcon testID={`${testID}/icon`} color={ink} />
        ) : (
          <SkipIcon testID={`${testID}/icon`} direction={icon === 'back10' ? -1 : 1} color={ink} />
        );
      }}
    </FocusableSurface>
  );
}

export type PlayerOverlayProps = {
  meta: PlayerMeta;
  paused: boolean;
  positionSec: number;
  durationSec: number;
  seekTargetSec: number | null;
  onTogglePause: () => void;
  onTimelineFocus: () => void;
  onPlayPauseFocus: () => void;
  /** «−10 с» / «+10 с» (Story 4.3 owner decision): OK moves the seek target by 10 s. */
  onSkip: (direction: -1 | 1) => void;
  /** Focus arrived on a control without its own handler (±10 s): its id. */
  onControlFocus: (id: string) => void;
  /** «Настройки» (Story 4.3): opens the settings sheet. */
  onOpenSettings: () => void;
  onSettingsFocus: () => void;
  timelineRef?: Ref<HostView>;
  playPauseRef?: Ref<HostView>;
  /** «Настройки», the sheet's initiator (focus returns here when it closes). */
  settingsRef?: Ref<HostView>;
};

/**
 * DESIGN.md Player overlay. Top band: avatar · author, the post title
 * (`player-title`, ≤ 2 lines), the video title when it differs. Bottom band:
 * the timeline, elapsed / remaining (tabular), then the controls row:
 * «−10 с» · play/pause · «+10 с» centered, the ⚙ «Настройки» at its right
 * end (Story 4.3 owner decision 2026-10-28). Both bands sit on a darkening
 * gradient. Focus: the timeline; ↓ → play/pause; ← → across −10 · play/pause
 * · +10 · ⚙; ↑ → the timeline (all native).
 */
export function PlayerOverlay({
  meta,
  paused,
  positionSec,
  durationSec,
  seekTargetSec,
  onTogglePause,
  onTimelineFocus,
  onPlayPauseFocus,
  onSkip,
  onControlFocus,
  onOpenSettings,
  onSettingsFocus,
  timelineRef,
  playPauseRef,
  settingsRef,
}: PlayerOverlayProps) {
  const showVideoTitle = isDistinctVideoTitle(meta.videoTitle, meta.postTitle);
  return (
    <View testID="player/overlay" style={styles.overlay} pointerEvents="box-none">
      <View testID="player/top" style={[styles.band, styles.top]}>
        <View style={styles.authorRow}>
          <AuthorAvatar
            url={meta.authorAvatarUrl}
            size={components.avatar.player}
            testID="player/avatar"
          />
          <Text variant="body-s" color="text-secondary" numberOfLines={1} style={styles.author}>
            {meta.authorName}
          </Text>
        </View>
        <Text
          testID="player/title"
          variant="player-title"
          numberOfLines={2}
          accessibilityRole="header"
          style={styles.title}
        >
          {meta.postTitle}
        </Text>
        {showVideoTitle ? (
          <Text testID="player/video-title" variant="body-s" color="text-secondary" numberOfLines={1}>
            {meta.videoTitle}
          </Text>
        ) : null}
      </View>
      <View testID="player/bottom" style={[styles.band, styles.bottom]}>
        <Timeline
          ref={timelineRef}
          positionSec={positionSec}
          durationSec={durationSec}
          seekTargetSec={seekTargetSec}
          onPress={onTogglePause}
          onFocus={onTimelineFocus}
        />
        <View style={styles.times}>
          <Text testID="player/elapsed" variant="meta" color="text-secondary" style={styles.tabular}>
            {time(positionSec)}
          </Text>
          {durationSec > 0 ? (
            <Text testID="player/remaining" variant="meta" color="text-secondary" style={styles.tabular}>
              {tf('player.remaining', { remaining: time(Math.max(0, durationSec - positionSec)) })}
            </Text>
          ) : null}
        </View>
        <View testID="player/controls" style={styles.controls}>
          <View testID="player/controls/center" style={styles.controlsCenter}>
            <IconControl
              testID={PLAYER_BACK10_ID}
              label={t('player.back10')}
              icon="back10"
              onPress={() => onSkip(-1)}
              onFocus={() => onControlFocus(PLAYER_BACK10_ID)}
            />
            <PlayPauseControl
              ref={playPauseRef}
              paused={paused}
              onPress={onTogglePause}
              onFocus={onPlayPauseFocus}
            />
            <IconControl
              testID={PLAYER_FORWARD10_ID}
              label={t('player.forward10')}
              icon="forward10"
              onPress={() => onSkip(1)}
              onFocus={() => onControlFocus(PLAYER_FORWARD10_ID)}
            />
          </View>
          <View testID="player/controls/end" style={styles.controlsEnd}>
            <IconControl
              ref={settingsRef}
              testID={PLAYER_SETTINGS_ID}
              label={t('player.settings')}
              icon="settings"
              onPress={onOpenSettings}
              onFocus={onSettingsFocus}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
  },
  band: {
    paddingHorizontal: spacing['safe-x'],
  },
  top: {
    paddingTop: spacing['safe-y'],
    paddingBottom: spacing['12'],
    backgroundImage: `linear-gradient(to bottom, ${BAND_DARK}, transparent)`,
  },
  bottom: {
    paddingTop: spacing['12'],
    paddingBottom: spacing['safe-y'],
    backgroundImage: `linear-gradient(to top, ${BAND_DARK}, transparent)`,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  author: {
    marginLeft: spacing['4'],
    flexShrink: 1,
  },
  title: {
    marginTop: spacing['4'],
    marginBottom: spacing['2'],
  },
  // The timeline's focusable area: room for the thumb and the bubble above.
  timelineHit: {
    paddingTop: spacing['12'],
    paddingBottom: spacing['4'],
    justifyContent: 'center',
  },
  trackBox: {
    height: THUMB_FOCUSED,
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    backgroundColor: colors['text-disabled'],
  },
  fill: {
    height: '100%',
    backgroundColor: TIMELINE.progress,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    backgroundColor: TIMELINE.thumb,
  },
  bubbleAnchor: {
    position: 'absolute',
    bottom: THUMB_FOCUSED + spacing['2'],
    width: BUBBLE_ANCHOR_WIDTH,
  },
  bubble: {
    paddingHorizontal: spacing['4'],
    paddingVertical: spacing['2'],
    borderRadius: CONTROL.radius,
    backgroundColor: TIMELINE.bubble,
    minWidth: 56,
    alignItems: 'center',
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing['2'],
  },
  // Centered under the timeline (owner decision, Story 4.1 device check).
  // The row spans the band: −10 · play/pause · +10 centered, ⚙ at the right
  // end on the same line (so native ← → reaches it from +10).
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing['6'],
  },
  controlsCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing['8'],
  },
  controlsEnd: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  control: {
    width: CONTROL.size,
    height: CONTROL.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 13,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  pauseGlyph: {
    flexDirection: 'row',
    gap: 4,
  },
  pauseBar: {
    width: 4,
    height: 16,
    borderRadius: 1,
  },
});
