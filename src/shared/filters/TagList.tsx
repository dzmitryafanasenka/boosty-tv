import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import type { HttpClient } from '../api';
import { mergeTags, type Tag } from '../entities/tag';
import { t } from '../i18n';
import { SettingRow, SideSheet, requestHostFocus, spacing, type HostView } from '../ui';
import type { FilterScope } from './filter';
import { filtersStore, useFilter } from './filtersStore';
import { useFeedTags } from './useFeedTags';

/** Focus ids (docs/focus-map.md §1.5, D11). */
export const TAGS_LIST_ID = 'filters/tags/list';
export const TAGS_RESET_ID = 'filters/tags/reset';
export const TAGS_LOAD_MORE_ID = 'filters/tags/load-more';
export const TAGS_RETRY_ID = 'filters/tags/retry';
export const TAGS_LOADING_ID = 'filters/tags/loading';
export const TAGS_EMPTY_ID = 'filters/tags/empty';
/** The list's sizing box (not focusable). */
export const TAGS_BOX_ID = 'filters/tags/box';
export const filterTagId = (tagId: string) => `filters/tag/${tagId}`;

/** Frames a focus request waits for its row to mount (a virtualized cell renders in a later batch). */
const FOCUS_FRAMES = 10;

type Row =
  | { kind: 'reset'; id: string }
  | { kind: 'tag'; id: string; tag: Tag }
  | { kind: 'loading'; id: string }
  | { kind: 'empty'; id: string }
  | { kind: 'retry'; id: string; firstPage: boolean }
  | { kind: 'more'; id: string; busy: boolean };

const FOOTER_IDS = new Set([TAGS_LOADING_ID, TAGS_EMPTY_ID, TAGS_RETRY_ID, TAGS_LOAD_MORE_ID]);

export type TagListProps = {
  scope: FilterScope;
  /** The active session's client (E13). */
  http: HttpClient;
};

/**
 * The tag level of the filter sheet (D11, Story 5.5, FILTER-03): its own
 * SideSheet «Теги» with, in one virtualized column (`FlatList`, stable keys
 * `filters/tag/<id>`): the tag «Сбросить» while a tag is checked (clears
 * the tags only), the tags as check rows (the tags checked when the level
 * opened first, then the loaded E13 pages, deduped by id: reference
 * `FilterTagsComponentImpl`), then one footer row: loading, «Тегов нет»,
 * «Загрузить ещё» while more pages exist (explicit, never on scroll) or
 * «Повторить» after a failed page. OK on a tag toggles it at once (the feed
 * behind refetches) and focus stays on it: the order is fixed while the
 * level is open, so a toggle never moves a row.
 *
 * Focus: the first row on open (the tag «Сбросить» when shown). A focused
 * row that goes away hands focus on: the tag «Сбросить» → the first tag;
 * the loading row or the first-page «Повторить» → the first row;
 * «Загрузить ещё» / «Повторить» of a later page → the other footer row when
 * there is one, else the first new tag. While «Загрузить ещё» keeps focus
 * after a page, the list scrolls to the end so it stays in view. Back is
 * the sheet's (→ the sheet on «Теги»).
 */
