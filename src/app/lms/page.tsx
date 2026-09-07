import { goHome } from './actions';

export const dynamic = 'force-dynamic';

/** /lms 는 문패일 뿐이다. 누구인지에 따라 제 집으로 보낸다. */
export default async function LmsEntry() {
  await goHome();
}
