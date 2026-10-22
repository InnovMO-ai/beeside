import type { Answers, StepRef } from '@beeside/fa-public-engine';
import type { HelpScreen } from '../copy/help';

/** The help screen a flow step belongs to (DSC-37 mapping). The decision step also hosts the project-size block unless the person took the «I already know what I need» shortcut. */
export function helpScreenOf(step: StepRef, a: Answers): HelpScreen {
  switch (step.id) {
    case 'cover': return 'cover';
    case 'identity': return 'identity';
    case 'company': return 'company';
    case 'destinations': return 'destinations';
    case 'activity': case 'presence': return 'activity';
    case 'reason': return 'reason';
    case 'decision': return a.knowsNeeds === true ? 'decision' : 'size';
    case 'activators': case 'activators_sell': case 'activators_site': return 'activators';
    case 'fronts_status': case 'fronts_support': case 'fronts_mark': case 'fronts_critical': return 'topics';
    case 'support_values': case 'extra': return 'extra';
    default: return 'extra';
  }
}
