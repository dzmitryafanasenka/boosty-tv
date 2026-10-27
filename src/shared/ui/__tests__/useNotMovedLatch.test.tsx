import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { useNotMovedLatch, type NotMovedLatch } from '../PostGrid';

/** A focus-event source like `HomeFocusInfo.onFocusChange`. */
function focusSource() {
  const listeners = new Set<(id: string) => void>();
  return {
    onFocusChange: (listener: (id: string) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (id: string) => {
      for (const listener of [...listeners]) {
        listener(id);
      }
    },
  };
}

let root: Root | null = null;

async function mountLatch(armed: boolean) {
  const source = focusSource();
  let latch!: NotMovedLatch;
  function Probe() {
    latch = useNotMovedLatch(source.onFocusChange, { armed });
    return null;
  }
  root = createRoot();
  await act(async () => {
    root!.render(<Probe />);
  });
  return { latch: () => latch, emit: (id: string) => act(() => source.emit(id)) };
}

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
});

describe('useNotMovedLatch', () => {
  it('unarmed: never follows, and auto() records nothing', async () => {
    const { latch, emit } = await mountLatch(false);
    expect(latch().followHead(null)).toBe(false);
    latch().auto('card/1');
    expect(latch().followHead('card/1')).toBe(false);
    // Events while unarmed are ignored (no move latched).
    await emit('nav/subs');
    latch().arm([]);
    latch().auto('card/1');
    expect(latch().followHead('card/1')).toBe(true);
    expect(latch().followHead(null)).toBe(true);
  });

  it('automatic targets: their events settle older ones; null ignored; a stale target is then a move', async () => {
    const { latch, emit } = await mountLatch(true);
    latch().auto(null);
    latch().auto(undefined);
    latch().auto('nav/home');
    latch().auto('card/1');
    expect(latch().followHead('nav/home')).toBe(true);
    await emit('card/1');
    // nav/home is settled (trimmed): its focus now is a user move.
    expect(latch().followHead('nav/home')).toBe(false);
    expect(latch().followHead('card/1')).toBe(true);
    await emit('nav/home');
    expect(latch().followHead('card/1')).toBe(false);
  });

  it('dedupe: a repeated request moves to the end (request order)', async () => {
    const { latch, emit } = await mountLatch(true);
    latch().auto('card/1');
    latch().auto('nav/home');
    latch().auto('card/1');
    await emit('card/1');
    // nav/home came before the newest card/1 request: settled.
    expect(latch().followHead('nav/home')).toBe(false);
    expect(latch().followHead('card/1')).toBe(true);
  });

  it('a focus event of an element the page did not focus is a move; auto() is then ignored', async () => {
    const { latch, emit } = await mountLatch(true);
    latch().auto('card/1');
    await emit('card/2');
    expect(latch().followHead('card/1')).toBe(false);
    expect(latch().followHead(null)).toBe(false);
    latch().auto('card/3');
    expect(latch().followHead('card/3')).toBe(false);
  });

  it('move() (OK on a card) closes the latch', async () => {
    const { latch } = await mountLatch(true);
    latch().auto('card/1');
    latch().move();
    expect(latch().followHead('card/1')).toBe(false);
  });

  it('re-arm after a move: follows again from the new targets only', async () => {
    const { latch, emit } = await mountLatch(true);
    latch().auto('card/1');
    latch().move();
    latch().arm(['nav/home', null]);
    latch().auto('card/5');
    expect(latch().followHead('nav/home')).toBe(true);
    expect(latch().followHead('card/5')).toBe(true);
    // The move forgot card/1: it is not automatic any more.
    expect(latch().followHead('card/1')).toBe(false);
    await emit('card/5');
    expect(latch().followHead('card/5')).toBe(true);
  });

  it('arm() keeps the still-unsettled targets: a late event of an earlier automatic focus is not a move', async () => {
    const { latch, emit } = await mountLatch(false);
    latch().arm(['nav/home']);
    latch().auto('state/action');
    latch().arm(['nav/home']);
    latch().auto('card/1');
    await emit('state/action');
    expect(latch().followHead('state/action')).toBe(true);
    await emit('card/1');
    expect(latch().followHead('card/1')).toBe(true);
  });

  it('disarm(): never follows until armed again', async () => {
    const { latch } = await mountLatch(true);
    latch().auto('card/1');
    latch().disarm();
    expect(latch().followHead('card/1')).toBe(false);
    expect(latch().followHead(null)).toBe(false);
    latch().arm([]);
    expect(latch().followHead('card/1')).toBe(true);
  });

  it('onFollowHead records the head-follow card as automatic', async () => {
    const { latch, emit } = await mountLatch(true);
    latch().onFollowHead('card/new');
    await emit('card/new');
    expect(latch().followHead('card/new')).toBe(true);
  });
});
