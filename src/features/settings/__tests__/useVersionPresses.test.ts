import { VERSION_PRESS_COUNT, VERSION_PRESS_GAP_MS, createVersionPressCounter } from '../useVersionPresses';

function counter() {
  let now = 1_000;
  const onGesture = jest.fn();
  const onFirstPress = jest.fn();
  const c = createVersionPressCounter({ onGesture, onFirstPress, now: () => now });
  return {
    onGesture,
    onFirstPress,
    press: (afterMs = 0) => {
      now += afterMs;
      c.press();
    },
  };
}

describe('createVersionPressCounter (Story 8.3)', () => {
  it('seven presses, each < 2 s apart, fire the gesture once', () => {
    const { press, onGesture } = counter();
    for (let i = 0; i < VERSION_PRESS_COUNT - 1; i += 1) {
      press(VERSION_PRESS_GAP_MS - 1);
    }
    expect(onGesture).not.toHaveBeenCalled();
    press(VERSION_PRESS_GAP_MS - 1);
    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('a single press does nothing (no gesture)', () => {
    const { press, onGesture } = counter();
    press();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('a gap of 2 s restarts the count', () => {
    const { press, onGesture } = counter();
    for (let i = 0; i < 6; i += 1) {
      press(100);
    }
    press(VERSION_PRESS_GAP_MS); // a new series: press 1
    expect(onGesture).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i += 1) {
      press(100);
    }
    expect(onGesture).not.toHaveBeenCalled();
    press(100);
    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('after the gesture the count starts over (14 quick presses: two gestures)', () => {
    const { press, onGesture } = counter();
    for (let i = 0; i < VERSION_PRESS_COUNT * 2; i += 1) {
      press(100);
    }
    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('Epic 9 hook: onFirstPress runs once per series, never on presses 2–7', () => {
    const { press, onFirstPress } = counter();
    for (let i = 0; i < VERSION_PRESS_COUNT; i += 1) {
      press(100);
    }
    expect(onFirstPress).toHaveBeenCalledTimes(1);
    press(VERSION_PRESS_GAP_MS);
    expect(onFirstPress).toHaveBeenCalledTimes(2);
  });
});
