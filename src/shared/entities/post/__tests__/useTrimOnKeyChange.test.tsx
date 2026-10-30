import { act } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { useTrimOnKeyChange } from '../useTrimOnKeyChange';

const mockTrim = jest.fn<Promise<void>, [QueryClient, QueryKey]>();
jest.mock('../postsHeadRefresh', () => ({
  trimPostsToFirstPage: (client: QueryClient, key: QueryKey) => mockTrim(client, key),
}));

let client: QueryClient;
let root: ReturnType<typeof createRoot>;

function Probe({ queryKey, queryClient }: { queryKey: QueryKey; queryClient?: QueryClient }) {
  useTrimOnKeyChange(queryClient ?? client, queryKey);
  return null;
}

async function render(queryKey: QueryKey, queryClient?: QueryClient) {
  await act(async () => {
    root.render(<Probe queryKey={queryKey} queryClient={queryClient} />);
  });
}

beforeEach(() => {
  mockTrim.mockReset();
  mockTrim.mockResolvedValue(undefined);
  client = new QueryClient();
  root = createRoot();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe('useTrimOnKeyChange', () => {
  it('never trims on the first render', async () => {
    await render(['feed', { access: 'all' }]);
    expect(mockTrim).not.toHaveBeenCalled();
  });

  it('compares keys by their JSON string: an equal new array is no change', async () => {
    await render(['feed', { access: 'all' }]);
    await render(['feed', { access: 'all' }]);
    expect(mockTrim).not.toHaveBeenCalled();
  });

  it('a changed key trims the previous committed key, once per change', async () => {
    const first: QueryKey = ['feed', { access: 'all' }];
    const second: QueryKey = ['feed', { access: 'allowed' }];
    await render(first);
    await render(second);
    expect(mockTrim).toHaveBeenCalledTimes(1);
    expect(mockTrim.mock.calls[0][0]).toBe(client);
    expect(mockTrim.mock.calls[0][1]).toEqual(first);
    await render(['feed', { access: 'allowed' }]);
    expect(mockTrim).toHaveBeenCalledTimes(1);
    await render(['feed', { access: 'all' }]);
    expect(mockTrim).toHaveBeenCalledTimes(2);
    expect(mockTrim.mock.calls[1][1]).toEqual(second);
  });

  it('a new client with the same key does not trim', async () => {
    await render(['feed']);
    await render(['feed'], new QueryClient());
    expect(mockTrim).not.toHaveBeenCalled();
  });

  it('swallows a failing trim', async () => {
    mockTrim.mockRejectedValueOnce(new Error('boom'));
    await render(['a']);
    await render(['b']);
    expect(mockTrim).toHaveBeenCalledTimes(1);
    // No unhandled rejection: the render keeps working.
    await render(['c']);
    expect(mockTrim).toHaveBeenCalledTimes(2);
  });
});
