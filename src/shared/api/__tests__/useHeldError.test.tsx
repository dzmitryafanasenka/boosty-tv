import { act } from 'react';
import { createRoot } from 'test-renderer';
import { AppError, type AppErrorKind } from '../appError';
import { useHeldError, type HeldErrorInput } from '../useHeldError';

let shown: AppErrorKind | null = null;

function Probe({ input }: { input: HeldErrorInput }) {
  shown = useHeldError(input);
  return null;
}

async function mount() {
  const root = createRoot();
  const step = async (input: HeldErrorInput) => {
    await act(async () => {
      root.render(<Probe input={input} />);
    });
    return shown;
  };
  return step;
}

const failed = (error: unknown): HeldErrorInput => ({
  empty: true,
  status: 'error',
  error,
  isFetching: false,
});

describe('useHeldError', () => {
  beforeEach(() => {
    shown = null;
  });

  it('reports nothing while the first load runs (skeleton)', async () => {
    const step = await mount();
    expect(await step({ empty: true, status: 'pending', error: null, isFetching: true })).toBeNull();
  });

  it("reports a failed load's kind; a non-AppError is Client", async () => {
    const step = await mount();
    expect(await step(failed(new AppError('Network')))).toBe('Network');
    expect(await step(failed(new Error('boom')))).toBe('Client');
  });

  it('holds the last error while a retry puts the query back to pending', async () => {
    const step = await mount();
    await step(failed(new AppError('Server')));
    expect(await step({ empty: true, status: 'pending', error: null, isFetching: true })).toBe(
      'Server',
    );
  });

  it('drops the held error when the retry brings data', async () => {
    const step = await mount();
    await step(failed(new AppError('Server')));
    await step({ empty: true, status: 'pending', error: null, isFetching: true });
    expect(await step({ empty: false, status: 'success', error: null, isFetching: false })).toBeNull();
    // A later empty refetch does not bring the old error back.
    expect(await step({ empty: true, status: 'pending', error: null, isFetching: true })).toBeNull();
  });

  it('drops the held error when a fetch ends without one', async () => {
    const step = await mount();
    await step(failed(new AppError('Server')));
    expect(await step({ empty: true, status: 'success', error: null, isFetching: false })).toBeNull();
    expect(await step({ empty: true, status: 'pending', error: null, isFetching: true })).toBeNull();
  });

  it('a retry that fails with another kind shows the new kind', async () => {
    const step = await mount();
    await step(failed(new AppError('Server')));
    expect(await step({ empty: true, status: 'pending', error: null, isFetching: true })).toBe(
      'Server',
    );
    expect(await step(failed(new AppError('Network')))).toBe('Network');
  });

  it('keeps the held kind while an errored query refetches in the background', async () => {
    const step = await mount();
    await step(failed(new AppError('Server')));
    expect(
      await step({ empty: true, status: 'error', error: new AppError('Server'), isFetching: true }),
    ).toBe('Server');
  });

  it('never reports an error while something is loaded', async () => {
    const step = await mount();
    expect(
      await step({ empty: false, status: 'error', error: new AppError('Network'), isFetching: false }),
    ).toBeNull();
  });
});
