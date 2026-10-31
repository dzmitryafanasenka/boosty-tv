import { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { OUTCOME_FRAME_TRIES, useOutcomeFocus, type OutcomeFocus } from '../useOutcomeFocus';
// eslint-disable-next-line boundaries/dependencies -- test-only helpers
import { frame, installFrameQueue, queuedFrames } from '../../../test/frames';

type Phase = 'hint' | 'loading' | 'empty' | 'results';

const KEY_A: QueryKey = ['search', 'a'];
const KEY_B: QueryKey = ['search', 'b'];

let client: QueryClient;
let outcomes: Phase[];
let api: OutcomeFocus;
let mayTake: boolean;

type ProbeProps = {
  phase: Phase;
  isFetching?: boolean;
  shownKey?: QueryKey;
  drop?: boolean;
  wait?: Phase[];
};
const SEARCH_WAIT: Phase[] = ['loading', 'hint'];
function Probe({ phase, isFetching = false, shownKey = KEY_A, drop = false, wait = SEARCH_WAIT }: ProbeProps) {
  api = useOutcomeFocus<Phase>({
    client,
    phase,
    isFetching,
    shownKey,
    mayTakeFocus: () => mayTake,
    waitPhases: wait,
    dropPhases: drop ? ['hint'] : undefined,
    onOutcome: settled => outcomes.push(settled),
  });
  return null;
}

let root: ReturnType<typeof createRoot>;
async function render(props: ProbeProps) {
  await act(async () => {
    root.render(<Probe {...props} />);
  });
}

beforeEach(() => {
  installFrameQueue();
  client = new QueryClient();
  outcomes = [];
  mayTake = true;
  root = createRoot();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  jest.restoreAllMocks();
});

describe('useOutcomeFocus', () => {
  it('takes no focus while the phase waits, then settles on the next phase', async () => {
    await render({ phase: 'loading', isFetching: true });
    api.awaitOutcome(KEY_A);
    frame();
    expect(api.resolve()).toBe(false);
    expect(outcomes).toEqual([]);
    await render({ phase: 'results' });
    expect(api.resolve()).toBe(true);
    expect(outcomes).toEqual(['results']);
    // Settled once: nothing pending any more.
    expect(api.resolve()).toBe(false);
    expect(outcomes).toEqual(['results']);
  });

  it('settles when the fetch cycle ends with the phase unchanged', async () => {
    await render({ phase: 'empty' });
    api.awaitOutcome(KEY_A);
    await render({ phase: 'empty', isFetching: true });
    expect(outcomes).toEqual([]);
    await render({ phase: 'empty', isFetching: false });
    expect(outcomes).toEqual(['empty']);
    frame();
    expect(outcomes).toEqual(['empty']);
  });

  it('a cached key with no fetch settles on a later frame, once the render shows it', async () => {
    await render({ phase: 'results', shownKey: KEY_A });
    api.awaitOutcome(KEY_B);
    // The render has not reached KEY_B yet: keep looking.
    frame();
    expect(outcomes).toEqual([]);
    await render({ phase: 'results', shownKey: KEY_B });
    frame();
    expect(outcomes).toEqual(['results']);
  });

  it(`gives up after ${OUTCOME_FRAME_TRIES} frames`, async () => {
    await render({ phase: 'results', isFetching: true });
    api.awaitOutcome(KEY_A);
    for (let i = 0; i < OUTCOME_FRAME_TRIES; i += 1) {
      expect(queuedFrames()).toBe(1);
      frame();
    }
    expect(queuedFrames()).toBe(0);
    expect(outcomes).toEqual([]);
    // Still pending: a phase change settles it.
    await render({ phase: 'empty', isFetching: true });
    expect(api.resolve()).toBe(true);
    expect(outcomes).toEqual(['empty']);
  });

  it('settles without focus when mayTakeFocus is false', async () => {
    await render({ phase: 'results' });
    mayTake = false;
    api.awaitOutcome(KEY_A);
    expect(api.resolve()).toBe(true);
    expect(outcomes).toEqual([]);
    expect(api.resolve()).toBe(false);
    frame();
    expect(outcomes).toEqual([]);
  });

  it('a drop phase clears the pending outcome', async () => {
    await render({ phase: 'results', isFetching: true, drop: true });
    api.awaitOutcome(KEY_A);
    await render({ phase: 'hint', drop: true });
    expect(api.resolve()).toBe(false);
    await render({ phase: 'results', drop: true });
    expect(api.resolve()).toBe(false);
    frame();
    expect(outcomes).toEqual([]);
  });

  it('cancel() clears the pending outcome', async () => {
    await render({ phase: 'results' });
    api.awaitOutcome(KEY_A);
    api.cancel();
    frame();
    expect(api.resolve()).toBe(false);
    expect(outcomes).toEqual([]);
  });

  it("Author's config (only loading waits, no drop phases): the hint phase settles", async () => {
    const wait: Phase[] = ['loading'];
    await render({ phase: 'loading', isFetching: true, wait });
    api.awaitOutcome(KEY_A);
    expect(api.resolve()).toBe(false);
    await render({ phase: 'hint', isFetching: true, wait });
    expect(api.resolve()).toBe(true);
    expect(outcomes).toEqual(['hint']);
  });

  it('a second awaitOutcome cancels the first call\'s frame loop', async () => {
    await render({ phase: 'results', isFetching: true });
    api.awaitOutcome(KEY_A);
    frame();
    expect(queuedFrames()).toBe(1);
    api.awaitOutcome(KEY_B);
    // Only the second loop is scheduled.
    expect(queuedFrames()).toBe(1);
    for (let i = 0; i < OUTCOME_FRAME_TRIES - 1; i += 1) {
      frame();
    }
    // The first loop would have stopped by now; the second still runs.
    expect(queuedFrames()).toBe(1);
    frame();
    expect(queuedFrames()).toBe(0);
    expect(outcomes).toEqual([]);
  });

  it('cancel() also cancels a scheduled frame', async () => {
    await render({ phase: 'results', isFetching: true });
    api.awaitOutcome(KEY_A);
    expect(queuedFrames()).toBe(1);
    api.cancel();
    expect(queuedFrames()).toBe(0);
  });

  it('unmount cancels the frame', async () => {
    await render({ phase: 'results', isFetching: true });
    api.awaitOutcome(KEY_A);
    expect(queuedFrames()).toBe(1);
    await act(async () => {
      root.unmount();
    });
    expect(queuedFrames()).toBe(0);
    root = createRoot();
  });
});
