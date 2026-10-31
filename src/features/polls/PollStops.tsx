import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { View } from 'react-native';
import { pollBarPercent, type PollOption } from '../../shared/entities/poll';
import { useColumnStop, type StopFocusHandler, type StopViewHandler } from '../../shared/focus';
import { t } from '../../shared/i18n';
import { CheckIcon, FocusableSurface, Spinner, Text, colors, components } from '../../shared/ui';
import { PendingOutline } from './PollParts';
import {
  optionText,
  pollCheckOptionAccessibilityLabel,
  pollOptionAccessibilityLabel,
  resultText,
} from './pollLabels';
import { CHECK_BOX_ICON, CHECK_SIZE, OPTION, pollStyles as styles } from './pollStyles';
import type { PollMutation } from './usePollVote';

/*
 * The poll's focus stops: the single-choice option (Story 6.6), the
 * multiple-choice checkbox option and the action control (Story 6.7). Each
 * is a content zone item reporting its host view by focus id
 * (`useColumnStop`).
 */

type PollOptionStopProps = {
  /** `post/<postId>/poll/option/<optionId>` */
  focusId: string;
  /** The poll's block id (the inner testIDs: `<blockId>/option/<optionId>/…`). */
  blockId: string;
  option: PollOption;
  index: number;
  chosen: boolean;
  /** The pending hint: `vote` or `retract` (the chosen option); null when not pending. */
  pending: PollMutation | null;
  sending: boolean;
  /** The first option's label starts with «Опрос» and the title. */
  labelPrefix: readonly string[] | null;
  /** The last option's label ends with the voters («Проголосовали: N»). */
  labelSuffix: readonly string[] | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onPress: (optionId: string) => void;
  onBlur: (optionId: string) => void;
};

/** DESIGN.md PollOption: default, chosen, pending, sending (Story 6.6). */
export const PollOptionStop = memo(function PollOptionStopView({
  focusId,
  blockId,
  option,
  index,
  chosen,
  pending,
  sending,
  labelPrefix,
  labelSuffix,
  onView,
  onFocus,
  onPress,
  onBlur,
}: PollOptionStopProps) {
  const { ref, handleFocus } = useColumnStop(focusId, onView, onFocus);
  const handlePress = useCallback(() => onPress(option.id), [onPress, option.id]);
  const handleBlur = useCallback(() => onBlur(option.id), [onBlur, option.id]);
  const inner = `${blockId}/option/${option.id}`;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={OPTION.radius}
      // No scale (as the 6.5 stop): the ring marks focus.
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="button"
      accessibilityLabel={pollOptionAccessibilityLabel(option, index, {
        chosen,
        pending,
        sending,
        prefix: labelPrefix ?? [],
        suffix: labelSuffix ?? [],
      })}
      accessibilityState={{ selected: chosen, busy: sending }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      style={styles.optionStop}
      surfaceStyle={() => styles.optionSurface}
    >
      <View testID={inner} style={styles.optionClip}>
        <View testID={`${inner}/bar`} style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]} />
        <View style={styles.optionContent}>
          {chosen ? (
            <View style={styles.check}>
              <CheckIcon testID={`${inner}/chosen`} color={OPTION.chosenMark} size={CHECK_SIZE} />
            </View>
          ) : null}
          <Text variant="body" numberOfLines={2} style={styles.optionText}>
            {optionText(option, index)}
          </Text>
          {sending ? (
            <View style={styles.spinner}>
              <Spinner testID={`${inner}/sending`} color={colors.accent} />
            </View>
          ) : null}
          {pending !== null ? (
            // In the result's place, one line: the option's height never changes (device:
            // a hint on its own line grew the option and clipped it at the column's bottom).
            <Text
              testID={`${inner}/pending`}
              variant="body"
              color="accent-text"
              numberOfLines={1}
              style={styles.percent}
            >
              {t(pending === 'retract' ? 'poll.pendingRetract' : 'poll.pendingVote')}
            </Text>
          ) : (
            <Text variant="body" color={chosen ? 'accent-text' : 'text-secondary'} style={styles.percent}>
              {resultText(option)}
            </Text>
          )}
        </View>
      </View>
      {pending !== null ? <PendingOutline testID={`${inner}/outline`} /> : null}
    </FocusableSurface>
  );
});

type PollCheckOptionProps = {
  /** `post/<postId>/poll/option/<optionId>` */
  focusId: string;
  blockId: string;
  option: PollOption;
  index: number;
  checked: boolean;
  labelPrefix: readonly string[] | null;
  labelSuffix: readonly string[] | null;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onPress: (optionId: string) => void;
};

/**
 * Story 6.7: a multiple-choice option before the vote, a checkbox stop (the
 * 6.6 option stop's padding, ring and no scale). The check box at the left
 * is an empty outline or an accent fill (`poll-option.chosenMark`); it is
 * not the answered state's accent check, which shows only after the vote.
 * OK toggles it (no pending step).
 */
