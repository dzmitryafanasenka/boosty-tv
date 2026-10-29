import { pollDtoSchema, pollOptionDtoSchema } from '../../api/dto/post';
import type { Poll, PollOption } from './types';

/**
 * The one Poll mapper (Story 6.5): a post's raw top-level `poll` → `Poll`,
 * or null when the reference would drop it: no `id`, `isMultiple` or
 * `isFinished`, or no valid option left (the body then shows the «Опрос»
 * placeholder). An option without `id`, `counter` or `fraction`, or with an
 * id already seen (1 and "1" alike; the first wins), is dropped on its own and the rest of the poll is shown (owner decision 2026-10-29,
 * option a: the reference's `mapNotNull`). Pure and total: nothing here
 * throws.
 */

const idOf = (value: number | string): string => String(value);

const isId = (value: unknown): value is number | string =>
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && value.length > 0);

export function mapPoll(raw: unknown): Poll | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const parsed = pollDtoSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const dto = parsed.data;
  const options: PollOption[] = [];
  /** Option ids seen (as strings: 1 and "1" are the same option); the first occurrence wins. */
  const seen = new Set<string>();
  for (const entry of dto.options) {
    const option = pollOptionDtoSchema.safeParse(entry);
    if (
      !option.success ||
      !Number.isFinite(option.data.counter) ||
      !Number.isFinite(option.data.fraction)
    ) {
      continue;
    }
    const optionId = idOf(option.data.id);
    if (seen.has(optionId)) {
      continue;
    }
    seen.add(optionId);
    options.push({
      id: optionId,
      text: option.data.text ?? '',
      counter: option.data.counter,
      fraction: option.data.fraction,
    });
  }
  if (options.length === 0) {
    return null;
  }
  const counter = dto.counter;
  return {
    id: idOf(dto.id),
    title: (dto.title ?? []).filter((part): part is string => typeof part === 'string').join(', '),
    isMultiple: dto.isMultiple,
    isFinished: dto.isFinished,
    // Voters: a non-negative integer, else 0 (the reference's default).
    counter: typeof counter === 'number' && Number.isInteger(counter) && counter >= 0 ? counter : 0,
    answer: [...new Set((dto.answer ?? []).filter(isId).map(idOf))],
    options,
  };
}

/** The option's percent text: `fraction` rounded to an integer (Story 6.5). */
export function pollPercent(fraction: number): number {
  return Number.isFinite(fraction) ? Math.round(fraction) : 0;
}

/** The option's result bar width in percent: `fraction` clamped to 0…100. */
export function pollBarPercent(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(100, Math.max(0, fraction)) : 0;
}

/** Whether `optionId` is one of the user's choices. */
export function isChosen(poll: Poll, optionId: string): boolean {
  return poll.answer.includes(optionId);
}
