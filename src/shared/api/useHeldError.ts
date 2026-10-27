import type { QueryStatus } from '@tanstack/react-query';
import { useRef } from 'react';
import { isAppError, type AppErrorKind } from './appError';

export type HeldErrorInput = {
  /** Nothing is loaded (no data, or a list with no item). */
  empty: boolean;
  /** The query's status (TanStack `status`). */
  status: QueryStatus;
  /** The query's error; a non-`AppError` reports `Client`. */
  error: unknown;
  /** Any fetch of the query is running. */
  isFetching: boolean;
};

/**
 * The error to show while nothing is loaded, held during a retry.
 *
 * A retry of a failed load without data puts a TanStack query back to
 * `pending`: this keeps reporting the last error meanwhile, so the error
 * StateView stays with its busy «Повторить» (focus kept) instead of the
 * skeleton. Data arriving, or the fetch ending without an error, drops it.
 * Returns null whenever something is loaded.
 */
export function useHeldError({ empty, status, error, isFetching }: HeldErrorInput): AppErrorKind | null {
  const lastError = useRef<AppErrorKind | null>(null);
  if (status === 'error' && empty) {
    lastError.current = isAppError(error) ? error.kind : 'Client';
  } else if (!empty || !isFetching) {
    lastError.current = null;
  }
  return empty && (status === 'error' || isFetching) ? lastError.current : null;
}
