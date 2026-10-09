import { useState } from 'react';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import Alert from '../../components/ui/Alert';

export default function SunnyClarification({ clarification, busy, error, onSubmit, onEdit }) {
  const [answers, setAnswers] = useState({});
  const questions = clarification.questions.slice(0, 2);
  const complete = questions.every(item => typeof answers[item.id] === 'string' && answers[item.id].trim());
  return <form className="sunny-clarification" onSubmit={event => { event.preventDefault(); if (complete && !busy) onSubmit(Object.fromEntries(questions.map(item => [item.id, answers[item.id].trim()]))); }}>
    <h2>A quick check</h2><p>Your original exclusions and time limit stay applied.</p>
    <fieldset disabled={busy}>{questions.map((item, index) => <Field key={item.id} htmlFor={`sunny-answer-${index}`}>
      {item.question}{Array.isArray(item.choices) && item.choices.length ? <select id={`sunny-answer-${index}`} required value={answers[item.id] || ''} onChange={event => setAnswers({ ...answers, [item.id]: event.target.value })}>
        <option value="">Choose an answer</option>{item.choices.slice(0, 12).map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select> : <input id={`sunny-answer-${index}`} required maxLength={200} value={answers[item.id] || ''} onChange={event => setAnswers({ ...answers, [item.id]: event.target.value })} />}
    </Field>)}</fieldset>
    {error && <Alert className="sunny-error">{error}</Alert>}
    <div className="sunny-submit-row"><Button type="submit" className="sunny-primary" disabled={!complete || busy}>{busy ? 'Checking your answers…' : 'Confirm and find recipes'}</Button>
      <Button className="sunny-text-button" disabled={busy} onClick={onEdit}>Edit original request</Button></div>
  </form>;
}