export const PollCheckOption = memo(function PollCheckOptionView({
  focusId,
  blockId,
  option,
  index,
  checked,
  labelPrefix,
  labelSuffix,
  onView,
  onFocus,
  onPress,
}: PollCheckOptionProps) {
  const { ref, handleFocus } = useColumnStop(focusId, onView, onFocus);
  const handlePress = useCallback(() => onPress(option.id), [onPress, option.id]);
  const inner = `${blockId}/option/${option.id}`;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={OPTION.radius}
      scaleFocus={1}
      scalePressed={1}
      accessibilityRole="checkbox"
      accessibilityLabel={pollCheckOptionAccessibilityLabel(option, index, {
        checked,
        prefix: labelPrefix ?? [],
        suffix: labelSuffix ?? [],
      })}
      accessibilityState={{ checked }}
      onFocus={handleFocus}
      onPress={handlePress}
      style={styles.optionStop}
      surfaceStyle={() => styles.optionSurface}
    >
      <View testID={inner} style={styles.optionClip}>
        <View testID={`${inner}/bar`} style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]} />
        <View style={styles.optionContent}>
          <View
            testID={`${inner}/box`}
            style={[styles.checkBox, checked ? styles.checkBoxChecked : null]}
          >
            {checked ? (
              <CheckIcon testID={`${inner}/checked`} color={colors['accent-ink']} size={CHECK_BOX_ICON} />
            ) : null}
          </View>
          <Text variant="body" numberOfLines={2} style={styles.optionText}>
            {optionText(option, index)}
          </Text>
          <Text variant="body" color="text-secondary" style={styles.percent}>
            {resultText(option)}
          </Text>
        </View>
      </View>
    </FocusableSurface>
  );
});

type PollActionStopProps = {
  /** `post/<postId>/poll/submit` or `…/retract` (it may change while focused). */
  focusId: string;
  label: string;
  /** «Проголосовать» (the accent button) vs «Отозвать голос» (secondary). */
  primary: boolean;
  /** Shown dimmed, OK inert, and not focusable unless `keepFocusable`. */
  disabled: boolean;
  /** Story 6.7 hand-off: drawn disabled but still focusable (focus is moving away). */
  keepFocusable?: boolean;
  sending: boolean;
  /** The pending hint shown in the label's place (with the pulsing outline); null when not pending. */
  pendingHint: string | null;
  accessibilityLabel: string;
  onView: StopViewHandler;
  onFocus: StopFocusHandler;
  onPress: () => void;
  /** Native focus arrived (after the zone and `onFocus` are told). */
  onFocusChange?: () => void;
  onBlur?: () => void;
};

/**
 * Story 6.7: «Проголосовать» / «Отозвать голос». The DESIGN.md Button
 * colors (primary / secondary), on the option stop's terms: a ring, no
 * scale, vertical padding so the ring is not cut at the column's bottom.
 * Unlike `Button`, it takes a blur (pending cancel) and draws the pending
 * outline and hint. Its focus id may change while it is focused (a vote
 * turns «Проголосовать» into «Отозвать голос» on the same view): the zone
 * and the screen are then told the new id, and the ref re-registers the
 * view under it (a new ref callback: the old id is dropped first).
 */
export function PollActionStop({
  focusId,
  label,
  primary,
  disabled,
  keepFocusable = false,
  sending,
  pendingHint,
  accessibilityLabel,
  onView,
  onFocus,
  onPress,
  onFocusChange,
  onBlur,
}: PollActionStopProps) {
  const { ref, handleFocus } = useColumnStop(focusId, onView, onFocus);
  const focused = useRef(false);
  // The id changed under focus: track the new one before the screen's
  // refetch fallback (a parent effect) looks for the old one.
  const shownId = useRef(focusId);
  useLayoutEffect(() => {
    if (shownId.current !== focusId) {
      shownId.current = focusId;
      if (focused.current) {
        handleFocus();
      }
    }
  }, [focusId, handleFocus]);
  const onSurfaceFocus = useCallback(() => {
    focused.current = true;
    handleFocus();
    onFocusChange?.();
  }, [handleFocus, onFocusChange]);
  const onSurfaceBlur = useCallback(() => {
    focused.current = false;
    onBlur?.();
  }, [onBlur]);
  const kind = primary ? components['button-primary'] : components['button-secondary'];
  const textColor = disabled ? colors['text-disabled'] : kind.text;
  return (
    <FocusableSurface
      ref={ref}
      testID={focusId}
      radius={kind.radius}
      scaleFocus={1}
      scalePressed={1}
      disabled={disabled && !keepFocusable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: sending }}
      onFocus={onSurfaceFocus}
      onBlur={onSurfaceBlur}
      onPress={disabled ? undefined : onPress}
      style={styles.actionStop}
      surfaceStyle={({ focused: isFocused }) => [
        styles.actionSurface,
        {
          height: kind.height,
          paddingHorizontal: kind.paddingX,
          backgroundColor: disabled ? colors['surface-raised'] : isFocused ? kind.bgFocus : kind.bg,
        },
      ]}
    >
      <View style={styles.actionContent}>
        <Text
          testID={pendingHint !== null ? `${focusId}/pending` : undefined}
          variant="button"
          numberOfLines={1}
          style={{ color: textColor }}
        >
          {pendingHint ?? label}
        </Text>
        {sending ? (
          <View style={styles.spinner}>
            <Spinner testID={`${focusId}/sending`} color={textColor} />
          </View>
        ) : null}
      </View>
      {pendingHint !== null ? <PendingOutline testID={`${focusId}/outline`} radius={kind.radius} /> : null}
    </FocusableSurface>
  );
}
