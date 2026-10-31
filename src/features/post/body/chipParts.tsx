import type { ReactNode, RefObject } from 'react';
import { StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { FileTargetResult } from '../../../shared/entities/post';
import {
  Spinner,
  Text,
  colors,
  components,
  spacing,
  type HostView,
  type SurfaceState,
} from '../../../shared/ui';

/**
 * Story 6.3: opens the QrDialog in the modal host for `value`, with
 * `initiator` (the chip) getting focus back when it closes.
 */
export type OpenQr = (
  title: string,
  value: string,
  initiator: RefObject<HostView | null>,
) => void;

/** Story 6.3: a file's QR target from a fresh E8 (`useFileTarget`). */
/** `title`: the shown (trimmed) title; an id-less file must still carry it. */
export type ResolveFileTarget = (fileKey: string, title: string) => Promise<FileTargetResult>;

/**
 * Story 6.3 (owner decision 2026-10-29): opens another Boosty post in the
 * app (a Пост pushed on top; Back returns to the chip).
 */
export type OpenPost = (blogUrl: string, postId: string) => void;

/**
 * Story 6.3 (owner decision 2026-10-29, option b): plays a video of this
 * post from `seconds`; `focusId` (the chip) gets focus back after the Player.
 */
export type PlayAt = (mediaId: string, seconds: number, focusId: string) => void;

export const CHIP = components['link-chip'];

/**
 * A full-measure focus guide around chips (Story 6.3, device): Android's
 * focus search weighs the horizontal offset of centers, so ↓ from a wide
 * paragraph preferred the next wide paragraph over a narrow, left-aligned
 * chip right below it (the chip was skipped both ways). The guide spans the
 * column like a paragraph and hands focus to its last focused chip, else
 * the first (`autoFocus`, react-native-tvos).
 */
export function ChipGuide({
  testID,
  children,
}: {
  testID: string;
  children: ReactNode;
}) {
  return (
    <TVFocusGuideView testID={testID} autoFocus style={chipStyles.chipGuide}>
      {children}
    </TVFocusGuideView>
  );
}

/** The chip's visible «QR» suffix (`link-chip` token), or a spinner while busy. */
export function QrSuffix({ busy, testID }: { busy?: boolean; testID: string }) {
  return busy ? (
    <View style={chipStyles.suffix}>
      <Spinner testID={`${testID}/busy`} />
    </View>
  ) : (
    <Text variant="button-s" color="accent-text" style={chipStyles.suffix}>
      {CHIP.suffix}
    </Text>
  );
}

export const chipSurface = ({ focused }: SurfaceState) => [
  chipStyles.chip,
  { backgroundColor: focused ? colors['surface-focus-button'] : CHIP.bg },
];

/** Story 6.3 chips (`link-chip`: 32 dp pill on `surface-raised`). */
export const chipStyles = StyleSheet.create({
  chipGuide: {
    alignSelf: 'stretch',
    maxWidth: spacing['text-measure'],
  },
  chipAlone: {
    alignSelf: 'flex-start',
  },
  chip: {
    height: CHIP.height,
    paddingHorizontal: components['button-small'].paddingX,
    justifyContent: 'center',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipLabel: {
    maxWidth: 420,
  },
  suffix: {
    marginLeft: spacing['4'],
  },
});
