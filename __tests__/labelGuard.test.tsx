/**
 * Story 9.4 label guard. Every flow test's `focusOn` and `press`
 * (`src/test/flow.tsx`) checks that each focusable host view in the tree has
 * a non-blank `accessibilityLabel`, the content description TalkBack reads;
 * `FocusableSurface` requires the prop at the type level. This suite proves
 * the guard itself: it reports an unlabelled raw `Pressable` and a blank
 * label, passes the shared primitives that derive their label, and ignores
 * views that are not focusable.
 */
import { act } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { t } from '../src/shared/i18n';
import { Button, FilterChip, FocusableSurface, NavItem, SettingRow } from '../src/shared/ui';
import { expectLabelledFocusables, unlabelledFocusables } from '../src/test/flow';

async function render(element: React.ReactElement): Promise<Root> {
  const root = createRoot();
  await act(async () => {
    root.render(element);
  });
  return root;
}

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

describe('label guard (Story 9.4)', () => {
  it('reports a raw focusable Pressable without a label, by testID', async () => {
    const root = await render(
      <View>
        <Pressable testID="probe/raw" focusable onPress={() => {}} />
        <Pressable testID="probe/ok" focusable accessibilityLabel={t('player.surface')} onPress={() => {}} />
      </View>,
    );
    expect(unlabelledFocusables(root)).toEqual(['probe/raw']);
    expect(() => expectLabelledFocusables(root)).toThrow('probe/raw');
    await act(async () => root.unmount());
  });

  it('reports a TextInput without a label (focusable by default), and not one with focusable={false}', async () => {
    const root = await render(
      <View>
        <TextInput testID="probe/input" />
        <TextInput testID="probe/input-off" focusable={false} />
        <TextInput testID="probe/input-ok" accessibilityLabel={t('shell.nav.search')} />
      </View>,
    );
    expect(unlabelledFocusables(root)).toEqual(['probe/input']);
    await act(async () => root.unmount());
  });

  it('reports a blank label on a FocusableSurface', async () => {
    const root = await render(<FocusableSurface testID="probe/blank" accessibilityLabel="  " radius={4} scaleFocus={1} />);
    expect(unlabelledFocusables(root)).toEqual(['probe/blank']);
    await act(async () => root.unmount());
  });

  it('ignores views that are not focusable (a disabled Button is not focusable)', async () => {
    const root = await render(
      <View>
        <View testID="probe/plain" />
        <Pressable testID="probe/off" focusable={false} />
        <Button testID="probe/disabled" label={t('settings.signOut.row')} disabled onPress={() => {}} />
      </View>,
    );
    expect(unlabelledFocusables(root)).toEqual([]);
    await act(async () => root.unmount());
  });

  it('passes the shared primitives that derive their label from the visible copy', async () => {
    const root = await render(
      <View>
        <Button testID="probe/button" label={t('settings.signOut.row')} onPress={() => {}} />
        <FilterChip testID="probe/chip" label={t('shell.nav.search')} onPress={() => {}} />
        <NavItem testID="probe/nav" label={t('shell.nav.home')} current={false} onPress={() => {}} />
        <SettingRow testID="probe/row" kind="nav" label={t('settings.signOut.row')} onPress={() => {}} />
      </View>,
    );
    expect(root.container.queryAll(n => n.props.focusable === true).length).toBeGreaterThanOrEqual(4);
    expect(unlabelledFocusables(root)).toEqual([]);
    await act(async () => root.unmount());
  });
});
