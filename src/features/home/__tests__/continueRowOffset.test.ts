import { POST_GRID_CARD_WIDTH } from '../../../shared/ui/PostGrid';
import { spacing } from '../../../shared/ui/tokens';
import { continueRowOffset, type ContinueItem } from '../ContinueRow';

/** Story 9.4: the Continue row's start offset that shows the remembered card. */
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `home/continue/v${i + 1}` }) as ContinueItem);
const STEP = POST_GRID_CARD_WIDTH + spacing['card-gap-x'];

describe('continueRowOffset', () => {
  it.each([1, 2, 3])('card %i (among the first three): 0', n => {
    expect(continueRowOffset(items(8), `home/continue/v${n}`)).toBe(0);
  });

  it('the fourth card: one step, so it sits on column 3', () => {
    expect(continueRowOffset(items(8), 'home/continue/v4')).toBe(STEP);
  });

  it('the last of 8 cards: 5 steps', () => {
    expect(STEP).toBe(221 + 16);
    expect(continueRowOffset(items(8), 'home/continue/v8')).toBe(5 * STEP);
  });

  it('an unknown id: 0', () => {
    expect(continueRowOffset(items(8), 'home/continue/gone')).toBe(0);
  });

  it('Story 12.1: «Очистить всё» follows the last card (8 cards: 6 steps; 2 cards: 0)', () => {
    expect(continueRowOffset(items(8), 'home/continue/clear-all')).toBe(6 * STEP);
    expect(continueRowOffset(items(2), 'home/continue/clear-all')).toBe(0);
  });

  it('undefined: 0', () => {
    expect(continueRowOffset(items(8), undefined)).toBe(0);
  });
});
