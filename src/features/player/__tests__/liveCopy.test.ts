import { t } from '../../../shared/i18n';
import { liveCopy } from '../useLivePlayback';

describe('liveCopy', () => {
  test('ended: «Стрим завершён»', () => {
    expect(liveCopy({ ended: true, loading: false, state: { kind: 'unavailable' } }).state).toEqual({
      title: t('player.live.endedTitle'),
      body: t('player.live.endedBody'),
    });
  });

  test("a failed E15 request: the live error title with the error kind's body", () => {
    expect(liveCopy({ ended: false, loading: false, state: { kind: 'error', error: 'Network' } }).state).toEqual({
      title: t('player.live.errorTitle'),
      body: t('error.Network'),
    });
  });

  test('any other error (a broken source after its recovery): the generic live body', () => {
    const copy = liveCopy({ ended: false, loading: false, state: { kind: 'noSource' } });
    expect(copy.state).toEqual({ title: t('player.live.errorTitle'), body: t('player.live.errorBody') });
  });

  test('the surface label: loading, else playing', () => {
    expect(liveCopy({ ended: false, loading: true, state: { kind: 'loading' } }).surfaceLabel).toBe(
      t('player.live.loading'),
    );
    expect(liveCopy({ ended: false, loading: false, state: { kind: 'loading' } }).surfaceLabel).toBe(
      t('player.live.surface'),
    );
  });
});
