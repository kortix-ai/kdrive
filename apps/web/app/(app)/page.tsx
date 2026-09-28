import { redirect } from 'next/navigation';

// Belt-and-braces with the '/' → '/drive' redirect in next.config.ts.
export default function Home() {
  redirect('/drive');
}
