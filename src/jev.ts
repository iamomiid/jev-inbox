import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationQuestion,
} from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { Classification, EmailState, LabelConfig, Provider } from './shared';

function labelKey(id: string): string {
  return `label_${id.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;
}

export async function classifyEmail(
  email: EmailState,
  apiKey: string,
  labels: LabelConfig[],
  provider: Provider
): Promise<Classification> {
  const model =
    provider === 'typesafe'
      ? createTypeSafeAi({ apiKey }).evaluationModel('jev-latest')
      : createGateway({ apiKey }).evaluationModel('typesafe-ai/jev');
  const questions: Record<string, Experimental_EvaluationQuestion> = {
    critical: {
      type: 'boolean',
      instructions: 'Classify ONE email. Is this email critical for the recipient?',
      criteria: {
        true: 'Any of: a real person is waiting on a reply from the recipient; money or legal matters (invoices, payments, taxes, contracts, government, bank); a hard deadline or something due or expiring soon (appointments, renewals, visas); security or account events (login alerts, password resets, suspicious activity).',
        false:
          'Newsletters, marketing, promotions, social notifications, automated FYI updates, or receipts that need no action.',
      },
    },
    urgency: {
      type: 'score',
      instructions: 'Classify ONE email. How urgent is it for the recipient?',
      criteria: [
        'Not urgent: passive reading, no time pressure',
        'Somewhat urgent: should be read or handled in the next few days',
        'Urgent: should be read or handled today',
        'Immediately urgent: must be read or acted on right away',
      ],
    },
  };
  for (const label of labels) {
    questions[labelKey(label.id)] = {
      type: 'boolean',
      instructions: `Does this email belong under the label "${label.name}"?`,
      criteria: {
        true: label.description,
        false: `The email does not match: ${label.description}`,
      },
    };
  }

  const result = await evaluate({
    model,
    state: {
      from_name: email.fromName,
      from_email: email.fromEmail,
      subject: email.subject,
      snippet: email.snippet,
      date: email.date,
    },
    questions,
  });
  const critical = result.answers.critical;
  const urgency = result.answers.urgency;
  if (critical.type !== 'boolean' || urgency.type !== 'score') {
    throw new Error('unexpected answer shapes');
  }
  const labelProbabilities: Record<string, number> = {};
  for (const label of labels) {
    const answer = result.answers[labelKey(label.id)];
    if (answer.type !== 'boolean') throw new Error('unexpected answer shapes');
    labelProbabilities[label.id] = answer.probability;
  }
  return {
    criticalProbability: critical.probability,
    urgencyScore: urgency.score,
    labels: labelProbabilities,
  };
}
