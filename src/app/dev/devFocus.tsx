/**
 * Debug-only «Проверка фокуса» (Story 2.4). App.tsx requires this module
 * only under `__DEV__`, so Metro drops it from the release bundle
 * (`__tests__/releaseBundle.test.js` greps the `--dev false` bundle).
 *
 * Device proof of the shared focus primitives: a 300-card virtualized list
 * restored by id after push/pop (FocusRestoration), the fallback chain after
 * the focused card is deleted, and a test dialog through the modal host.
 */
import { useFocusEffect } from '@react-navigation/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { Screen, useFocusRestoration, useModal } from '../../shared/focus';
import { t, tf } from '../../shared/i18n';
import {
  Button,
  FocusableSurface,
  Text,
  colors,
  components,
  focus,
  requestHostFocus,
  spacing,
  typography,
  type HostView,
} from '../../shared/ui';
import type { RootStackParamList } from '../routes';

const CARD_COUNT = 300;
const CARD_HEIGHT = 40;
const CARD_GAP = spacing['4'];
const ROW = CARD_HEIGHT + CARD_GAP;
const LIST_WIDTH = 360;
/**
 * The list's top in the screen: safe-y + title-s line + actions margin and
 * small-button height + list margin, minus the focus headroom.
 */
const LIST_TOP =
  spacing['safe-y'] +
  typography['title-s'].lineHeight +
  spacing['8'] +
  components['button-small'].height +
  spacing['8'] -
  spacing['focus-headroom'];

const ALL_IDS = Array.from(
  { length: CARD_COUNT },
  (_, i) => `dev/list/${i + 1}`,
);

/** The card number shown in its label. */
function cardNumber(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** In-memory list data shared by the list and the detail screen. */
function createDevListStore() {
  let ids: readonly string[] = ALL_IDS;
  const listeners = new Set<() => void>();
  const set = (next: readonly string[]) => {
    ids = next;
    listeners.forEach(listener => listener());
  };
  return {
    get: () => ids,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    remove: (id: string) => set(ids.filter(other => other !== id)),
    clear: () => set([]),
    refill: () => set(ALL_IDS),
  };
}

export const devListStore = createDevListStore();

function useDevIds() {
  return useSyncExternalStore(devListStore.subscribe, devListStore.get);
}

export type DevFocusScreenProps = {
  routeKey: string;
  onOpenCard: (id: string) => void;
};

/** The list: an action row above a FlatList of 300 cards `dev/list/<n>`. */
export function DevFocusScreen({ routeKey, onOpenCard }: DevFocusScreenProps) {
  const ids = useDevIds();
  const windowHeight = useWindowDimensions().height;
  const listRef = useRef<FlatList<string>>(null);
  const dialogRef = useRef<HostView>(null);
  const modal = useModal();

  const focusAbove = useCallback(() => requestHostFocus(dialogRef.current), []);
  const restoration = useFocusRestoration({
    routeKey,
    ids,
    listRef,
    focusAbove,
  });

  useFocusEffect(
    useCallback(() => {
      const result = restoration.restore();
      if (result.kind === 'none') {
        // Initial focus: the first card, or the action above when empty.
        restoration.focusInitial();
      }
      // Blur (a push or a pop away): stop a pending restore focus.
      return restoration.cancel;
    }, [restoration]),
  );

  const openDialog = useCallback(() => {
    modal.open(<DevDialog onClose={modal.close} />, dialogRef);
  }, [modal]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<string>) => (
      <FocusableSurface
        ref={restoration.itemRef(item)}
        testID={item}
        radius={components['setting-row'].radius}
        scaleFocus={focus['scale-row']}
        accessibilityRole="button"
        accessibilityLabel={tf('dev.focusCheck.card', { n: cardNumber(item) })}
        onFocus={() => restoration.onItemFocus(item, index)}
        onPress={() => onOpenCard(item)}
        style={styles.cardSlot}
        surfaceStyle={({ focused }) => [
          styles.card,
          focused && { backgroundColor: colors['surface-focus-row'] },
        ]}
      >
        <Text variant="body">
          {tf('dev.focusCheck.card', { n: cardNumber(item) })}
        </Text>
      </FocusableSurface>
    ),
    [restoration, onOpenCard],
  );

  return (
    <Screen testID="dev/focus" style={styles.screen}>
      <Text variant="title-s" accessibilityRole="header">
        {t('dev.focusCheck.title')}
      </Text>
      <View style={styles.actions}>
        <Button
          ref={dialogRef}
          testID="dev/action/dialog"
          kind="secondary"
          size="small"
          label={t('dev.focusCheck.openDialog')}
          onPress={openDialog}
        />
        <Button
          testID="dev/action/refill"
          kind="secondary"
          size="small"
          label={t('dev.focusCheck.refill')}
          onPress={devListStore.refill}
          style={styles.actionGap}
        />
      </View>
      {ids.length === 0 ? (
        <Text
          testID="dev/list/empty"
          variant="body"
          color="text-secondary"
          style={styles.empty}
        >
          {t('dev.focusCheck.empty')}
        </Text>
      ) : null}
      <FlatList
        ref={listRef}
        testID="dev/list"
        style={[styles.list, { height: windowHeight - LIST_TOP }]}
        contentContainerStyle={styles.listContent}
        data={ids}
        keyExtractor={item => item}
        renderItem={renderItem}
        getItemLayout={(_data, index) => ({
          length: ROW,
          offset: spacing['focus-headroom'] + ROW * index,
          index,
        })}
        onScroll={restoration.onScroll}
        scrollEventThrottle={100}
        // Clipped subviews are detached, so Android focus search could not
        // reach them; the list stays virtualized by its render window.
        removeClippedSubviews={false}
      />
    </Screen>
  );
}

