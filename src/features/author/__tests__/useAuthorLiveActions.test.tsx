import { act } from 'react';
import { createRoot } from 'test-renderer';
import type { ModalApi } from '../../../shared/focus';
import type { HostView, NotMovedLatch } from '../../../shared/ui';
import { requestHostFocus } from '../../../shared/ui/requestHostFocus';
import type { AuthorFocusInfo } from '../useAuthorAutoFocus';
import type { AuthorLiveCard } from '../useAuthorLive';
import { useAuthorLiveActions, type AuthorLiveActions, type AuthorLiveBlock } from '../useAuthorLiveBlock';

jest.mock('../../../shared/ui/requestHostFocus', () => ({ requestHostFocus: jest.fn() }));
const focusMock = requestHostFocus as jest.Mock;

const BLOG = 'demo-blog';
const LIVE = `author/${BLOG}/live`;
const LIKE = `author/${BLOG}/live/like`;
const SHARE = `author/${BLOG}/live/share`;

// A manual frame queue: each `frame()` runs the callbacks requested before it.
let queue: Map<number, (t: number) => void>;
let nextFrameId: number;
function frame() {
  const callbacks = [...queue.values()];
  queue.clear();
  callbacks.forEach(callback => callback(0));
}

const view = (name: string) => ({ name }) as unknown as HostView;
function card(id: string, mounted: boolean): AuthorLiveCard {
  const current = mounted ? view(id) : null;
  return { liveId: id, liveView: current, liveViewRef: { current }, liveHostRef: () => {}, onLiveFocus: () => {} };
}

type Setup = { card?: boolean; like?: boolean; share?: boolean; grid?: boolean; qr?: boolean };

let modal: { open: jest.Mock; close: jest.Mock; isOpen: () => boolean };
let latch: { auto: jest.Mock; move: jest.Mock };
let restoration: { focusInitial: jest.Mock };
let autoFocusLive: jest.Mock;
let takeLiveQrRequest: jest.Mock;
let api: AuthorLiveActions;
let root: ReturnType<typeof createRoot>;

async function render({ card: cardShown = true, like = true, share = true, grid = true, qr = false }: Setup = {}) {
  takeLiveQrRequest = jest.fn(() => qr);
  const block: AuthorLiveBlock = {
    liveId: LIVE,
    likeId: LIKE,
    shareId: SHARE,
    liveActionIds: [LIKE, SHARE],
    liveCard: card(LIVE, cardShown),
    likeButton: card(LIKE, like),
    shareButton: card(SHARE, share),
    liveAnswered: true,
    like: { stream: null, sending: false, error: null, toggle: () => false },
    stream: null,
    likeShown: like,
    liveShown: cardShown,
  };
  const focusRef = {
    current: { isActive: () => true, current: () => null } as unknown as AuthorFocusInfo,
  };
  function Probe() {
    api = useAuthorLiveActions({
      block,
      blogUrl: BLOG,
      focusRef,
      modal: modal as unknown as ModalApi,
      latch: latch as unknown as NotMovedLatch,
      restoration,
      idsRef: { current: ['author/demo-blog/post/1'] },
      gridShown: () => grid,
      autoFocusLive,
      takeLiveQrRequest,
    });
    return null;
  }
  await act(async () => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  focusMock.mockClear();
  queue = new Map();
  nextFrameId = 1;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: (t: number) => void) => {
    const id = nextFrameId++;
    queue.set(id, callback);
    return id;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id?: number | null) => {
    if (id !== undefined && id !== null) {
      queue.delete(id);
    }
  });
  modal = { open: jest.fn(), close: jest.fn(), isOpen: () => false };
  latch = { auto: jest.fn(), move: jest.fn() };
  restoration = { focusInitial: jest.fn() };
  autoFocusLive = jest.fn();
  root = createRoot();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  jest.restoreAllMocks();
});

describe('useAuthorLiveActions.returnFocus', () => {
  test('the QR request is consumed even when the focus is not on the live block (null result)', async () => {
    await render({ qr: true });
    expect(api.returnFocus('author/demo-blog/post/1')).toBeNull();
    expect(takeLiveQrRequest).toHaveBeenCalledTimes(1);
    frame();
    expect(modal.open).not.toHaveBeenCalled();
  });

  test('the QR request is consumed when the target is not the card (share), and no QR opens', async () => {
    await render({ qr: true });
    expect(api.returnFocus(SHARE)).not.toBeNull();
    expect(takeLiveQrRequest).toHaveBeenCalledTimes(1);
    expect(latch.auto).toHaveBeenCalledWith(SHARE);
    expect(focusMock).toHaveBeenCalledTimes(1);
    frame();
    expect(modal.open).not.toHaveBeenCalled();
  });

  test('back to the card with a QR request: the card at once, the QR one frame later', async () => {
    await render({ qr: true });
    expect(api.returnFocus(LIVE)).not.toBeNull();
    expect(autoFocusLive).toHaveBeenCalledTimes(1);
    expect(modal.open).not.toHaveBeenCalled();
    frame();
    expect(modal.open).toHaveBeenCalledTimes(1);
  });

  test('a button gone, the card shown (target the card, role not `live`): no QR', async () => {
    await render({ qr: true, like: false, share: false });
    expect(api.returnFocus(LIKE)).not.toBeNull();
    expect(autoFocusLive).toHaveBeenCalledTimes(1);
    frame();
    expect(modal.open).not.toHaveBeenCalled();
  });

  test('the cleanup cancels the pending QR frame', async () => {
    await render({ qr: true });
    const cleanup = api.returnFocus(LIVE);
    cleanup?.();
    frame();
    expect(modal.open).not.toHaveBeenCalled();
  });

  test('everything gone with the grid: the first post (not the remembered card)', async () => {
    await render({ card: false, like: false, share: false });
    expect(api.returnFocus(LIVE)).not.toBeNull();
    expect(latch.auto).toHaveBeenCalledWith('author/demo-blog/post/1');
    expect(restoration.focusInitial).toHaveBeenCalledTimes(1);
  });
});
