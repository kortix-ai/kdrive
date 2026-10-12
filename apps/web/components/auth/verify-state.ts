/** Where a confirmed link left the user (the page appends `?error=` with the API's code on failure). */
export type VerifyState = 'verified' | 'expired' | 'invalid' | 'change-approved' | 'change-done';

export function verifyState(params: { get(name: string): string | null }): VerifyState {
  const error = params.get('error');
  if (error) return error.toUpperCase() === 'TOKEN_EXPIRED' ? 'expired' : 'invalid';
  const change = params.get('change');
  if (change === 'approved') return 'change-approved';
  if (change === 'done') return 'change-done';
  return 'verified';
}

export const VERIFY_COPY: Record<VerifyState, { title: string; body: string }> = {
  verified: { title: 'Email verified', body: 'Thanks. Your address is confirmed, so you can always get back into your account.' },
  expired: { title: 'This link has expired', body: 'Verification links work for 24 hours. Ask for a new one and use the newest email.' },
  invalid: { title: 'This link does not work', body: 'It may have been used already, copied only in part, or replaced by a newer one.' },
  'change-approved': {
    title: 'Change approved',
    body: 'One more step: open the link we just sent to your new address. Your email changes once you confirm it there.',
  },
  'change-done': { title: 'Email changed', body: 'Your account now uses its new address. Sign in with it from now on.' },
};

/** What an emailed link asks the user to confirm (the API never acts on the mailed URL itself). */
export type LinkStep = 'verify' | 'approve' | 'confirm';

export function linkStep(params: { get(name: string): string | null }): { step: LinkStep; token: string } | null {
  const step = params.get('step');
  const token = params.get('token');
  if (!token || (step !== 'verify' && step !== 'approve' && step !== 'confirm')) return null;
  return { step, token };
}

export const STEP_COPY: Record<LinkStep, { title: string; body: string; action: string }> = {
  verify: { title: 'Confirm your email', body: 'Press the button to confirm this address for your KDRIVE account.', action: 'Confirm email' },
  approve: {
    title: 'Approve the email change',
    body: 'Someone signed in to your account asked to move it to a new address. Approve only if that was you.',
    action: 'Approve change',
  },
  confirm: { title: 'Confirm your new email', body: 'Press the button to move your KDRIVE account to this address.', action: 'Confirm new email' },
};

/** The page state once a step went through. */
export const STEP_DONE: Record<LinkStep, VerifyState> = { verify: 'verified', approve: 'change-approved', confirm: 'change-done' };

/** The query the page lands on after pressing the button: the done state, or the error code. */
export function stepResultQuery(step: LinkStep, errorCode: string | null | undefined): string {
  if (errorCode) return `?error=${encodeURIComponent(errorCode)}`;
  const done = STEP_DONE[step];
  return done === 'change-approved' ? '?change=approved' : done === 'change-done' ? '?change=done' : '';
}
