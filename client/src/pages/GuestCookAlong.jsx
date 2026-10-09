import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { FaCheck, FaMicrophone, FaRegClock } from 'react-icons/fa';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';
import useGuidedCooking from '../features/cooking/useGuidedCooking';
import useCookingFlow from '../features/cooking/useCookingFlow';
import CookingModeControls from '../features/cooking/CookingModeControls';
import useRecipeStepTiming from '../features/cooking/useRecipeStepTiming';
import useCookingMicrophone from '../features/cooking/useCookingMicrophone';
import { sourceDurations } from '../features/cooking/guidedCooking';
import { guestCookingProgress, saveGuestCooking, timerCueBody } from '../features/cooking/guestCooking';
import { guestCookRequest } from '../features/cooking/guestCookApi';
import { cancelAiRequest } from '../utils/aiControl';
import { timerLabel, timerSeconds } from '../utils/kitchen';
import './Kitchen.css';

export function GuestCooking({ recipeId, embedded = false, isActive = true }) {
  const PanelHeading = embedded ? "h3" : "h2";
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [source, setSource] = useState(null), [progress, setProgress] = useState(null), [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0), [clock, setClock] = useState(Date.now());
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const [timer, setTimer] = useState({ label: '', minutes: '5', seconds: '0' }), [question, setQuestion] = useState(''), [reply, setReply] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [modeState, setModeState] = useState({ identity: '', mode: 'step' });
  const flowRef = useRef(null);
  const active = useRef(true), action = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; action.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    guestCookRequest(recipeId, '', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setSource(value); setProgress(guestCookingProgress(value)); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [recipeId, retry]);
  useEffect(() => { const refresh = () => setClock(Date.now()); const interval = setInterval(refresh, 1000); document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh); return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); }; }, []);
  const publicRequest = useCallback((path, options) => {
    const version = source?.recipeVersion;
    if (path.includes('/sessions/')) return guestCookRequest(recipeId, 'speak', { ...options, body: { stepIndex: options.body.stepIndex, recipeVersion: version } });
    return guestCookRequest(recipeId, 'timer-cue', { ...options, body: { ...timerCueBody(options.body.text), recipeVersion: version } });
  }, [recipeId, source?.recipeVersion]);
  const cookingIdentity = `${user?.id || 'guest'}:${recipeId}:${source?.recipeVersion || ''}`;
  const steps = useMemo(() => source?.steps || [], [source?.steps]);
  const cookingMode = modeState.identity === cookingIdentity ? modeState.mode : 'step';
  const stepTiming = useRecipeStepTiming(cookingIdentity, steps);
  const flowDurations = stepTiming.durations;
  const guided = useGuidedCooking({ identity: cookingIdentity, sessionId: recipeId, available: !!source && !loading,
    text: steps[progress?.stepIndex || 0] || '', stepIndex: progress?.stepIndex || 0, timers: progress?.timers || [], now: clock, request: publicRequest,
    onStepRead: event => flowRef.current?.onStepRead(event), onStepInterrupted: event => flowRef.current?.onStepInterrupted(event) });
  const flow = useCookingFlow({ identity: cookingIdentity, steps, stepIndex: progress?.stepIndex || 0, available: !!source && !loading && progress?.status === 'active',
    now: clock, guided, durations: flowDurations, onAdvance: (nextIndex, { signal }) => { if (signal.aborted || !active.current) return false; update({ stepIndex: nextIndex }); return true; } });
  flowRef.current = flow;
  const microphone = useCookingMicrophone({ transcribe: (body, signal) => guestCookRequest(recipeId, 'transcribe', { body: { ...body, recipeVersion: source?.recipeVersion }, signal }), onText: setQuestion, setError, setNotice });
  const tabPauseRef = useRef(null);
  tabPauseRef.current = () => { flow.pause(); guided.pause(); microphone.cancel(); };
  useEffect(() => { if (!isActive) tabPauseRef.current?.(); }, [isActive]);
  const update = values => { const next = { ...progress, ...values }; setProgress(next); setClock(Date.now()); if (!saveGuestCooking(next)) setNotice('Browser storage is unavailable. Keep this page open to continue.'); };
  const addTimer = event => {
    event.preventDefault(); const minutes = Number(timer.minutes), secondsPart = Number(timer.seconds), seconds = minutes * 60 + secondsPart;
    if (!Number.isInteger(minutes) || !Number.isInteger(secondsPart) || minutes < 0 || secondsPart < 0 || secondsPart > 59 || seconds < 1 || seconds > 86400) { setError('Set a timer between one second and 24 hours.'); return; }
    if (progress.timers.length >= 20) { setError('Remove a timer before adding another.'); return; }
    setError(''); update({ timers: [...progress.timers, { id: crypto.randomUUID(), label: timer.label.trim() || `Step ${progress.stepIndex + 1}`, durationSeconds: seconds, endsAt: new Date(Date.now() + seconds * 1000).toISOString(), running: true, acknowledged: false }] });
  };
  const ask = async event => {
    event.preventDefault(); if (action.current) return; const controller = new AbortController(); action.current = controller; setBusy('ask'); setError(''); setNotice('');
    try { const result = await guestCookRequest(recipeId, 'ask', { body: { question: question.trim(), stepIndex: progress.stepIndex, recipeVersion: source.recipeVersion }, signal: controller.signal }); if (!controller.signal.aborted && active.current) setReply(result); }
    catch (failure) { if (!controller.signal.aborted && active.current) setError(failure.message); }
    finally { if (action.current === controller) { action.current = null; if (active.current) setBusy(''); } }
  };
  if (loading && !source) return <div className="kitchen-empty" role="status">Loading cooking steps…</div>;
  if (!source || !progress) return <div className="kitchen-error" role="alert"><p>{error || 'Choose a recipe to cook along.'}</p><div className="kitchen-actions"><Button className="kitchen-secondary" onClick={() => setRetry(value => value + 1)}>Try again</Button><Link className="kitchen-primary" to="/recipes">Browse recipes</Link></div></div>;
  const step = source.steps[progress.stepIndex], durations = sourceDurations(step);
  const requestedServings = Number(params.get('servings')), servings = Number.isInteger(requestedServings) && requestedServings >= 1 && requestedServings <= 12 ? requestedServings : source.servings || 2;
  const finish = () => { flow.stop(); guided.end(); update({ status: 'completed', completedAt: new Date().toISOString() }); setNotice('Enjoy your meal.'); };
  return <>
    <header className={`kitchen-cook-title${embedded ? " kitchen-cook-title-embedded" : ""}`}><div>{!embedded && <h1>{source.recipeTitle}</h1>}<div className="kitchen-cook-meta">{!embedded && <span className="kitchen-badge">Cook along</span>}<span>{servings} servings</span></div></div>{!embedded && <div className="kitchen-cook-links"><Link className="kitchen-text-link" to={`/recipes/${recipeId}`}>View recipe</Link></div>}</header>
    <p className="kitchen-help">Your progress stays in this tab.</p>
    <div className="kitchen-feedback" aria-live="polite">{error && <p className="kitchen-error" role="alert">{error}</p>}{notice && <p className="kitchen-notice" role="status">{notice}</p>}</div>
    <div className="kitchen-grid-two kitchen-cook-grid"><section className="kitchen-panel kitchen-step"><div className="kitchen-panel-heading"><PanelHeading>Step {progress.stepIndex + 1}<span className="kitchen-step-total"> / {source.steps.length}</span></PanelHeading><span className="kitchen-step-source">Recipe instruction</span></div><progress value={progress.stepIndex + 1} max={source.steps.length} aria-label="Recipe progress" />
      <CookingModeControls key={cookingIdentity} mode={cookingMode} onModeChange={mode => setModeState({ identity: cookingIdentity, mode })} guided={guided} flow={flow} steps={steps} stepIndex={progress.stepIndex} durations={flowDurations} timingSources={stepTiming.sources} overridden={stepTiming.overridden} disabled={progress.status === 'completed'} onDurationChange={stepTiming.change} onDurationReset={stepTiming.reset} />
      <p className="kitchen-step-text">{step}</p>{durations.length > 0 && <div className="kitchen-source-timers">{durations.map(item => <Button key={item.seconds} className="kitchen-secondary" onClick={() => setTimer({ label: `Step ${progress.stepIndex + 1}`, minutes: String(Math.floor(item.seconds / 60)), seconds: String(item.seconds % 60) })}>Set {item.label}</Button>)}<p className="kitchen-help">Check the timer, then press Start timer.</p></div>}
      <div className="kitchen-actions kitchen-step-actions"><Button className="kitchen-secondary" disabled={flow.phase === 'advancing' || progress.stepIndex === 0} onClick={() => { flow.stop(); update({ stepIndex: progress.stepIndex - 1 }); }}>Previous</Button><Button className="kitchen-primary" disabled={flow.phase === 'advancing' || progress.stepIndex === source.steps.length - 1} onClick={() => { flow.stop(); update({ stepIndex: progress.stepIndex + 1 }); }}>Done, next step</Button></div></section>
      <section className="kitchen-panel kitchen-timers"><div className="kitchen-panel-heading"><PanelHeading>Timers</PanelHeading><FaRegClock aria-hidden="true" /></div>
        {guided.alerts.length > 0 && <div className="kitchen-due-alerts" role="alert">{guided.alerts.map(alert => <div key={alert.key}><p>{alert.text}</p><Button className="kitchen-secondary" onClick={() => update({ timers: progress.timers.map(value => value.id === alert.timerId ? { ...value, running: false, acknowledged: true } : value) })}>Acknowledge {progress.timers.find(value => value.id === alert.timerId)?.label}</Button></div>)}</div>}
        <p className="kitchen-help">Keep this screen open for audio reminders. Check food as the recipe instructs.</p><ul className="kitchen-timer-list">{progress.timers.map(item => <li key={item.id}><div><strong>{item.label}</strong><span className="kitchen-timer-count" role="timer">{item.running ? timerSeconds(item, clock) ? timerLabel(timerSeconds(item, clock)) : 'Finished' : 'Stopped'}</span></div><div className="kitchen-actions">{item.running && <Button className="kitchen-secondary" onClick={() => update({ timers: progress.timers.map(value => value.id === item.id ? { ...value, running: false, endsAt: null } : value) })}>Stop</Button>}<Button className="kitchen-text-button" onClick={() => update({ timers: progress.timers.filter(value => value.id !== item.id) })}>Remove</Button></div></li>)}</ul>{!progress.timers.length && <p className="kitchen-empty-small">Add a timer when you need one.</p>}
        <form onSubmit={addTimer}><Field>Timer name<input maxLength="100" value={timer.label} onChange={event => setTimer({ ...timer, label: event.target.value })} placeholder="Resting time" /></Field><div className="kitchen-form-grid"><Field>Minutes<input type="number" min="0" max="1440" value={timer.minutes} onChange={event => setTimer({ ...timer, minutes: event.target.value })} /></Field><Field>Seconds<input type="number" min="0" max="59" value={timer.seconds} onChange={event => setTimer({ ...timer, seconds: event.target.value })} /></Field></div><Button className="kitchen-primary" type="submit">Start timer</Button></form>
      </section></div>
    <details className="kitchen-details kitchen-source-overview"><summary>All recipe steps</summary><ol>{source.steps.map((value, index) => <li key={index} className={index === progress.stepIndex ? 'is-current' : ''}>{value}</li>)}</ol></details>
    <section className="kitchen-panel kitchen-assistant"><PanelHeading>Ask Sunny</PanelHeading><p>Ask about this recipe while you cook.</p><form onSubmit={ask}><Field>Your question<textarea required rows="3" maxLength="1000" disabled={!!busy || microphone.recording || !!microphone.busy} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What should I do in this step?" /></Field><div className="kitchen-actions kitchen-action-bar"><Button className="kitchen-primary" type="submit" disabled={!!busy || microphone.recording || !!microphone.busy}>{busy === 'ask' ? 'Checking the recipe…' : 'Ask Sunny'}</Button>{busy === 'ask' && <Button className="kitchen-text-button" type="button" onClick={() => { void cancelAiRequest(action.current?.signal); action.current?.abort(); }}>Cancel</Button>}{microphone.recording ? <><Button className="kitchen-secondary" type="button" onClick={microphone.stop}>Stop & transcribe</Button><Button className="kitchen-text-button" type="button" onClick={microphone.cancel}>Cancel recording</Button></> : <Button className="kitchen-secondary" type="button" disabled={!!busy || !!microphone.busy} onClick={microphone.start}><FaMicrophone aria-hidden="true" />Record a question</Button>}</div>{microphone.busy && <p role="status">{microphone.busy}… <Button className="kitchen-text-button" type="button" onClick={microphone.cancel}>Cancel</Button></p>}{microphone.recording && <p role="status">Recording… press Stop when finished.</p>}<p className="kitchen-help">Review the transcript before asking. Up to 60 seconds.</p></form>{reply && <div className="kitchen-answer"><h3>{reply.supported ? 'From the recipe' : 'Not in the recipe'}</h3><p>{reply.answer}</p>{reply.citations?.length > 0 && <ul>{reply.citations.map((item, index) => <li key={index}><strong>Step {item.stepIndex + 1}</strong><blockquote>{item.text}</blockquote></li>)}</ul>}</div>}</section>
    <section className="kitchen-panel kitchen-complete"><PanelHeading>{progress.status === 'completed' ? 'Meal complete' : 'Finished cooking?'}</PanelHeading>{progress.status === 'completed' ? <><p><FaCheck aria-hidden="true" />Enjoy your meal.</p><Button type="button" className="kitchen-secondary" onClick={() => { flow.stop(); guided.end(); update({ status: 'active', completedAt: null, stepIndex: 0, timers: [] }); setConfirmed(false); setNotice(''); }}>Cook this recipe again</Button></> : <><Field className="kitchen-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I cooked this meal.</span></Field><Button className="kitchen-primary" disabled={!confirmed} onClick={finish}>Confirm cooked meal</Button></>}<div className="kitchen-actions"><Link className="kitchen-text-link" to="/meal-planner">Plan another dinner</Link>{user ? <Link className="kitchen-text-link" to="/household">View saved cooking sessions</Link> : <Link className="kitchen-text-link" to="/login" state={{ from: { pathname: `/recipes/${recipeId}` } }}>Sign in for saved cooking sessions</Link>}</div></section>
  </>;
}

export default function GuestCookAlong() {
  const { recipeId } = useParams();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params); next.set("cook", "1");
  return <Navigate replace to={`/recipes/${recipeId}?${next}`} />;
}
