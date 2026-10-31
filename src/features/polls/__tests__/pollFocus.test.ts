import type { Poll } from '../../../shared/entities/poll';
import { pollFallbackOrder, pollFirstStopId, pollFocusIds, pollOptionFocusId } from '../pollFocus';

const IDS = pollFocusIds('post/p/');
const BLOCK = 'post/p/block/poll:9';

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: '9',
  title: 'Опрос',
  isMultiple: false,
  isFinished: false,
  counter: 3,
  answer: [],
  options: [
    { id: '1', text: 'A', counter: 2, fraction: 66 },
    { id: '2', text: 'B', counter: 1, fraction: 33 },
  ],
  ...overrides,
});

describe('pollFocusIds', () => {
  it('builds the focus-map §1.5 ids under the content prefix', () => {
    expect(IDS).toEqual({
      prefix: 'post/p/poll/',
      optionIdPrefix: 'post/p/poll/option/',
      submitId: 'post/p/poll/submit',
      retractId: 'post/p/poll/retract',
    });
    expect(pollOptionFocusId(IDS, '7')).toBe('post/p/poll/option/7');
  });
});

describe('pollFirstStopId', () => {
  it('an open single-choice poll: its first option (voted or not)', () => {
    expect(pollFirstStopId(poll(), IDS)).toBe('post/p/poll/option/1');
    expect(pollFirstStopId(poll({ answer: ['2'] }), IDS)).toBe('post/p/poll/option/1');
  });

  it('an open multiple-choice poll: its first option, or «Отозвать голос» once voted', () => {
    expect(pollFirstStopId(poll({ isMultiple: true }), IDS)).toBe('post/p/poll/option/1');
    expect(pollFirstStopId(poll({ isMultiple: true, answer: ['1'] }), IDS)).toBe('post/p/poll/retract');
  });

  it('a finished poll: null (the block stop)', () => {
    expect(pollFirstStopId(poll({ isFinished: true }), IDS)).toBeNull();
    expect(pollFirstStopId(poll({ isFinished: true, isMultiple: true }), IDS)).toBeNull();
  });
});

describe('pollFallbackOrder', () => {
  const options = ['post/p/poll/option/1', 'post/p/poll/option/2'];

  it('«Проголосовать» gone after a vote: «Отозвать голос» first', () => {
    expect(pollFallbackOrder(poll(), IDS, BLOCK, IDS.submitId)).toEqual([IDS.retractId, ...options, BLOCK]);
  });

  it('an option or «Отозвать голос» gone: the options, «Отозвать голос», the block stop', () => {
    expect(pollFallbackOrder(poll(), IDS, BLOCK, 'post/p/poll/option/1')).toEqual([
      ...options,
      IDS.retractId,
      BLOCK,
    ]);
    expect(pollFallbackOrder(poll(), IDS, BLOCK, IDS.retractId)).toEqual([...options, IDS.retractId, BLOCK]);
  });
});
