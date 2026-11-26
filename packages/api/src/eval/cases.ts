/**
 * The evaluation set: questions about the sample contracts in `/samples` with
 * known answers, checked by `npm run eval`.
 *
 * - `expected` lists where the answer lives (document + clause number). A
 *   retrieved or cited passage counts if it matches any of them.
 * - `facts` are the key facts the answer must state. Each fact is a list of
 *   accepted spellings ("30" or "thirty"); matching ignores case.
 * - Out-of-scope cases (no `expected`) ask something the documents do not
 *   answer; the only correct answer is the refusal sentence.
 */
export interface ExpectedSource {
  document: string;
  /** Clause number as printed in the contract, e.g. "5.2"; matched against labels like "Art. 5.2 — ...". */
  clause: string;
}

export interface EvalCase {
  id: string;
  question: string;
  expected?: ExpectedSource[];
  facts?: string[][];
}

const NDA = 'mutual-nda-quillmere-tessellate.md';
const SAAS = 'saas-terms-larkspur-ledger.md';
const EMPLOYMENT = 'employment-agreement-osterby-robotics.md';

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'nda-termination-notice',
    question: 'How much notice is needed to terminate the NDA between Quillmere and Tessellate?',
    expected: [{ document: NDA, clause: '5.2' }],
    facts: [['30', 'thirty']],
  },
  {
    id: 'nda-governing-law',
    question: 'Which law governs the mutual NDA?',
    expected: [{ document: NDA, clause: '9.1' }],
    facts: [['Netherlands', 'Dutch']],
  },
  {
    id: 'nda-confidentiality-survival',
    question: 'How long do the confidentiality obligations of the NDA survive after it ends?',
    expected: [{ document: NDA, clause: '5.3' }],
    facts: [['five', '5']],
  },
  {
    id: 'saas-liability-cap',
    question: 'What is the liability cap in the Larkspur Ledger terms of service?',
    expected: [{ document: SAAS, clause: '9.1' }],
    facts: [['twelve', '12']],
  },
  {
    id: 'saas-availability',
    question: 'What uptime does Larkspur Ledger commit to for its service?',
    expected: [{ document: SAAS, clause: '2.2' }],
    facts: [['99.5']],
  },
  {
    id: 'saas-breach-notification',
    question: 'Within how many hours must Larkspur notify the customer of a personal data breach?',
    expected: [{ document: SAAS, clause: '5.2' }],
    facts: [['72', 'seventy-two']],
  },
  {
    id: 'employment-salary',
    question: "What is Jordan Avery's annual salary at Osterby Robotics?",
    expected: [{ document: EMPLOYMENT, clause: '4.1' }],
    facts: [['68,000', '68000', '68 000']],
  },
  {
    id: 'employment-holiday',
    question: 'How many days of paid holiday does the employee get per year?',
    expected: [{ document: EMPLOYMENT, clause: '5.1' }],
    facts: [['25', 'twenty-five']],
  },
  {
    id: 'employment-probation',
    question: 'How long is the probationary period in the employment agreement?',
    expected: [{ document: EMPLOYMENT, clause: '2.1' }],
    facts: [['six', '6']],
  },
  {
    id: 'employment-non-solicitation',
    question: 'For how long after termination may the employee not solicit customers?',
    expected: [{ document: EMPLOYMENT, clause: '9.1' }],
    facts: [['six', '6']],
  },
  {
    id: 'out-of-scope-general',
    question: 'What is the capital of Australia?',
  },
  {
    id: 'out-of-scope-lease',
    question: 'How large is the security deposit under the office lease agreement?',
  },
  {
    id: 'out-of-scope-parental-leave',
    question: 'How many weeks of paid parental leave does the employee get?',
  },
];
