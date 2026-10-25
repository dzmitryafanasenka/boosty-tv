import { DEFAULT_COUNTRY_CODE } from './phone';

/**
 * In-memory state of one sign-in attempt: the A2 field draft and, after a
 * successful send, the challenge for confirm (Story 2.3).
 *
 * Memory only: never in route params, logs or storage. Persisting the phone
 * (secure storage, prefill for re-login) is Story 2.3. The challenge is
 * cleared when A5 is left; the whole flow is reset when A2 is left for A1.
 */

export type PhoneDraft = { countryCode: string; number: string };

export type PendingChallenge = {
  /** E.164 phone the code was sent to. */
  phone: string;
  challenge: string;
  sentTransport?: string;
  expiresIn?: number;
};

const emptyDraft = (): PhoneDraft => ({
  countryCode: DEFAULT_COUNTRY_CODE,
  number: '',
});

let draft: PhoneDraft = emptyDraft();
let pending: PendingChallenge | null = null;

export const authFlow = {
  getDraft(): PhoneDraft {
    return { ...draft };
  },
  setDraft(next: PhoneDraft): void {
    draft = { ...next };
  },
  getChallenge(): PendingChallenge | null {
    return pending ? { ...pending } : null;
  },
  setChallenge(next: PendingChallenge): void {
    pending = { ...next };
  },
  clearChallenge(): void {
    pending = null;
  },
  /** Forget the draft and the challenge (leaving the sign-in for A1). */
  reset(): void {
    draft = emptyDraft();
    pending = null;
  },
};
