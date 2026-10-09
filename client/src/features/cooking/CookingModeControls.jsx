import { useEffect, useRef, useState } from 'react';
import { FaVolumeUp } from 'react-icons/fa';
import Button from '../../components/ui/Button';
import { sourceFlowTiming } from './cookingTiming';
import { timerLabel } from '../../utils/kitchen';

function waitLabel(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) return 'Choose a wait';
  if (seconds === 0) return 'No wait';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return [hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`, minutes && `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`, rest && `${rest} ${rest === 1 ? 'second' : 'seconds'}`].filter(Boolean).join(' ');
}

function recipeTimingLabel(source) {
  if (source?.kind === 'source') return source.label;
  return source?.reasonCode === 'no_duration' ? 'No timed wait in recipe' : 'Timing is unclear in the recipe';
}

function StepTiming({ index, duration, source, adjusted, disabled, onChange, onReset }) {
  const [minutes, setMinutes] = useState(String(Math.floor(Number(duration || 0) / 60)));
  const [seconds, setSeconds] = useState(String(Number(duration || 0) % 60));
  const lastReported = useRef(duration);
  useEffect(() => {
    if (!Object.is(duration, lastReported.current)) {
      const value = Number.isFinite(Number(duration)) ? Number(duration) : 0;
      setMinutes(String(Math.floor(value / 60))); setSeconds(String(value % 60));
    }
    lastReported.current = duration;
  }, [duration]);
  const change = (nextMinutes, nextSeconds) => {
    setMinutes(nextMinutes); setSeconds(nextSeconds);
    const min = Number(nextMinutes), sec = Number(nextSeconds);
    const valid = nextMinutes !== '' && nextSeconds !== '' && Number.isInteger(min) && Number.isInteger(sec) && min >= 0 && min <= 1440 && sec >= 0 && sec <= 59;
    const value = valid ? min * 60 + sec : NaN;
    lastReported.current = value;
    onChange(value);
  };
  return <li><div className="kitchen-flow-step-name">Step {index + 1}<small>{recipeTimingLabel(source)}</small>{adjusted && <button type="button" className="kitchen-flow-reset" disabled={disabled} onClick={onReset} aria-label={`Reset step ${index + 1} to recipe timing`}>Reset</button>}</div><div className="kitchen-flow-fields"><label>Min<input type="number" min="0" max="1440" step="1" value={minutes} aria-label={`Step ${index + 1} wait minutes`} disabled={disabled} onChange={event => change(event.target.value, seconds)} /></label><label>Sec<input type="number" min="0" max="59" step="1" value={seconds} aria-label={`Step ${index + 1} wait seconds`} disabled={disabled} onChange={event => change(minutes, event.target.value)} /></label></div></li>;
}

export default function CookingModeControls({ mode, onModeChange, guided, flow, steps = [], stepIndex, durations = [], timingSources, overridden, onDurationChange, onDurationReset, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const sources = timingSources || steps.map(sourceFlowTiming);
  const adjusted = steps.map((_, index) => overridden?.[index] ?? !Object.is(Number(durations[index]), sources[index]?.seconds ?? 0));
  const resetDuration = index => onDurationReset ? onDurationReset(index) : onDurationChange(index, sources[index]?.seconds ?? 0);
  const selectMode = next => { if (next === mode) return; flow.stop(); guided.end(); onModeChange(next); setEditing(false); };
  const invalid = durations.length !== steps.length || durations.some(value => !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 86400 || value === '');
  const startFlow = () => { setEditing(false); flow.start(); };
  const readingState = flow.phase === 'paused' ? 'Paused' : flow.phase === 'reading' ? `Reading step ${stepIndex + 1}` : flow.phase === 'advancing' ? 'Opening the next step…' : flow.phase === 'completed' ? 'Reading complete.' : '';
  return <div className="kitchen-cooking-mode">
    <div className="kitchen-mode-switch" role="group" aria-label="Cooking mode"><Button type="button" aria-pressed={mode === 'step'} onClick={() => selectMode('step')} disabled={disabled || flow.phase === 'advancing'}>Step by step</Button><Button type="button" aria-pressed={mode === 'timed'} onClick={() => selectMode('timed')} disabled={disabled || flow.phase === 'advancing'}>Timed flow</Button></div>
    {mode === 'step' ? <div className="kitchen-local-voice">{!guided.guided ? <Button className="kitchen-primary" type="button" disabled={disabled} onClick={guided.start}><FaVolumeUp aria-hidden="true" />Start guided cooking</Button> : <div className="kitchen-actions"><Button className="kitchen-secondary" type="button" disabled={disabled || guided.state === 'preparing'} onClick={guided.state === 'playing' ? guided.pause : guided.play}>{guided.state === 'playing' ? 'Pause reading' : 'Play reading'}</Button><Button className="kitchen-secondary" type="button" disabled={disabled} onClick={guided.replay}>Replay step</Button><Button className="kitchen-text-button" type="button" onClick={guided.end}>Stop guidance</Button></div>}{guided.state === 'preparing' && <p role="status">Preparing audio…</p>}</div>
      : <div className="kitchen-timed-flow"><p className="kitchen-help">Read each step, wait its recipe time, then continue. Steps without a clear time continue after reading.</p><ol className="kitchen-flow-summary" aria-label="Recipe timing plan">{steps.map((_, index) => <li key={index}><span className="kitchen-flow-step-name">Step {index + 1}</span><span className="kitchen-flow-summary-time" title={sources[index]?.reason}>{adjusted[index] ? waitLabel(durations[index]) : recipeTimingLabel(sources[index])}{adjusted[index] && <small>Adjusted</small>}</span></li>)}</ol><details className="kitchen-flow-plan" open={editing} onToggle={event => setEditing(event.currentTarget.open)}><summary onClick={event => { event.preventDefault(); setEditing(current => !current); }}>Edit timings</summary><p className="kitchen-help">Zero means continue after reading.</p><ol>{steps.map((_, index) => <StepTiming key={index} index={index} duration={durations[index]} source={sources[index]} adjusted={adjusted[index]} disabled={disabled || flow.active} onChange={value => onDurationChange(index, value)} onReset={() => resetDuration(index)} />)}</ol></details>
        <div className="kitchen-flow-status" aria-live="polite">{flow.phase === 'waiting' ? <span>{stepIndex === steps.length - 1 ? "Flow finishes in" : "Next step in"} <strong role="timer" aria-live="off" aria-label={stepIndex === steps.length - 1 ? "Time until reading finishes" : "Time until next step"}>{timerLabel(flow.remaining)}</strong></span> : readingState && <span>{readingState}</span>}</div>
        <div className="kitchen-actions">{!flow.active ? <Button type="button" className="kitchen-primary" onClick={startFlow} disabled={disabled || invalid || !steps.length}><FaVolumeUp aria-hidden="true" />{flow.phase === 'completed' ? 'Read last step again' : 'Start timed flow'}</Button> : <><Button type="button" className="kitchen-secondary" disabled={disabled || flow.phase === 'advancing'} onClick={flow.phase === 'paused' ? flow.resume : flow.pause}>{flow.phase === 'paused' ? 'Resume flow' : 'Pause flow'}</Button><Button type="button" className="kitchen-text-button" onClick={flow.stop}>Stop flow</Button></>}</div>{invalid && <p className="kitchen-help">Choose a wait between 0 and 24 hours.</p>}{flow.notice && flow.phase !== 'completed' && <p className="kitchen-help" role="status">{flow.notice}</p>}
      </div>}
    {guided.notice && (mode === 'step' || !flow.notice) && <p className="kitchen-help" role="status">{guided.notice}</p>}
  </div>;
}
