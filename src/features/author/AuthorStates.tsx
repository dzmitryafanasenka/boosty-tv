import { StyleSheet, View } from 'react-native';
import type { AppErrorKind } from '../../shared/api';
import { t } from '../../shared/i18n';
import {
  POST_GRID_CARD_WIDTH,
  POST_GRID_COLUMNS,
  PostCardSkeleton,
  StateView,
  spacing,
  type HostView,
} from '../../shared/ui';
import type { AuthorPhase } from './AuthorScreen';
import { AUTHOR_STATE_ACTION_ID } from './authorIds';

const SKELETON_ROWS = 2;

/** The StateView action's ref and zone focus handler (one action per state). */
type StateActionProps = {
  stateActionRef: (view: HostView | null) => void;
  onStateActionFocus: () => void;
};

export type AuthorPageStateProps = StateActionProps & {
  /** E3 answered `blog_not_found` (404): «Автор недоступен» + «Назад». */
  unavailable: boolean;
  /** The E3 error kind (not unavailable); null: none. */
  error: AppErrorKind | null;
  /** E3 is fetching (the «Повторить» busy state). */
  isFetching: boolean;
  onBack: () => void;
  onRetryAll: () => void;
};

/** The full-page StateView when E3 fails (in the page root, instead of the header and the grid). */
export function AuthorPageState({
  unavailable,
  error,
  isFetching,
  onBack,
  onRetryAll,
  stateActionRef,
  onStateActionFocus,
}: AuthorPageStateProps) {
  return (
    <View testID={unavailable ? 'author/unavailable' : 'author/error'} style={styles.state}>
      <StateView
        title={unavailable ? t('author.unavailableTitle') : t('author.errorTitle')}
        body={unavailable ? t('author.unavailableBody') : t(`error.${error ?? 'Client'}`)}
        action={{
          label: unavailable ? t('common.back') : t('common.retry'),
          onPress: unavailable ? onBack : onRetryAll,
          busy: unavailable ? false : isFetching,
          testID: AUTHOR_STATE_ACTION_ID,
          ref: stateActionRef,
          onFocus: onStateActionFocus,
        }}
        style={styles.withAction}
      />
    </View>
  );
}

export type AuthorListStateProps = StateActionProps & {
  /** The grid area's phase; the grid itself renders nothing here. */
  phase: Exclude<AuthorPhase, 'unavailable' | 'error'>;
  /** A search query is active (the copy is the search's). */
  searching: boolean;
  /** The effective Filter is not the default («Сбросить фильтры» in the empty view). */
  filtered: boolean;
  /** The shown list's page-1 error kind; null: none. */
  firstPageError: AppErrorKind | null;
  /** The shown list is fetching (the «Повторить» busy state). */
  isFetching: boolean;
  onRetryList: () => void;
  onResetFilters: () => void;
};

/** The grid area's skeleton, page-1 error and empty views (posts or search results). */
export function AuthorListState({
  phase,
  searching,
  filtered,
  firstPageError,
  isFetching,
  onRetryList,
  onResetFilters,
  stateActionRef,
  onStateActionFocus,
}: AuthorListStateProps) {
  const emptyTestID = searching ? 'author/search-empty' : filtered ? 'author/filtered-empty' : 'author/empty';
  const emptyBody = searching
    ? t(filtered ? 'author.search.filteredEmptyBody' : 'author.search.emptyBody')
    : filtered
      ? t('author.search.filteredPostsEmptyBody')
      : t('author.emptyBody');
  return (
    <>
      {phase === 'loading' ? (
        <View
          testID="author/skeleton"
          style={styles.skeleton}
          accessible
          accessibilityLabel={searching ? t('author.search.loading') : t('author.loadingPosts')}
        >
          {Array.from({ length: SKELETON_ROWS }, (_, row) => (
            <View key={row} style={styles.skeletonRow}>
              {Array.from({ length: POST_GRID_COLUMNS }, (__, column) => (
                <PostCardSkeleton
                  key={column}
                  width={POST_GRID_CARD_WIDTH}
                  style={column > 0 ? styles.columnGap : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {phase === 'postsError' && firstPageError !== null ? (
        <View testID={searching ? 'author/search-error' : 'author/posts-error'} style={styles.state}>
          <StateView
            title={searching ? t('author.search.errorTitle') : t('author.postsErrorTitle')}
            body={t(`error.${firstPageError}`)}
            action={{
              label: t('common.retry'),
              onPress: onRetryList,
              busy: isFetching,
              testID: AUTHOR_STATE_ACTION_ID,
              ref: stateActionRef,
              onFocus: onStateActionFocus,
            }}
            style={styles.withAction}
          />
        </View>
      ) : null}
      {phase === 'empty' ? (
        <View testID={emptyTestID} style={styles.state}>
          <StateView
            title={searching || filtered ? t('author.search.emptyTitle') : t('author.emptyTitle')}
            body={emptyBody}
            action={
              filtered
                ? {
                    label: t('author.search.resetFilters'),
                    onPress: onResetFilters,
                    testID: AUTHOR_STATE_ACTION_ID,
                    ref: stateActionRef,
                    onFocus: onStateActionFocus,
                  }
                : undefined
            }
            style={styles.withAction}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    marginTop: spacing['8'],
    paddingHorizontal: spacing['focus-headroom'],
  },
  skeletonRow: {
    flexDirection: 'row',
    marginBottom: spacing['card-gap-y'],
  },
  columnGap: {
    marginLeft: spacing['card-gap-x'],
  },
  state: {
    flex: 1,
    justifyContent: 'center',
  },
  // Focus headroom: the scaled button and its ring stay inside the content.
  withAction: {
    paddingHorizontal: spacing['focus-headroom'],
  },
});
