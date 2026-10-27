/**
 * FocusableSurface's surface is the same native view as the scale and holds
 * the focus ring (Story 3.1 flattening), so no consumer's `surfaceStyle` may
 * set `overflow` (clips the ring) or `opacity` (dims the ring).
 */
import type { ReactElement } from 'react';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { mapPost, type Post } from '../../entities/post';
import { createLogger } from '../../services/logger';
// eslint-disable-next-line boundaries/dependencies -- test-only fixtures
import { feedPost, lockedPost } from '../../../test/feedFixtures';
import { AuthorCard } from '../AuthorCard';
import { Button } from '../Button';
import { MediaRow } from '../MediaRow';
import { NavItem } from '../NavItem';
import { PostCard } from '../PostCard';
import { SettingRow } from '../SettingRow';

const ID = 'probe';
const evt = { nativeEvent: {} };
const asPost = (raw: unknown) => mapPost(raw, createLogger()) as Post;

const consumers: Array<[string, () => ReactElement]> = [
  ['Button primary', () => <Button testID={ID} label="x" />],
  ['Button secondary small busy', () => <Button testID={ID} label="x" kind="secondary" size="small" busy />],
  ['NavItem current', () => <NavItem testID={ID} label="x" current />],
  ['NavItem', () => <NavItem testID={ID} label="x" current={false} />],
  ['SettingRow nav', () => <SettingRow testID={ID} kind="nav" label="x" />],
  ['SettingRow info', () => <SettingRow testID={ID} kind="info" label="x" value="1" />],
  ['PostCard', () => <PostCard testID={ID} post={asPost(feedPost(1))} width={221} />],
  ['PostCard locked', () => <PostCard testID={ID} post={asPost(lockedPost())} width={221} />],
  [
    'MediaRow',
    () => (
      <MediaRow
        testID={ID}
        playable={false}
        row={{
          ref: { blogUrl: 'b', postId: 'p', mediaId: 'm' },
          index: 0,
          title: 't',
          durationSec: 60,
          previewUrl: 'https://example.invalid/preview',
        }}
      />
    ),
  ],
  [
    'AuthorCard',
    () => (
      <AuthorCard
        testID={ID}
        author={{ blogUrl: 'b', title: 't', ownerName: 'o', avatarUrl: null }}
        width={224}
      />
    ),
  ],
];

async function surfaceStyles(element: ReactElement): Promise<Record<string, unknown>[]> {
  const root: Root = createRoot();
  await act(async () => {
    root.render(element);
  });
  const read = () => {
    const [scale] = root.container.queryAll(n => n.props.testID === `${ID}/scale`);
    return StyleSheet.flatten(scale.props.style) as Record<string, unknown>;
  };
  const [host] = root.container.queryAll(n => n.props.testID === ID && n.props.focusable !== undefined);
  const styles = [read()];
  await act(async () => host.props.onFocus(evt));
  styles.push(read());
  await act(async () => host.props.onPressIn?.(evt));
  styles.push(read());
  await act(async () => root.unmount());
  return styles;
}

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

it.each(consumers)('%s: the surface sets no overflow or opacity in any state', async (_name, make) => {
  for (const style of await surfaceStyles(make())) {
    expect(style.overflow).toBeUndefined();
    expect(style.opacity).toBeUndefined();
  }
});
