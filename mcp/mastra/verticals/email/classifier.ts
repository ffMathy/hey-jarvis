import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Triage of new emails before they are filed for the State Change Reactor.
 *
 * Every new email used to be filed, subject and sender, as one low-priority state change, and the
 * reactor -- a language model reading its whole prompt -- had to work out on its own that most of
 * them were newsletters. What kind of email something is, and how soon it needs the user, are
 * both answers known in advance, which is what an evaluation model (Jev, see
 * `utils/providers/typesafe-provider.ts`) answers in one short call per email.
 *
 * So each email is asked two questions in parallel with the others, and the answers only ever
 * make the filing quieter or sharper: an email the classifier is sure is a newsletter, or sure
 * nobody needs to see, is left out and counted; every email it is sure of carries its kind, so the
 * reactor does not have to guess it; and one it is sure needs the user now raises the filing's
 * priority. Anything it is not sure of, and every email when there is no key or the call fails, is
 * filed exactly as it was before.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const EMAIL_TRIAGE_CLASSIFIER_ID = 'emailTriageClassifier';

/**
 * How sure the classifier must be before an answer changes anything.
 *
 * High on purpose: an unsure answer files the email as it always was, so the only cost of a high
 * bar is a newsletter the reactor has to read, while the cost of a low one is a one-time code or a
 * friend's message that nobody is told about.
 */
export const EMAIL_TRIAGE_CONFIDENCE = 0.85;

/** The kinds an email can be, keyed by the name the reactor sees. */
export const EMAIL_KINDS = {
  personal: 'Written by a person to the user personally: a friend, family, or someone answering them',
  work_needs_action: 'Work that asks the user to do, answer, approve or decide something',
  security_code_or_login_alert:
    'A one-time code, a verification link, a password reset, a sign-in alert or another account security notice',
  delivery_or_order_update: 'An order confirmation, a change to an order, a shipment, or a delivery on its way',
  receipt_or_invoice: 'A receipt, an invoice, a bill or a payment confirmation',
  newsletter_or_promotion: 'A newsletter, marketing, an offer, a sale or any other promotion',
  automated_notification: 'Any other automated notification from a service or a system',
} as const;

export type EmailKind = keyof typeof EMAIL_KINDS;

/** How soon an email needs the user, least first, as the score question's levels are ordered. */
export const EMAIL_URGENCIES = ['ignore', 'fyi', 'today', 'now'] as const;

export type EmailUrgency = (typeof EMAIL_URGENCIES)[number];

const EMAIL_URGENCY_CRITERIA = [
  'Nothing the user needs to know about',
  'Worth the user knowing about, whenever it suits them',
  'Needs the user some time today',
  'Needs the user right now, like a one-time code, a sign-in they did not make, or something about to run out',
] as const;

const EMAIL_TRIAGE_QUESTIONS = {
  kind: {
    type: 'choice' as const,
    instructions: 'This is an email the user just received. What kind of email is it?',
    criteria: EMAIL_KINDS,
  },
  urgency: {
    type: 'score' as const,
    instructions: 'How soon does the user need to know about this email?',
    criteria: EMAIL_URGENCY_CRITERIA,
  },
};

export type EmailTriageAnswers = ClassifierAnswers<typeof EMAIL_TRIAGE_QUESTIONS>;

/** What the classifier is shown of one email. */
export interface TriageableEmail {
  from: string;
  subject: string;
  bodyPreview: string;
}

/** What the classifier was sure of about one email. Each field is absent when it was not sure. */
export interface EmailTriage {
  kind?: EmailKind;
  urgency?: EmailUrgency;
}

/** The priorities a filing can take. Anything short of `now` stays low, which is what it was. */
export type EmailFilingPriority = 'low' | 'high';

/**
 * Reads one email's answers into what the classifier is sure of.
 *
 * Pure, so every way of being unsure can be tested without a model. The urgency is a score, whose
 * value is the probability-weighted mean of its levels; what is read here is instead the single
 * level the distribution puts at least the bar on, since a mean of "fyi" can come from half
 * "ignore" and half "today", which is not being sure of anything.
 */