export function TagList({ scope, http }: TagListProps) {
  const filter = useFilter(scope);
  const feedTags = useFeedTags(http);
  /** The tags checked when the level opened: listed first, in that order. */
  const opened = useRef(filter.tags);
  const checked = useMemo(() => new Set(filter.tags.map(tag => tag.id)), [filter.tags]);
  const tags = useMemo(
    () => mergeTags(opened.current.map(({ id, title }) => ({ id, title })), feedTags.tags),
    [feedTags.tags],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (filter.tags.length > 0) {
      out.push({ kind: 'reset', id: TAGS_RESET_ID });
    }
    for (const tag of tags) {
      out.push({ kind: 'tag', id: filterTagId(tag.id), tag });
    }
    if (feedTags.firstPageFailed) {
      out.push({ kind: 'retry', id: TAGS_RETRY_ID, firstPage: true });
    } else if (feedTags.isPending) {
      out.push({ kind: 'loading', id: TAGS_LOADING_ID });
    } else if (feedTags.loadMoreFailed) {
      out.push({ kind: 'retry', id: TAGS_RETRY_ID, firstPage: false });
    } else if (feedTags.hasNextPage) {
      out.push({ kind: 'more', id: TAGS_LOAD_MORE_ID, busy: feedTags.isFetchingNextPage });
    } else if (tags.length === 0) {
      out.push({ kind: 'empty', id: TAGS_EMPTY_ID });
    }
    return out;
  }, [
    filter.tags.length,
    tags,
    feedTags.firstPageFailed,
    feedTags.isPending,
    feedTags.loadMoreFailed,
    feedTags.hasNextPage,
    feedTags.isFetchingNextPage,
  ]);

  /** Every row's host view, by focus id (null once unmounted). */
  const views = useRef(new Map<string, HostView | null>());
  const refs = useRef(new Map<string, (view: HostView | null) => void>());
  const rowRef = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (view: HostView | null) => {
        views.current.set(id, view);
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  /** The row this level last focused (a request or a native focus). */
  const focused = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const focusRow = useCallback((id: string) => {
    focused.current = id;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
    }
    let left = FOCUS_FRAMES;
    const attempt = () => {
      frame.current = null;
      const view = views.current.get(id) ?? null;
      if (view !== null) {
        requestHostFocus(view);
      }
      // Repeated once two frames later (a request in the same commit as an
      // unmount can be lost), and until a virtualized row has mounted.
      left -= 1;
      if (left > 0 && (view === null || left === FOCUS_FRAMES - 1)) {
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(attempt);
        });
      }
    };
    attempt();
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  const list = useRef<FlatList<Row>>(null);
  /** The box's measured height (null until its first layout; see the render). */
  const [listHeight, setListHeight] = useState<number | null>(null);
  const previousRows = useRef<Row[] | null>(null);
  const previousTagCount = useRef(0);
  useLayoutEffect(() => {
    const previous = previousRows.current;
    previousRows.current = rows;
    const tagCountBefore = previousTagCount.current;
    previousTagCount.current = tags.length;
    if (previous === null) {
      // Open: the first row (the tag «Сбросить» when shown).
      focusRow(rows[0].id);
      return;
    }
    const current = focused.current;
    const ids = new Set(rows.map(row => row.id));
    if (current === null) {
      return;
    }
    if (ids.has(current)) {
      // «Загрузить ещё» kept focus while a page was appended above it.
      if (current === TAGS_LOAD_MORE_ID && tags.length > tagCountBefore) {
        list.current?.scrollToEnd({ animated: false });
      }
      return;
    }
    const firstTag = rows.find(row => row.kind === 'tag');
    const footer = rows.find(row => FOOTER_IDS.has(row.id));
    const goneFooterOfLaterPage =
      (current === TAGS_LOAD_MORE_ID || current === TAGS_RETRY_ID) &&
      previous.some(row => row.id === current && (row.kind === 'more' || (row.kind === 'retry' && !row.firstPage)));
    if (current === TAGS_RESET_ID) {
      focusRow((firstTag ?? rows[0]).id);
    } else if (goneFooterOfLaterPage) {
      const firstNew = tags[tagCountBefore];
      focusRow(
        footer?.id ??
          (firstNew ? filterTagId(firstNew.id) : (rows[rows.length - 1] ?? rows[0]).id),
      );
    } else {
      focusRow(rows[0].id);
    }
  }, [rows, tags, focusRow]);

  const renderItem: ListRenderItem<Row> = ({ item }) => {
    const common = {
      ref: rowRef(item.id),
      testID: item.id,
      hasTVPreferredFocus: previousRows.current === null && item.id === rows[0].id,
      onFocus: () => {
        focused.current = item.id;
      },
    };
    switch (item.kind) {
      case 'reset':
        return (
          <SettingRow
            {...common}
            kind="nav"
            label={t('filters.tags.reset')}
            onPress={() => filtersStore.getState().clearTags(scope)}
          />
        );
      case 'tag':
        return (
          <SettingRow
            {...common}
            kind="check"
            checked={checked.has(item.tag.id)}
            label={item.tag.title}
            onPress={() => filtersStore.getState().toggleTag(scope, item.tag)}
          />
        );
      case 'loading':
        return <SettingRow {...common} kind="info" label={t('filters.tags.loading')} />;
      case 'empty':
        return <SettingRow {...common} kind="info" label={t('filters.tags.empty')} />;
      case 'retry':
        return (
          <SettingRow
            {...common}
            kind="nav"
            label={t('filters.tags.retry')}
            value={t('filters.tags.error')}
            valueLines={2}
            onPress={item.firstPage ? feedTags.retry : feedTags.fetchNextPage}
          />
        );
      case 'more':
        return (
          <SettingRow
            {...common}
            kind="nav"
            label={item.busy ? t('filters.tags.loadingMore') : t('filters.tags.loadMore')}
            onPress={item.busy ? undefined : feedTags.fetchNextPage}
          />
        );
    }
  };

  return (
    <SideSheet testID={TAGS_LIST_ID} variant="filters" title={t('filters.tags.title')}>
      {/*
        The TV FlatList wraps its ScrollView in an unstyled TVFocusGuideView
        (react-native-tvos VirtualizedList), so `flex: 1` on the list never
        reaches the wrapper and it collapses to ~1 dp (device: Story 5.5).
        This box takes the remaining height and hands it to the list.
      */}
      <View
        testID={TAGS_BOX_ID}
        style={styles.box}
        onLayout={event => setListHeight(event.nativeEvent.layout.height)}
      >
        <FlatList
          ref={list}
          style={[styles.list, listHeight === null ? styles.fill : { height: listHeight }]}
          contentContainerStyle={styles.rows}
          data={rows}
          keyExtractor={row => row.id}
          renderItem={renderItem}
          extraData={checked}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews={false}
        />
      </View>
    </SideSheet>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  list: {
    // Room for the focused row's scale and ring at the column's edges.
    marginHorizontal: -spacing['3'],
  },
  rows: {
    gap: spacing['3'],
    padding: spacing['3'],
  },
});
