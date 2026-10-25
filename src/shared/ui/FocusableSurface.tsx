import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type BlurEvent,
  type FocusEvent,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { toEasing } from './motion';
import { colors, focus, motion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

export type SurfaceState = {
  focused: boolean;
  pressed: boolean;
  disabled: boolean;
};

export type FocusableSurfaceProps = Omit<
  PressableProps,
  'style' | 'children' | 'focusable' | 'disabled'
> & {
  /** Corner radius of the surface; the ring follows it at the ring offset. */
  radius: number;
  /** Component focus scale from DESIGN.md (`focus.scale-*`). */
  scaleFocus: number;
  disabled?: boolean;
  /** Outer layout style (margins, alignment). Never scaled. */
  style?: StyleProp<ViewStyle>;
  /** Surface style per state: size, padding, background (the focus lift). */
  surfaceStyle?: (state: SurfaceState) => StyleProp<ViewStyle>;
  children?: ReactNode | ((state: SurfaceState) => ReactNode);
};

const RING_WIDTH = focus['ring-width'];
const RING_INSET = -(focus['ring-offset'] + focus['ring-width']);

/**
 * The focus primitive every focusable component is built on (DESIGN.md ›
 * Components). Focused: ring + the caller's surface lift + scale. Pressed:
 * `focus.pressed-scale`. Disabled: not focusable, no ring.
 *
 * The outer Pressable keeps its layout size; only the inner view is scaled
 * (a transform), so neighbors never move. The ring is an absolutely
 * positioned sibling inside the scaled view, so it scales with the surface.
 * No shadow: DESIGN.md allows it on cards only (they add it themselves).
 */
export function FocusableSurface({
  radius,
  scaleFocus,
  disabled = false,
  style,
  surfaceStyle,
  children,
  testID,
  onFocus,
  onBlur,
  onPressIn,
  onPressOut,
  ...pressableProps
}: FocusableSurfaceProps) {
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const wasPressed = useRef(false);

  const state: SurfaceState = {
    focused: focused && !disabled,
    pressed: pressed && !disabled,
    disabled,
  };
  const target = state.pressed
    ? focus['pressed-scale']
    : state.focused
      ? scaleFocus
      : 1;

  useEffect(() => {
    const token = state.pressed || wasPressed.current ? motion.press : motion.focus;
    wasPressed.current = state.pressed;
    if (reducedMotion) {
      scale.stopAnimation();
      scale.setValue(target);
      return;
    }
    const animation = Animated.timing(scale, {
      toValue: target,
      duration: token.duration,
      easing: toEasing(token.easing),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [scale, target, reducedMotion, state.pressed]);

  return (
    <Pressable
      {...pressableProps}
      testID={testID}
      disabled={disabled}
      focusable={!disabled}
      style={style}
      onFocus={(event: FocusEvent) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event: BlurEvent) => {
        setFocused(false);
        setPressed(false);
        onBlur?.(event);
      }}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(event);
      }}
    >
      <Animated.View
        testID={testID ? `${testID}/scale` : undefined}
        style={{ transform: [{ scale }] }}
      >
        <View style={[{ borderRadius: radius }, surfaceStyle?.(state)]}>
          {typeof children === 'function' ? children(state) : children}
        </View>
        {state.focused ? (
          <View
            testID={testID ? `${testID}/ring` : undefined}
            pointerEvents="none"
            style={[
              styles.ring,
              { borderRadius: radius - RING_INSET },
            ]}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    top: RING_INSET,
    right: RING_INSET,
    bottom: RING_INSET,
    left: RING_INSET,
    borderWidth: RING_WIDTH,
    borderColor: colors['focus-ring'],
  },
});
