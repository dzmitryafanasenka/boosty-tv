import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { pollBarPercent, type PollOption } from '../../shared/entities/poll';
import { t } from '../../shared/i18n';
import { CheckIcon, Text, useReducedMotion } from '../../shared/ui';
import { optionText, resultText } from './pollLabels';
import { CHECK_SIZE, OPTION, PENDING_PULSE_MIN, PENDING_PULSE_MS, pollStyles as styles } from './pollStyles';
import type { PollMutation } from './usePollVote';

/**
 * One result row, not focusable (Story 6.5 display; Story 6.7 a voted
 * multiple-choice poll): the result bar, the accent check on a chosen
 * option, the text and «48 % · 1 210».
 */
export function ResultRow({
  blockId,
  option,
  index,
  chosen,
}: {
  blockId: string;
  option: PollOption;
  index: number;
  chosen: boolean;
}) {
  return (
    <View testID={`${blockId}/option/${option.id}`} focusable={false} accessible={false} style={styles.option}>
      <View
        testID={`${blockId}/option/${option.id}/bar`}
        style={[styles.bar, { width: `${pollBarPercent(option.fraction)}%` }]}
      />
      <View style={styles.optionContent}>
        {chosen ? (
          <View style={styles.check}>
            <CheckIcon testID={`${blockId}/option/${option.id}/chosen`} color={OPTION.chosenMark} size={CHECK_SIZE} />
          </View>
        ) : null}
        <Text variant="body" numberOfLines={2} style={styles.optionText}>
          {optionText(option, index)}
        </Text>
        <Text variant="body" color={chosen ? 'accent-text' : 'text-secondary'} style={styles.percent}>
          {resultText(option)}
        </Text>
      </View>
    </View>
  );
}

/** The pending option's accent outline, pulsing (steady with reduced motion). */
export function PendingOutline({ testID, radius = OPTION.radius }: { testID: string; radius?: number }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const half = PENDING_PULSE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PENDING_PULSE_MIN, duration: half, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View testID={testID} pointerEvents="none" style={[styles.outline, { borderRadius: radius, opacity }]} />;
}

/**
 * A vote's or retract's failure under the poll (Stories 6.6, 6.7), announced:
 * focus stays on the option or the control, so nothing else would be spoken.
 */
export function PollError({ blockId, error }: { blockId: string; error: PollMutation }) {
  return (
    <Text
      testID={`${blockId}/error`}
      variant="body-s"
      color="error-text"
      accessibilityLiveRegion="polite"
      style={styles.error}
    >
      {t(error === 'vote' ? 'poll.voteFailed' : 'poll.retractFailed')}
    </Text>
  );
}
