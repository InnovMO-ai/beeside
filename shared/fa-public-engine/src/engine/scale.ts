import type { ProjectComponent, ScaleProxy } from '../domain/answers';

/** D-149: which single size question a component gets. First match wins:
 *  temporary → duration; produce → investment; hire → people; sell → products; source → purchase; otherwise investment.
 *  It only selects the question: topic activation, resolution and the stored ScaleProxy values are untouched. */
export function proxyFor(c: Pick<ProjectComponent, 'permanence' | 'activities'>): ScaleProxy {
  if (c.permanence === 'temporary') return 'duration';
  if (c.activities.includes('produce')) return 'investment';
  if (c.activities.includes('hire')) return 'people';
  if (c.activities.includes('sell')) return 'products';
  if (c.activities.includes('source')) return 'purchase';
  return 'investment';
}
