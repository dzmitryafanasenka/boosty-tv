import { authFlow } from '../authFlow';

afterEach(() => authFlow.reset());

test('starts with +7 and an empty number, no challenge', () => {
  expect(authFlow.getDraft()).toEqual({ countryCode: '+7', number: '' });
  expect(authFlow.getChallenge()).toBeNull();
});

test('holds the draft and the challenge; returns copies', () => {
  authFlow.setDraft({ countryCode: '+375', number: '291234567' });
  authFlow.setChallenge({ phone: '+375291234567', challenge: 'c'.repeat(64) });
  const copy = authFlow.getChallenge();
  if (copy) {
    copy.challenge = 'tampered';
  }
  expect(authFlow.getChallenge()?.challenge).toBe('c'.repeat(64));
  expect(authFlow.getDraft()).toEqual({ countryCode: '+375', number: '291234567' });
});

test('clearChallenge keeps the draft; reset clears both', () => {
  authFlow.setDraft({ countryCode: '+375', number: '291234567' });
  authFlow.setChallenge({ phone: '+375291234567', challenge: 'x' });
  authFlow.clearChallenge();
  expect(authFlow.getChallenge()).toBeNull();
  expect(authFlow.getDraft().number).toBe('291234567');
  authFlow.reset();
  expect(authFlow.getDraft()).toEqual({ countryCode: '+7', number: '' });
});
