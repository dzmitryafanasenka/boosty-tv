import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { toEasing } from './motion';
import { colors, motion, rounded } from './tokens';

const SIZE = 16;

/** Indeterminate spinner, one turn per `motion.spinner`. */
export function Spinner({
  color = colors.text,
  testID,
}: {
  /** Color value (a token value from ./tokens). */
  color?: string;
  testID?: string;
}) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: motion.spinner.duration,
        easing: toEasing(motion.spinner.easing),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);

  const rotate = turn.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.spinner,
        { borderColor: color, transform: [{ rotate }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  spinner: {
    width: SIZE,
    height: SIZE,
    borderRadius: rounded.full,
    borderWidth: 2,
    borderTopColor: 'transparent',
  },
});
