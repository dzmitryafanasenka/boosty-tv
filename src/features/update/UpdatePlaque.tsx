import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { tf } from '../../shared/i18n';
import { Text, components, spacing } from '../../shared/ui';
import { useUpdateSnapshot, type UpdateStore } from './updateStore';

/** How long the plaque stays (Story 9.2: about 10 s). */
export const UPDATE_PLAQUE_MS = 10_000;

export type UpdatePlaqueHostProps = {
  store: UpdateStore;
  /** The Player is on top: no plaque (one that arrives now is dropped, not deferred). */
  suppressed: boolean;
};

/**
 * The passive update plaque (Story 9.2, FR-56): «Доступна версия X.Y.Z ·
 * Настройки → Версия», bottom-right inside the safe area, for
 * `UPDATE_PLAQUE_MS`. Shown when an automatic check found a newer release.
 * Like the «ДЕМО» badge it is not focusable, takes no touches and is hidden
 * from accessibility (TalkBack users get the same news from the «Версия»
 * row's label), so the D-pad behaves as if it were absent. Never while the
 * Player is on top.
 */
export function UpdatePlaqueHost({ store, suppressed }: UpdatePlaqueHostProps) {
  const { plaque } = useUpdateSnapshot(store);
  const visible = plaque !== null && !suppressed;
  useEffect(() => {
    if (plaque === null) {
      return undefined;
    }
    if (suppressed) {
      store.hidePlaque();
      return undefined;
    }
    const timer = setTimeout(() => store.hidePlaque(), UPDATE_PLAQUE_MS);
    return () => clearTimeout(timer);
  }, [plaque, suppressed, store]);
  if (!visible) {
    return null;
  }
  return (
    <View
      testID="update/plaque"
      style={styles.plaque}
      pointerEvents="none"
      focusable={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="body-s">
        {tf('update.plaque', { version: plaque.version })}
      </Text>
    </View>
  );
}

const BADGE = components.badge;

const styles = StyleSheet.create({
  plaque: {
    position: 'absolute',
    bottom: spacing['safe-y'],
    right: spacing['safe-x'],
    borderRadius: components.dialog.radius,
    backgroundColor: BADGE.bg,
    paddingHorizontal: spacing['8'],
    paddingVertical: spacing['5'],
  },
});
