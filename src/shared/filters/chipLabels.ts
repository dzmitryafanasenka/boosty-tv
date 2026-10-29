import { t, tf, tp } from '../i18n';
import { activeFilterCount, type Filter } from './filter';
import { formatPeriod } from './periodLabel';

/**
 * The tag section's chip value (owner decision 2026-10-29, Story 5.5 Q2 a):
 * one tag → its title («Фильтры · Выпечка»), several → «Теги: N».
 */
export function chipTagsValue(filter: Filter): string {
  return filter.tags.length === 1
    ? filter.tags[0].title
    : tf('filters.tags.chipMany', { n: String(filter.tags.length) });
}

/**
 * The «Фильтры» chip's visible label, TalkBack label and count for a Filter
 * (owner decision 2026-10-28, Story 5.4; shared by Главная and Поиск since
 * Story 5.6): the default → «Фильтры · Доступные мне»; one active section →
 * that section's value («Фильтры · Последние 7 дней»; tags:
 * `chipTagsValue`) and the count; two or more → «Фильтры» and the count.
 */
export function chipLabels(filter: Filter): { label: string; a11y: string; count: number } {
  const count = activeFilterCount(filter);
  if (count >= 2) {
    return {
      label: t('filters.title'),
      a11y: tf('filters.chipA11yMany', { count: `${count} ${tp('filters.activeCount', count)}` }),
      count,
    };
  }
  const value =
    filter.tags.length > 0
      ? chipTagsValue(filter)
      : filter.period.kind !== 'all'
        ? formatPeriod(filter.period)
        : t(`filters.access.${filter.access}`);
  return {
    label: tf('filters.chip', { value }),
    a11y:
      count > 0
        ? tf('filters.chipA11yCount', { value, count: `${count} ${tp('filters.activeCount', count)}` })
        : tf('filters.chipA11y', { value }),
    count,
  };
}
