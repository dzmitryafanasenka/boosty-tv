import { memo, useCallback, useEffect, useState, type Ref, type RefObject } from 'react';
import { ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { chapterIndexAt, type Chapter } from '../../shared/entities/post';
import { useLatestRef } from '../../shared/focus';
import { tf, t } from '../../shared/i18n';
import { formatDuration } from '../../shared/i18n/format';
import { FocusableSurface, Text, components, focus, spacing, type HostView, type SurfaceState } from '../../shared/ui';

/** Focus ids (docs/focus-map.md §1.5): `player/chapters/<sec>` (a chapter's second is its stable id). */
export const PLAYER_CHAPTERS_ID = 'player/chapters';
export const CHAPTER_ITEM_PREFIX = `${PLAYER_CHAPTERS_ID}/`;
export const chapterItemId = (sec: number) => `${CHAPTER_ITEM_PREFIX}${sec}`;

const STRIP = components['chapter-strip'];

/** The strip's accessibility label for one chapter («3:45. Разбор»; the time alone when the name is the time). */
export function chapterItemLabel(chapter: Chapter): string {
  const time = formatDuration(chapter.sec);
  return chapter.title === time ? time : tf('player.chapters.item', { time, title: chapter.title });
}

type ItemProps = {
  chapter: Chapter;
  current: boolean;
  onSelect: (sec: number) => void;
  onFocus: (id: string) => void;
  ref?: Ref<HostView>;
};

const ChapterItem = memo(function ChapterItemView({ chapter, current, onSelect, onFocus, ref }: ItemProps) {
  const id = chapterItemId(chapter.sec);
  return (
    <FocusableSurface
      ref={ref}
      testID={id}
      radius={STRIP.radius}
      scaleFocus={focus['scale-button']}
      accessibilityRole="button"
      accessibilityLabel={chapterItemLabel(chapter)}
      accessibilityState={{ selected: current }}
      onPress={() => onSelect(chapter.sec)}
      onFocus={() => onFocus(id)}
      surfaceStyle={({ focused }: SurfaceState) => [
        styles.item,
        { backgroundColor: focused ? STRIP.bgFocus : STRIP.bg },
      ]}
    >
      {({ focused }: SurfaceState) => (
        <>
          <Text
            testID={`${id}/time`}
            variant="meta"
            color={focused ? 'bg' : current ? 'accent-text' : 'text-secondary'}
            numberOfLines={1}
            style={styles.tabular}
          >
            {formatDuration(chapter.sec)}
          </Text>
          {/* A name that is the time itself is not shown twice. */}
          {chapter.title !== formatDuration(chapter.sec) ? (
            <Text testID={`${id}/title`} variant="button" color={focused ? 'bg' : 'text'} numberOfLines={1}>
              {chapter.title}
            </Text>
          ) : null}
        </>
      )}
    </FocusableSurface>
  );
});

export type ChapterStripProps = {
  chapters: readonly Chapter[];
  /** The item focused when the strip opens (the current chapter; before the first: the first). */
  initialIndex: number;
  /** The chapter playing now (its time is marked); -1 before the first. */
  currentIndex: number;
  /** The initial item's host view (the player focuses it when the strip opens). */
  initialRef: Ref<HostView>;
  /** OK on an item: seek to that chapter's start (the player closes the strip). */
  onSelect: (sec: number) => void;
  /** Focus arrived on an item (its focus id). */
  onItemFocus: (id: string) => void;
};

/**
 * Story 10.1 (owner decision 2026-11-02, our improvement): the chapter strip
 * above the timeline, opened by ↑ on the focused timeline. A horizontal row
 * of chapters (time, then the name on one line); the focused item is the
 * selection (inverted plus ring), the playing chapter's time is marked.
 * The row sits in one `TVFocusGuideView` trapped on every side: ← → move
 * the selection natively one chapter (and Android's focus scroll keeps it
 * in view; no JS scroll), and stay at the ends; ↑ does nothing; ↓ and Back
 * close the strip (the player's keys). Nothing else in the overlay is
 * focusable behind it in that direction.
 */
export function ChapterStrip({ chapters, initialIndex, currentIndex, initialRef, onSelect, onItemFocus }: ChapterStripProps) {
  return (
    <TVFocusGuideView
      testID={PLAYER_CHAPTERS_ID}
      accessibilityLabel={t('player.chapters.strip')}
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      style={styles.strip}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {chapters.map((chapter, index) => (
          <View key={chapter.sec} style={styles.slot}>
            <ChapterItem
              ref={index === initialIndex ? initialRef : undefined}
              chapter={chapter}
              current={index === currentIndex}
              onSelect={onSelect}
              onFocus={onItemFocus}
            />
          </View>
        ))}
      </ScrollView>
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginBottom: spacing['4'],
  },
  // Room for the focus scale and ring at the row's ends and above/below.
  row: {
    paddingVertical: spacing['4'],
    paddingHorizontal: spacing['2'],
  },
  slot: {
    marginRight: spacing['6'],
  },
  item: {
    width: STRIP.itemWidth,
    paddingHorizontal: spacing['5'],
    paddingVertical: spacing['3'],
    gap: spacing['1'],
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

/** The chapter strip's open state (Story 10.1); the player wires it to its keys, focus and overlay. */
export type ChapterStripState = {
  /** Open and shown: the overlay is up while playing and the video has chapters. */
  open: boolean;
  openRef: RefObject<boolean>;
  /** The item focused on opening (the chapter at the pending target, else the position; the first before it). */
  initialIndex: number;
  /** The playing chapter (the pending target's while seeking); -1 before the first. */
  currentIndex: number;
  /** ↑ on the focused timeline: open on the current chapter. False (nothing opened) without chapters. */
  openStrip: () => boolean;
  closeStrip: () => void;
};

/**
 * The strip is open only while the overlay shows, the player plays and the
 * video has chapters: anything that hides the overlay (Back, background,
 * an error, a recovery) closes it too, so it never comes back by itself.
 */
export function useChapterStrip({
  chapters,
  overlay,
  playing,
  atSec,
}: {
  chapters: readonly Chapter[];
  overlay: boolean;
  playing: boolean;
  /** The pending seek target, else the playback position. */
  atSec: number;
}): ChapterStripState {
  const [initialIndex, setInitialIndex] = useState<number | null>(null);
  const open = initialIndex !== null && overlay && playing && chapters.length > 0;
  const openRef = useLatestRef(open);
  useEffect(() => {
    if (!open && initialIndex !== null) {
      setInitialIndex(null);
    }
  }, [open, initialIndex]);
  const latest = useLatestRef({ chapters, atSec });
  const openStrip = useCallback(() => {
    const { chapters: list, atSec: sec } = latest.current;
    if (list.length === 0) {
      return false;
    }
    setInitialIndex(Math.max(0, chapterIndexAt(list, sec)));
    return true;
  }, [latest]);
  const closeStrip = useCallback(() => setInitialIndex(null), []);
  return {
    open,
    openRef,
    initialIndex: initialIndex ?? 0,
    currentIndex: chapterIndexAt(chapters, atSec),
    openStrip,
    closeStrip,
  };
}