export function emailTriageFrom(answers: EmailTriageAnswers): EmailTriage {
  const { kind, urgency } = answers;

  // No distribution means no way of knowing how sure it is, which is the same as not being sure.
  const kindConfidence = kind.probabilities?.[kind.choice] ?? 0;
  const sureUrgency = EMAIL_URGENCIES.find(
    (_, level) => (urgency.probabilities?.[String(level)] ?? 0) >= EMAIL_TRIAGE_CONFIDENCE,
  );

  return {
    ...(kindConfidence >= EMAIL_TRIAGE_CONFIDENCE && { kind: kind.choice }),
    ...(sureUrgency && { urgency: sureUrgency }),
  };
}

/** An email together with what the classifier was sure of about it, when it was asked at all. */
export interface TriagedEmail<TEmail> {
  email: TEmail;
  triage: EmailTriage;
}

/** What to file, once every email's triage is in. */
export interface EmailFiling<TEmail> {
  /** The emails to file, each with its kind when the classifier was sure of it. */
  kept: { email: TEmail; kind?: EmailKind }[];
  /** How many were left out as newsletters or as nothing the user needs to know. */
  droppedEmailCount: number;
  priority: EmailFilingPriority;
}

/**
 * Decides which emails are filed, and at what priority.
 *
 * Pure, so the policy can be tested without a model. Only an email the classifier is sure is a
 * newsletter or promotion, or sure needs nobody, is left out; everything else is kept, so an email
 * it knows nothing about is filed exactly as it always was.
 */
export function emailFilingFrom<TEmail>(triagedEmails: TriagedEmail<TEmail>[]): EmailFiling<TEmail> {
  const keptEmails = triagedEmails.filter(
    ({ triage }) => triage.kind !== 'newsletter_or_promotion' && triage.urgency !== 'ignore',
  );

  return {
    kept: keptEmails.map(({ email, triage }) => ({ email, ...(triage.kind && { kind: triage.kind }) })),
    droppedEmailCount: triagedEmails.length - keptEmails.length,
    priority: keptEmails.some(({ triage }) => triage.urgency === 'now') ? 'high' : 'low',
  };
}

/** The classifier email triage runs on, or nothing when there is no key to run it with. */
export const getEmailTriageClassifier = createLazyClassifier(EMAIL_TRIAGE_CLASSIFIER_ID);

/** Asks the classifier what kind of email one is, and how soon it needs the user. */
export async function classifyEmail(classifier: Classifier, email: TriageableEmail): Promise<EmailTriage> {
  const { answers } = await classifier.evaluate({
    state: { from: email.from, subject: email.subject, bodyPreview: email.bodyPreview },
    questions: EMAIL_TRIAGE_QUESTIONS,
  });

  return emailTriageFrom(answers);
}

/**
 * Triages every email at once, and decides what to file.
 *
 * The emails are classified in parallel, since each is its own question and a batch of them
 * waiting on one another would make the whole check as slow as the sum of them. An email whose
 * classification fails is kept as it always was, rather than failing the others with it.
 */
export async function triageEmails<TEmail extends TriageableEmail>(
  emails: TEmail[],
  classifier: Classifier | undefined = getEmailTriageClassifier(),
): Promise<EmailFiling<TEmail>> {
  const triagedEmails = await Promise.all(
    emails.map(async (email): Promise<TriagedEmail<TEmail>> => {
      if (!classifier) {
        return { email, triage: {} };
      }

      try {
        return { email, triage: await classifyEmail(classifier, email) };
      } catch (error: unknown) {
        logger.warn('Email triage failed; filing the email unclassified', { error });
        return { email, triage: {} };
      }
    }),
  );

  const filing = emailFilingFrom(triagedEmails);
  if (classifier) {
    // PRIVACY: counts and kinds only, never a subject or a sender.
    logger.info('Triaged new emails', {
      emailCount: emails.length,
      droppedEmailCount: filing.droppedEmailCount,
      keptKinds: filing.kept.map((keptEmail) => keptEmail.kind ?? 'unsure'),
      priority: filing.priority,
    });
  }

  return filing;
}
