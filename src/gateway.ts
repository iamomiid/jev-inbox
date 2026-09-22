import { createGateway, experimental_evaluate as evaluate } from 'ai';
import type { Category, Classification, EmailState } from './shared';

export async function classifyEmail(
  email: EmailState,
  apiKey: string
): Promise<Classification> {
  const provider = createGateway({ apiKey });
  const model = provider.evaluationModel('typesafe-ai/jev');
  const result = await evaluate({
    model,
    state: {
      from_name: email.fromName,
      from_email: email.fromEmail,
      subject: email.subject,
      snippet: email.snippet,
      date: email.date,
    },
    questions: {
      critical: {
        type: 'boolean',
        instructions:
          'Classify ONE email. Is this email critical for the recipient?',
        criteria: {
          true: 'Any of: a real person is waiting on a reply from the recipient; money or legal matters (invoices, payments, taxes, contracts, government, bank); a hard deadline or something due or expiring soon (appointments, renewals, visas); security or account events (login alerts, password resets, suspicious activity).',
          false: 'Newsletters, marketing, promotions, social notifications, automated FYI updates, or receipts that need no action.',
        },
      },
      category: {
        type: 'choice',
        instructions:
          'Classify ONE email. Which single category best describes it?',
        criteria: {
          needs_reply: 'A real person is waiting on a reply from the recipient',
          money_or_legal:
            'Invoices, payments, taxes, contracts, government, bank, or legal matters',
          deadline:
            'A hard deadline: something due or expiring soon (appointments, renewals, visas)',
          security:
            'Login alerts, password resets, suspicious activity, or account security events',
          fyi: 'Automated updates or informational notices that need no action',
          promo: 'Newsletters, marketing, promotions, or social notifications',
        },
      },
      urgency: {
        type: 'score',
        instructions:
          'Classify ONE email. How urgent is it for the recipient?',
        criteria: [
          'Not urgent: passive reading, no time pressure',
          'Somewhat urgent: should be read or handled in the next few days',
          'Urgent: should be read or handled today',
          'Immediately urgent: must be read or acted on right away',
        ],
      },
    },
    providerOptions: { gateway: { zeroDataRetention: true } },
  });
  const critical = result.answers.critical;
  const category = result.answers.category;
  const urgency = result.answers.urgency;
  if (critical.type !== 'boolean' || category.type !== 'choice' || urgency.type !== 'score') {
    throw new Error('unexpected answer shapes');
  }
  return {
    criticalProbability: critical.probability,
    category: category.choice as Category,
    urgencyScore: urgency.score,
  };
}