export type DevFocusDetailScreenProps = { id: string };

/** The pushed detail: delete this card, or all cards, before Back. */
export function DevFocusDetailScreen({ id }: DevFocusDetailScreenProps) {
  const firstRef = useRef<HostView>(null);
  const ids = useDevIds();
  const deleted = !ids.includes(id);

  useFocusEffect(
    useCallback(() => {
      requestHostFocus(firstRef.current);
    }, []),
  );

  return (
    <Screen testID="dev/focus/detail" style={styles.screen}>
      <Text variant="title-s" accessibilityRole="header">
        {tf('dev.focusCheck.detailTitle', { n: cardNumber(id) })}
      </Text>
      <Text variant="body-s" color="text-secondary" style={styles.detailBody}>
        {deleted ? t('dev.focusCheck.deleted') : t('dev.focusCheck.detailBody')}
      </Text>
      <View style={styles.actions}>
        <Button
          ref={firstRef}
          testID="dev/detail/delete"
          kind="secondary"
          label={t('dev.focusCheck.deleteCard')}
          onPress={() => devListStore.remove(id)}
          hasTVPreferredFocus
        />
        <Button
          testID="dev/detail/delete-all"
          kind="secondary"
          label={t('dev.focusCheck.deleteAll')}
          onPress={devListStore.clear}
          style={styles.actionGap}
        />
      </View>
    </Screen>
  );
}

/** The test dialog opened through the modal host. */
function DevDialog({ onClose }: { onClose: () => void }) {
  return (
    <View testID="dev/dialog" style={styles.dialog}>
      <Text variant="title-s" accessibilityRole="header">
        {t('dev.focusCheck.dialogTitle')}
      </Text>
      <Text variant="body-s" color="text-secondary" style={styles.detailBody}>
        {t('dev.focusCheck.dialogBody')}
      </Text>
      <View style={styles.actions}>
        <Button
          testID="dev/dialog/ok"
          label={t('dev.focusCheck.dialogOk')}
          onPress={onClose}
          hasTVPreferredFocus
        />
        <Button
          testID="dev/dialog/close"
          kind="secondary"
          label={t('dev.focusCheck.dialogClose')}
          onPress={onClose}
          style={styles.actionGap}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing['safe-y'],
    paddingHorizontal: spacing['safe-x'],
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing['8'],
  },
  actionGap: {
    marginLeft: spacing['6'],
  },
  // In normal flow with an explicit viewport height (window − LIST_TOP). On
  // the device a flex or absolute `bottom: 0` list on this pushed screen
  // measured 0 high, and a list taller than the screen does not scroll a
  // newly focused card into view.
  list: {
    marginTop: spacing['8'] - spacing['focus-headroom'],
    marginLeft: -spacing['focus-headroom'],
    width: LIST_WIDTH,
  },
  empty: {
    marginTop: spacing['8'],
  },
  listContent: {
    paddingVertical: spacing['focus-headroom'],
    paddingHorizontal: spacing['focus-headroom'],
    paddingBottom: spacing['safe-y'],
  },
  cardSlot: {
    marginBottom: CARD_GAP,
  },
  card: {
    height: CARD_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing['8'],
    backgroundColor: colors.surface,
  },
  detailBody: {
    marginTop: spacing['4'],
  },
  dialog: {
    maxWidth: components.dialog.maxWidth,
    padding: spacing['10'],
    borderRadius: components.dialog.radius,
    backgroundColor: components.dialog.bg,
  },
});

/** Stack route components (App.tsx registers them under `__DEV__` only). */
export function DevFocusRoute({
  navigation,
  route,
}: StackScreenProps<RootStackParamList, 'DevFocus'>) {
  return (
    <DevFocusScreen
      routeKey={route.key}
      onOpenCard={id => navigation.push('DevFocusDetail', { id })}
    />
  );
}

export function DevFocusDetailRoute({
  route,
}: StackScreenProps<RootStackParamList, 'DevFocusDetail'>) {
  return <DevFocusDetailScreen id={route.params.id} />;
}
