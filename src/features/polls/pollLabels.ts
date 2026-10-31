import { isChosen, pollPercent, type Poll, type PollOption } from '../../shared/entities/poll';
import { t, tf, tp } from '../../shared/i18n';
import { formatCount } from '../../shared/i18n/format';
import type { PollMutation } from './usePollVote';

/** «N %»: the API's `fraction`, rounded. */
const percentText = (fraction: number) => tf('poll.percent', { n: String(pollPercent(fraction)) });

/** A vote count as a non-negative integer (the API's value, rounded). */
const votesOf = (counter: number) => (Number.isFinite(counter) && counter > 0 ? Math.round(counter) : 0);

/** «48 % · 1 210» (POLL-01: the percent and the option's vote count). */
export const resultText = (option: PollOption) =>
  tf('poll.result', { percent: percentText(option.fraction), count: formatCount(option.counter) });

/** The option's text, else «Вариант N» (its 1-based position; display only). */
export const optionText = (option: PollOption, index: number) =>
  option.text.trim() || tf('poll.optionFallback', { n: String(index + 1) });

/** «Проголосовали: N». */
export const votersText = (poll: Poll) => tf('poll.voters', { n: formatCount(poll.counter) });

/** The poll's title, else «Опрос без названия». */
export const shownPollTitle = (poll: Poll) => {
  const title = poll.title.trim();
  return title.length > 0 ? title : t('poll.untitled');
};

/** A part that already ends a sentence gets no added period (no «?.» or «..»). */
const ENDS_SENTENCE = /[.?!…]$/;

/** Label parts as sentences: each but the last ends with a period unless it already ends one. */
export function joinSentences(parts: readonly string[]): string {
  return parts
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map((part, i, all) => (i < all.length - 1 && !ENDS_SENTENCE.test(part) ? `${part}.` : part))
    .join(' ');
}

/** «Вариант, 48 %, 1 210 голосов» (or «…, ваш выбор» when `chosen`). */
function optionLabel(option: PollOption, index: number, chosen: boolean): string {
  const votes = votesOf(option.counter);
  return tf(chosen ? 'poll.a11yOptionChosen' : 'poll.a11yOption', {
    text: optionText(option, index),
    percent: percentText(option.fraction),
    count: `${formatCount(votes)} ${tp('poll.votes', votes)}`,
  });
}

/**
 * The readable summary: «Опрос», the title (when there is one), each option
 * with its percent, vote count (and «ваш выбор»), the voters and, when
 * finished, «Опрос завершен».
 */
export function pollAccessibilityLabel(poll: Poll): string {
  return joinSentences([
    t('poll.a11yPrefix'),
    poll.title,
    ...poll.options.map((option, index) => optionLabel(option, index, isChosen(poll, option.id))),
    votersText(poll),
    poll.isFinished ? t('poll.finished') : '',
  ]);
}

/** The checkbox option's readable label: text, percent, votes, then «отмечено» / «не отмечено». */
export function pollCheckOptionAccessibilityLabel(
  option: PollOption,
  index: number,
  { checked, prefix = [], suffix = [] }: { checked: boolean; prefix?: readonly string[]; suffix?: readonly string[] },
): string {
  return joinSentences([
    ...prefix,
    optionLabel(option, index, false),
    t(checked ? 'poll.a11yChecked' : 'poll.a11yUnchecked'),
    ...suffix,
  ]);
}

/** The option's readable label: its text, percent, votes, «ваш выбор», then the pending hint or «Отправка». */
export function pollOptionAccessibilityLabel(
  option: PollOption,
  index: number,
  { chosen, pending, sending, prefix = [], suffix = [] }: {
    chosen: boolean;
    pending: PollMutation | null;
    sending: boolean;
    prefix?: readonly string[];
    suffix?: readonly string[];
  },
): string {
  return joinSentences([
    ...prefix,
    optionLabel(option, index, chosen),
    sending
      ? t('poll.sending')
      : pending === 'retract'
        ? t('poll.pendingRetract')
        : pending === 'vote'
          ? t('poll.pendingVote')
          : '',
    ...suffix,
  ]);
}
