import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Proposals', template: '%s · KDRIVE' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
