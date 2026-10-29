/**
 * Story 6.5: the PollWidget (I, focus-map §4): results, the user's choice,
 * the voters, the finished state, one focus stop with no focusable option.
 */
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import type { Poll } from '../../../shared/entities/poll';
import { t } from '../../../shared/i18n';
import { PollWidget, pollAccessibilityLabel } from '../PollWidget';

const ID = 'post/p/block/poll:9';
const noop = () => {};

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  id: '9',
  title: 'Какой формат удобнее?',
  isMultiple: false,
  isFinished: false,
  counter: 2521,
  answer: [],
  options: [
    { id: '1', text: 'Длинные', counter: 1210, fraction: 48 },
    { id: '2', text: 'Короткие', counter: 958, fraction: 38 },
    { id: '3', text: 'Эфиры', counter: 353, fraction: 14.4 },
  ],
  ...overrides,
});

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
});

async function render(p: Poll, onView = noop as (id: string, view: unknown) => void, onFocus = noop) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(<PollWidget id={ID} poll={p} onView={onView} onFocus={onFocus} />));
  return root;
}

const focusables = (root: Root) =>
  root.container.queryAll(n => n.props.focusable === true).map(n => n.props.testID as string);
const host = (root: Root) => root.container.queryAll(n => n.props.testID === ID && n.props.focusable === true)[0];
const has = (root: Root, testID: string) => root.container.queryAll(n => n.props.testID === testID).length > 0;
const text = (root: Root) => JSON.stringify(root.container.toJSON());
const barWidth = (root: Root, optionId: string) =>
  StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${ID}/option/${optionId}/bar`)[0].props.style)
    .width;

test('matrix «Open poll»: the title, each option with a bar, its rounded percent and vote count (POLL-01), «Проголосовали: N» with a thousands separator; one focus stop', async () => {
  const root = await render(poll());
  expect(focusables(root)).toEqual([ID]);
  expect(text(root)).toContain('Какой формат удобнее?');
  for (const label of [
    'Длинные',
    'Короткие',
    'Эфиры',
    '48\u00A0% · 1\u202F210',
    '38\u00A0% · 958',
    '14\u00A0% · 353',
    'Проголосовали: 2\u202F521',
  ]) {
    expect(text(root)).toContain(label);
  }
  expect(barWidth(root, '1')).toBe('48%');
  expect(barWidth(root, '3')).toBe('14.4%');
  expect(has(root, `${ID}/finished`)).toBe(false);
  for (const id of ['1', '2', '3']) {
    expect(has(root, `${ID}/option/${id}/chosen`)).toBe(false);
  }
  expect(host(root).props.accessibilityLabel).toBe(
    'Опрос. Какой формат удобнее? Длинные, 48\u00A0%, 1\u202F210 голосов. Короткие, 38\u00A0%, 958 голосов. ' +
      'Эфиры, 14\u00A0%, 353 голоса. Проголосовали: 2\u202F521',
  );
});

test('matrix «My choice»: the chosen option carries the accent check; the label says «ваш выбор»', async () => {
  const root = await render(poll({ answer: ['2'] }));
  expect(has(root, `${ID}/option/2/chosen`)).toBe(true);
  expect(has(root, `${ID}/option/1/chosen`)).toBe(false);
  expect(host(root).props.accessibilityLabel).toContain('Короткие, 38\u00A0%, 958 голосов, ваш выбор');
  expect(host(root).props.accessibilityLabel).not.toContain('1\u202F210 голосов, ваш выбор');
});

test('matrix «Finished»: «Опрос завершен» and the results; still one stop', async () => {
  const root = await render(poll({ isFinished: true, answer: ['1'] }));
  expect(focusables(root)).toEqual([ID]);
  expect(has(root, `${ID}/finished`)).toBe(true);
  expect(text(root)).toContain(t('poll.finished'));
  expect(text(root)).toContain('48\u00A0%');
  expect(host(root).props.accessibilityLabel).toMatch(/Опрос завершен$/);
});

test('matrix «Zero voters»: 0 % bars, «Проголосовали: 0»', async () => {
  const root = await render(
    poll({
      counter: 0,
      options: [
        { id: '1', text: 'A', counter: 0, fraction: 0 },
        { id: '2', text: 'B', counter: 0, fraction: 0 },
      ],
    }),
  );
  expect(barWidth(root, '1')).toBe('0%');
  expect(barWidth(root, '2')).toBe('0%');
  expect(text(root)).toContain('0\u00A0%');
  expect(text(root)).toContain('Проголосовали: 0');
});

test('a fraction out of range: the bar is clamped to 0…100, the text shows the API value rounded', async () => {
  const root = await render(
    poll({
      options: [
        { id: '1', text: 'A', counter: 1, fraction: 140 },
        { id: '2', text: 'B', counter: 0, fraction: -3 },
      ],
    }),
  );
  expect(barWidth(root, '1')).toBe('100%');
  expect(barWidth(root, '2')).toBe('0%');
  expect(text(root)).toContain('140\u00A0%');
});

test('an empty title reads «Опрос»; the label says it once («Опрос. Длинные, …»)', async () => {
  const root = await render(poll({ title: '  ' }));
  expect(text(root)).toContain(t('poll.untitled'));
  expect(host(root).props.accessibilityLabel).toMatch(/^Опрос\. Длинные, /);
  expect(pollAccessibilityLabel(poll({ title: '' }))).not.toContain('Опрос. Опрос');
});

test('an option without text reads «Вариант N» (its position) in the row and the label', async () => {
  const root = await render(
    poll({
      options: [
        { id: '1', text: 'Длинные', counter: 1, fraction: 50 },
        { id: '2', text: '  ', counter: 1, fraction: 50 },
      ],
    }),
  );
  expect(text(root)).toContain('Вариант 2');
  expect(host(root).props.accessibilityLabel).toContain('Вариант 2, 50\u00A0%, 1 голос');
});

test('the label adds no period after a part that already ends a sentence («?», «!», «.», «…»)', () => {
  const one = (title: string, optionText: string) =>
    pollAccessibilityLabel(
      poll({ title, counter: 1, options: [{ id: '1', text: optionText, counter: 1, fraction: 100 }] }),
    );
  expect(one('Что лучше?', 'Да')).toBe('Опрос. Что лучше? Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Голосуем!', 'Да')).toBe('Опрос. Голосуем! Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Итоги.', 'Да')).toBe('Опрос. Итоги. Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Итак…', 'Да')).toBe('Опрос. Итак… Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(one('Вопрос', 'Да')).toBe('Опрос. Вопрос. Да, 100\u00A0%, 1 голос. Проголосовали: 1');
  expect(pollAccessibilityLabel(poll({ title: 'Что лучше?', isFinished: true }))).toMatch(
    /Проголосовали: 2\u202F521\. Опрос завершен$/,
  );
});

test('focus: a ring and no scale; onFocus and onView report the focus id; OK does nothing', async () => {
  const onFocus = jest.fn();
  const onView = jest.fn();
  const root = await render(poll(), onView, onFocus);
  expect(onView).toHaveBeenCalledWith(ID, expect.anything());
  expect(has(root, `${ID}/ring`)).toBe(false);
  await act(async () => {
    host(root).props.onFocus({ nativeEvent: {} });
  });
  expect(onFocus).toHaveBeenCalledWith(ID);
  expect(has(root, `${ID}/ring`)).toBe(true);
  const scale = StyleSheet.flatten(root.container.queryAll(n => n.props.testID === `${ID}/scale`)[0].props.style);
  expect(scale.transform).toEqual([{ scale: 1 }]);
  await act(async () => {
    host(root).props.onClick?.({ nativeEvent: {} });
  });
  expect(focusables(root)).toEqual([ID]);
});
