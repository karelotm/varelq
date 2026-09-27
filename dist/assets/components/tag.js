import { badge } from './badge.js';

const KINDS = {
  rule: ['Rule', 'info'],
  deterministic: ['Deterministic', 'info'],
  model: ['Model explanation', 'neutral'],
  template: ['Template', 'neutral'],
  synthetic: ['Synthetic', 'warning'],
  recorded: ['Recorded', 'accent'],
  stub: ['Stub', 'danger'],
  public: ['Public dataset', 'neutral'],
  measured: ['Measured', 'neutral'],
};
/** tag(kind): kind in rule|model|template|deterministic|synthetic|recorded|stub|public|measured. opts.text overrides the label. */
export function tag(kind, opts = {}) {
  const k = KINDS[kind] || [String(kind), 'neutral'];
  const text = opts.text || k[0];
  const title = opts.title || (kind === 'model' ? 'Written by the model: a hypothesis, not evidence' : undefined);
  return badge(text, k[1], { title, className: `tag tag-${kind}` });
}
