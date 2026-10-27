import {
  useEffect,
  useRef,
  type ComponentRef,
  type ReactNode,
  type Ref,
} from 'react';
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
import { useItemState } from './useItemState';
import { useReducedMotion } from './useReducedMotion';

/** Instance of a host `View` (has `requestTVFocus()` on TV). */
export type HostView = ComponentRef<typeof View>;

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
  /**
   * Surface style per state: size, padding, background (the focus lift). It
   * is the same native view as the scale and holds the ring, so it must not
   * set `overflow` (clips the ring) or `opacity` (dims the ring);
   * `__tests__/surfaceRules.test.tsx` checks the consumers.
   */
  surfaceStyle?: (state: SurfaceState) => StyleProp<ViewStyle>;
  children?: ReactNode | ((state: SurfaceState) => ReactNode);
  /** The focusable host view (for `requestTVFocus()` and focus guides). */
  ref?: Ref<HostView>;
  /**
   * The item this surface shows, in a recycling list: when it changes, the
   * focus and pressed state and the scale start over, so they never leak
   * to the next item (ADR 0011). Absent: plain state (buttons, rows).
   */
  resetKey?: string;
  /**
   * Draw the focus ring (default). False only for components whose DESIGN.md
   * focused state is drawn by their own surface style instead (ParagraphStop:
   * a `surface` background and an accent bar, no scale).
   */
  ring?: boolean;
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
  ref,
  resetKey,
  ring = true,
  ...pressableProps
}: FocusableSurfaceProps) {
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useItemState(false, resetKey);
  const [pressed, setPressed] = useItemState(false, resetKey);
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

  // A recycled item: no animation from the previous item's scale.
  const shownKey = useRef(resetKey);
  if (shownKey.current !== resetKey) {
    shownKey.current = resetKey;
    scale.stopAnimation();
    scale.setValue(target);
  }

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

  const surfaceStyles = surfaceStyle?.(state);
  const border = StyleSheet.flatten(surfaceStyles)?.borderWidth ?? 0;
  /** Inset from the padding box: the ring stays `RING_INSET` off the outer edge. */
  const ringInset = RING_INSET - border;

  return (
    <Pressable
      {...pressableProps}
      ref={ref}
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
      {/*
        One native view for the scale and the surface (Story 3.1 device
        profiling: every card's native view count is mount time). The ring
        is its absolutely positioned child: it scales with the surface, and
        its inset adds the surface's own border, so the gap stays the same.
        Surface styles must not clip (`overflow: 'hidden'`) or the ring is cut.
      */}
      <Animated.View
        testID={testID ? `${testID}/scale` : undefined}
        style={[{ borderRadius: radius }, surfaceStyles, { transform: [{ scale }] }]}
      >
        {typeof children === 'function' ? children(state) : children}
        {state.focused && ring ? (
          <View
            testID={testID ? `${testID}/ring` : undefined}
            pointerEvents="none"
            style={[
              styles.ring,
              {
                top: ringInset,
                right: ringInset,
                bottom: ringInset,
                left: ringInset,
                // The ring is placed in the surface's padding box (inside its
                // border, whose inner radius is `radius - border`).
                borderRadius: radius - border - ringInset,
              },
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
    borderWidth: RING_WIDTH,
    borderColor: colors['focus-ring'],
  },
});
