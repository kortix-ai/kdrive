// Captures account mail for a test: every message better-auth sends lands in `outbox`.
import { type EmailMessage, setEmailSinkForTests, settleEmails } from '../src/email/client';

export interface Mailbox {
  outbox: EmailMessage[];
  /** Waits for background sends, then returns the messages to `to` (optionally of one category). */
  to(to: string, category?: string): Promise<EmailMessage[]>;
  /** The first link to our own origin in the newest matching message. */
  link(to: string, category: string): Promise<URL>;
  restore(): void;
}

export function captureMail(): Mailbox {
  const outbox: EmailMessage[] = [];
  setEmailSinkForTests((m) => outbox.push(m));
  const to = async (addr: string, category?: string) => {
    await settleEmails();
    return outbox.filter((m) => m.to.toLowerCase() === addr.toLowerCase() && (!category || m.category === category));
  };
  return {
    outbox,
    to,
    async link(addr, category) {
      const msgs = await to(addr, category);
      const m = msgs.at(-1);
      if (!m) throw new Error(`no ${category} mail to ${addr} (have: ${outbox.map((o) => `${o.category}→${o.to}`).join(', ') || 'none'})`);
      const href = m.links?.[0] ?? /https?:\/\/[^\s"<]+/.exec(m.text)?.[0];
      if (!href) throw new Error(`no link in ${category} mail`);
      return new URL(href);
    },
    restore: () => setEmailSinkForTests(() => {}),
  };
}
