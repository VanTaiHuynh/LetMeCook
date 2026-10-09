import { cancelAiRequest } from "../utils/aiControl";
import useGuidedCooking from "../features/cooking/useGuidedCooking";
import useCookingFlow from "../features/cooking/useCookingFlow";
import CookingModeControls from "../features/cooking/CookingModeControls";
import useRecipeStepTiming from "../features/cooking/useRecipeStepTiming";
import { sourceDurations } from "../features/cooking/guidedCooking";
import AfterCooking from "../features/growth/AfterCooking";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useEffect, useRef, useState, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FaCheck, FaMicrophone, FaRegClock, FaSyncAlt } from "react-icons/fa";
import KitchenShell from "../components/KitchenShell";
import { useKitchen, useKitchenResource } from "../utils/useKitchen";
import { kitchenRequest } from "../utils/kitchenApi";
import { consumptionPayload, mealSlotFromParams, timerLabel, timerSeconds } from "../utils/kitchen";
import { readPhoto } from "../utils/sunny";
import { useAuth } from "../context/AuthContext";

export function CookContent({ id, recipeId, onCookAgain, embedded = false, isActive = true }) {
  const PanelHeading = embedded ? "h3" : "h2";
  const { user } = useAuth();
  const { data, householdId, mutate, busy, canEdit, setError, setNotice } = useKitchen();
  const [params] = useSearchParams();
  const resource = useKitchenResource(`/sessions/${id}`);
  const [session, setSession] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [timer, setTimer] = useState({ label: "", minutes: "5", seconds: "0" });
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState(null);
  const [consumption, setConsumption] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [modeState, setModeState] = useState({ identity: '', mode: 'step' });
  const flowRef = useRef(null);
  const [voiceBusy, setVoiceBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const voiceRef = useRef(null);
  const voiceModeRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const stopTimeoutRef = useRef(null);
  const discardRecordingRef = useRef(false);
  const microphoneGeneration = useRef(0);
  const activeRef = useRef(true);
  const tabActiveRef = useRef(isActive);
  tabActiveRef.current = isActive;
  const confirmationRequest = useRef(null);
  useEffect(() => { if (resource.data) setSession(current => !current || resource.data.version >= current.version ? resource.data : current); }, [resource.data]);
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const interval = setInterval(refresh, 1000); document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; voiceRef.current?.abort(); discardRecordingRef.current = true; if (recorderRef.current?.state === "recording") recorderRef.current.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); clearTimeout(stopTimeoutRef.current); }; }, []);
  const cookingIdentity = `${user?.id || 'guest'}:${householdId || 'personal'}:${id}`;
  const sourceSteps = JSON.stringify(session?.steps || []);
  const steps = useMemo(() => JSON.parse(sourceSteps), [sourceSteps]);
  const cookingMode = modeState.identity === cookingIdentity ? modeState.mode : 'step';
  const stepTiming = useRecipeStepTiming(cookingIdentity, steps);
  const flowDurations = stepTiming.durations;
  const writable = canEdit && session?.status === "active";
  const guided = useGuidedCooking({ sessionId: id, available: !resource.error, identity: cookingIdentity, text: steps[session?.stepIndex || 0] || '', stepIndex: session?.stepIndex || 0,
    timers: session?.timers || [], now: clock, householdId, onStepRead: event => flowRef.current?.onStepRead(event), onStepInterrupted: event => flowRef.current?.onStepInterrupted(event) });
  const flow = useCookingFlow({ identity: cookingIdentity, steps, stepIndex: session?.stepIndex || 0, available: !!session && !resource.error && writable, now: clock, guided, durations: flowDurations,
    onAdvance: async (nextIndex, { signal }) => {
      if (!writable || busy) throw new Error('Finish your current action, then restart timed flow.');
      const response = await kitchenRequest(`/sessions/${id}`, { householdId, method: 'PATCH', body: { version: session.version, stepIndex: nextIndex, timers: session.timers || [] }, signal });
      if (signal.aborted || !activeRef.current) return false;
      setClock(Date.now()); setSession(response); return response;
    } });
  flowRef.current = flow;
  const tabPauseRef = useRef(null);
  tabPauseRef.current = () => {
    flow.pause(); guided.pause();
    microphoneGeneration.current++;
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    clearTimeout(stopTimeoutRef.current);
    void cancelAiRequest(voiceRef.current?.signal); voiceRef.current?.abort(); voiceRef.current = null; voiceModeRef.current = null; setVoiceBusy('');
  };
  useEffect(() => { if (!isActive) tabPauseRef.current?.(); }, [isActive]);
  const durations = sourceDurations(steps[session?.stepIndex || 0]);
  const update = async (overrides, label = "Update cooking session") => {
    const response = await mutate(label, `/sessions/${id}`, { version: session.version, stepIndex: session.stepIndex, timers: session.timers || [], ...overrides }, "PATCH", false);
    if (response) { setClock(Date.now()); setSession(response); }
  };
  const addTimer = event => {
    event.preventDefault();
    const seconds = Number(timer.minutes) * 60 + Number(timer.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 24 * 60 * 60) { setError("Set a timer between one second and 24 hours."); return; }
    const value = { id: crypto.randomUUID(), label: timer.label.trim() || "Cooking timer", endsAt: new Date(Date.now() + seconds * 1000).toISOString(), running: true, durationSeconds: seconds, acknowledged: false };
    update({ timers: [...(session.timers || []), value] }, "Start timer");
  };
  const ask = async event => { event.preventDefault(); const response = await mutate("Ask Sunny about this recipe", `/sessions/${id}/ask`, { question: question.trim() }, undefined, false); if (response) { setReply(response); if (response.session) setSession(response.session); } };
  const transcribe = async blob => {
    if (!activeRef.current || !tabActiveRef.current) return;
    if (!blob.size || blob.size > 5 * 1024 * 1024) { setError("Try a recording up to 60 seconds and 5 MB."); return; }
    const controller = new AbortController(); voiceRef.current = controller; voiceModeRef.current = "transcribe"; setVoiceBusy("Transcribing");
    try {
      const audioBase64 = await readPhoto(blob, controller.signal);
      const response = await kitchenRequest("/voice/transcribe", { householdId, body: { audioBase64, mimeType: blob.type }, signal: controller.signal });
      if (controller.signal.aborted || !activeRef.current) return;
      if (response.local !== true) throw new Error("The voice service did not confirm local processing.");
      setQuestion(response.text || ""); setNotice("Check the transcript, then ask Sunny.");
    } catch (failure) { if (!controller.signal.aborted && activeRef.current) setError(failure.message); }
    finally { if (voiceRef.current === controller && activeRef.current) { voiceRef.current = null; voiceModeRef.current = null; setVoiceBusy(""); } }
  };
  const record = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("This browser cannot record audio. Type your question instead."); return; }
    const generation = ++microphoneGeneration.current;
    setVoiceBusy("Requesting microphone access"); setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current || !tabActiveRef.current || generation !== microphoneGeneration.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream; discardRecordingRef.current = false;
      const mimeType = ["audio/webm", "audio/ogg", "audio/mp4"].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); clearTimeout(stopTimeoutRef.current); if (!activeRef.current) return; setRecording(false); recorderRef.current = null; if (!discardRecordingRef.current) transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" })); else setVoiceBusy(""); };
      recorder.onerror = () => { discardRecordingRef.current = true; stream.getTracks().forEach(track => track.stop()); if (activeRef.current) { setRecording(false); setVoiceBusy(""); setError("Microphone recording failed. Type your question or try again."); } };
      recorder.start(); setRecording(true); setVoiceBusy(""); stopTimeoutRef.current = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    } catch (failure) { if (generation === microphoneGeneration.current) { streamRef.current?.getTracks().forEach(track => track.stop()); if (activeRef.current) { setVoiceBusy(""); setError(failure.name === "NotAllowedError" ? "Microphone access was declined. You can still type your question." : "Could not start recording. Try again or type your question."); } } }
  };
  const finish = async () => {
    flow.stop();
    try {
      const mealSlot = session.mealSlot ? {planId: session.mealSlot.planId, dayIndex: session.mealSlot.dayIndex} : mealSlotFromParams(params);
      const fingerprint = JSON.stringify({ version: session.version, consumption, mealSlot });
      const latest = await mutate('Check current stock', '/bootstrap', undefined, 'GET', false);
      if (!latest) return;
      if (!Number.isInteger(latest.scope.revision) || latest.scope.revision < 1) throw new Error('Reload your kitchen before confirming this meal.');
      if (confirmationRequest.current?.fingerprint !== fingerprint) {
        const values = { version: session.version, confirmed: true, consumption: consumptionPayload(latest.pantry || [], consumption), mealSlot };
        confirmationRequest.current = { fingerprint, body: { ...values, aggregateRevision: latest.scope.revision, idempotencyKey: crypto.randomUUID() } };
      } else confirmationRequest.current.body = { ...confirmationRequest.current.body, aggregateRevision: latest.scope.revision };
      const response = await mutate("Confirm cooked meal", `/sessions/${id}/complete`, confirmationRequest.current.body);
      if (response) { guided.end(); setSession(response); setConfirmed(false); setNotice("Meal confirmed. Only your selected stock amounts were used."); }
    } catch (failure) { setError(failure.message); }
  };
  if (resource.loading && !session) return <div className="kitchen-empty" role="status">Loading cooking session…</div>;
  if (resource.error) return <div className="kitchen-error"><p>{resource.error}</p><Button className="kitchen-secondary" type="button" onClick={resource.reload}>Reload session</Button></div>;
  if (embedded && recipeId && session && session.recipeId !== recipeId) return <div className="kitchen-error" role="alert"><p>This cooking session belongs to another recipe.</p><Link className="kitchen-text-link" to={`/recipes/${session.recipeId}?${params}`}>Open the recipe for this session</Link></div>;
  if (!session) return <div className="kitchen-empty">Session unavailable. Choose a recipe or a recent session.</div>;
  return <>
    <header className="kitchen-cook-title"><div>{!embedded && <h1>{session.recipeTitle}</h1>}<div className="kitchen-cook-meta"><span className="kitchen-badge">{session.status === "completed" ? "Meal confirmed" : "Cooking session"}</span><span>{session.servings} servings</span></div></div><div className="kitchen-cook-links">{!embedded && <Link className="kitchen-text-link" to={`/recipes/${session.recipeId}`}>View recipe</Link>}<Button className="kitchen-secondary kitchen-refresh-session" type="button" aria-label="Refresh session" disabled={!!busy} onClick={resource.reload}><FaSyncAlt aria-hidden="true" /><span>Refresh session</span></Button></div></header>
    <div className="kitchen-grid-two kitchen-cook-grid"><section className="kitchen-panel kitchen-step"><div className="kitchen-panel-heading"><PanelHeading>Step {session.stepIndex + 1}<span className="kitchen-step-total"> / {session.steps.length}</span></PanelHeading><span className="kitchen-step-source">Source instruction</span></div><progress value={session.stepIndex + 1} max={Math.max(1, session.steps.length)} aria-label="Recipe progress" /><CookingModeControls key={cookingIdentity} mode={cookingMode} onModeChange={mode => setModeState({ identity: cookingIdentity, mode })} guided={guided} flow={flow} steps={steps} stepIndex={session.stepIndex} durations={flowDurations} timingSources={stepTiming.sources} overridden={stepTiming.overridden} disabled={!writable || !!busy} onDurationChange={stepTiming.change} onDurationReset={stepTiming.reset} /><p className="kitchen-step-text">{session.steps[session.stepIndex]}</p>{durations.length > 0 && <div className="kitchen-source-timers"><span className="kitchen-help">Time stated in this step:</span>{durations.map(item => <Button key={item.seconds} className="kitchen-secondary" disabled={!writable || !!busy} onClick={() => setTimer({ label: `Step ${session.stepIndex + 1}`, minutes: String(Math.floor(item.seconds / 60)), seconds: String(item.seconds % 60) })}>Set {item.label}</Button>)}<p className="kitchen-help">Check or adjust the timer fields, then press Start timer.</p></div>}<div className="kitchen-actions kitchen-step-actions"><Button className="kitchen-secondary" type="button" disabled={!writable || !!busy || flow.phase === 'advancing' || session.stepIndex === 0} onClick={() => { flow.stop(); update({ stepIndex: session.stepIndex - 1 }, "Previous step"); }}>Previous</Button><Button className="kitchen-primary" type="button" disabled={!writable || !!busy || flow.phase === 'advancing' || session.stepIndex >= session.steps.length - 1} onClick={() => { flow.stop(); update({ stepIndex: session.stepIndex + 1 }, "Next step"); }}>Done, next step</Button></div></section>
    <section className="kitchen-panel kitchen-timers"><div className="kitchen-panel-heading"><PanelHeading>Timers</PanelHeading><FaRegClock aria-hidden="true" /></div><p>Saved end times stay accurate when you return.</p>
      {guided.alerts.length > 0 && <div className="kitchen-due-alerts" role="alert">{guided.alerts.map(alert => <div key={alert.key}><p>{alert.text}</p><Button className="kitchen-secondary" disabled={!writable || !!busy} onClick={() => update({ timers: session.timers.map(value => value.id === alert.timerId ? { ...value, running: false, acknowledged: true } : value) }, "Acknowledge timer")}>Acknowledge {session.timers.find(value => value.id === alert.timerId)?.label}</Button></div>)}</div>}
      <p className="kitchen-help">Keep this screen open for audio reminders. Check food as instructed; a timer does not confirm doneness.</p><ul className="kitchen-timer-list">{(session.timers || []).map(item => <li key={item.id}><div><strong>{item.label}</strong><span className="kitchen-timer-count" role="timer">{item.running ? timerSeconds(item, clock) ? timerLabel(timerSeconds(item, clock)) : "Finished" : "Stopped"}</span></div>{writable && <div className="kitchen-actions">{item.running && <Button className="kitchen-secondary" type="button" disabled={!!busy} onClick={() => update({ timers: session.timers.map(value => value.id === item.id ? { ...value, running: false, endsAt: null } : value) }, "Stop timer")}>Stop</Button>}<Button className="kitchen-text-button" type="button" disabled={!!busy} onClick={() => update({ timers: session.timers.filter(value => value.id !== item.id) }, "Remove timer")}>Remove</Button></div>}</li>)}</ul>{!session.timers?.length && <p className="kitchen-empty-small">Add a timer when you need one.</p>}{writable && <form onSubmit={addTimer}><fieldset disabled={!!busy}><Field>Timer name<input maxLength="100" value={timer.label} onChange={event => setTimer({ ...timer, label: event.target.value })} placeholder="Resting time" /></Field><div className="kitchen-form-grid"><Field>Minutes<input type="number" min="0" max="1440" value={timer.minutes} onChange={event => setTimer({ ...timer, minutes: event.target.value })} /></Field><Field>Seconds<input type="number" min="0" max="59" value={timer.seconds} onChange={event => setTimer({ ...timer, seconds: event.target.value })} /></Field></div><Button className="kitchen-primary" type="submit">{busy === "Start timer" ? "Starting timer…" : "Start timer"}</Button></fieldset></form>}</section></div>
    <details className="kitchen-details kitchen-source-overview"><summary>All source steps</summary><ol>{session.steps.map((step, index) => <li key={index} className={index === session.stepIndex ? "is-current" : ""}>{step}</li>)}</ol></details>
    <section className="kitchen-panel kitchen-assistant"><PanelHeading>Ask Sunny</PanelHeading><p>Sunny uses this recipe’s steps. Missing details stay unknown.</p><form onSubmit={ask}><Field>Your question<textarea maxLength="1000" rows="3" required value={question} disabled={!!busy || recording || !!voiceBusy || !writable} onChange={event => setQuestion(event.target.value)} placeholder="What should I do in this step?" /></Field><div className="kitchen-actions kitchen-action-bar"><Button className="kitchen-primary" type="submit" disabled={!writable || !!busy || !!voiceBusy || recording}>{busy === "Ask Sunny about this recipe" ? "Checking source steps…" : "Ask Sunny"}</Button>{recording ? <><Button className="kitchen-secondary" type="button" onClick={() => recorderRef.current?.stop()}>Stop & transcribe</Button><Button className="kitchen-text-button" type="button" onClick={() => { discardRecordingRef.current = true; recorderRef.current?.stop(); }}>Cancel recording</Button></> : <Button className="kitchen-secondary" type="button" disabled={!!voiceBusy || !!busy || !writable} onClick={record}><FaMicrophone aria-hidden="true" />Record a question</Button>}</div><p className="kitchen-help">Record asks for microphone access. Up to 60 seconds; check the local transcript before sending.</p>{(voiceBusy || recording) && <p role="status">{recording ? "Recording… press Stop when finished." : `${voiceBusy}…`}</p>}{voiceBusy && voiceRef.current && <Button className="kitchen-text-button" type="button" onClick={() => { void cancelAiRequest(voiceRef.current?.signal); voiceRef.current?.abort(); voiceRef.current = null; voiceModeRef.current = null; setVoiceBusy(""); }}>Cancel voice request</Button>}</form>
      {reply && <div className="kitchen-answer"><h3>{reply.supported ? "From the recipe" : "Not in the recipe"}</h3><p>{reply.answer}</p>{reply.citations?.length > 0 && <ul>{reply.citations.map((item, index) => <li key={index}><strong>Step {item.stepIndex + 1}</strong><blockquote>{item.text}</blockquote></li>)}</ul>}</div>}
      {!!session.messages?.length && <details className="kitchen-details"><summary>Saved conversation</summary><ul className="kitchen-conversation">{session.messages.map((message, index) => <li key={index}><strong>{message.role === "user" ? "You" : "Sunny"}</strong><p>{message.content}</p></li>)}</ul></details>}
    </section>
    <section className="kitchen-panel kitchen-complete" id="confirm-meal"><PanelHeading>{session.status === "completed" ? "Meal confirmed" : "Confirm your meal"}</PanelHeading>{session.status === "completed" ? <><p><FaCheck aria-hidden="true" />This meal is recorded. Stock won’t be used again.</p><AfterCooking session={session} />{embedded && onCookAgain && <Button type="button" className="kitchen-secondary" onClick={() => { flow.stop(); guided.end(); onCookAgain(); }}>Cook this recipe again</Button>}</> : <><p>Enter the stock amounts you used. Only confirmed amounts are deducted.</p>{writable && <><div className="kitchen-consumption">{(data.pantry || []).map(lot => <Field key={lot.id}>{lot.ingredient}<span className="kitchen-help">{lot.quantity === null ? "Quantity unknown. Update Pantry first." : `${lot.quantity} ${lot.unit || ""} available`}{lot.useBy ? ` · use by ${lot.useBy}` : ""}</span><input type="number" step="any" min="0.000001" max={lot.quantity ?? undefined} disabled={!!busy || lot.quantity === null} value={consumption[lot.id]?.quantity || ""} placeholder={`Amount used${lot.unit ? ` (${lot.unit})` : ""}`} onChange={event => { setConfirmed(false); setConsumption({ ...consumption, [lot.id]: event.target.value ? { quantity: event.target.value, version: lot.version } : "" }); }} /></Field>)}</div>{!data.pantry?.length && <p className="kitchen-empty-small">No stock to deduct. You can still confirm your meal.</p>}<Field className="kitchen-checkbox"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} /><span>I cooked this meal and checked the amounts used.</span></Field><div className="kitchen-action-bar"><Button className="kitchen-primary" type="button" disabled={!confirmed || !!busy} onClick={finish}>{busy === "Confirm cooked meal" || busy === "Check current stock" ? "Confirming meal…" : "Confirm cooked meal"}</Button></div><p className="kitchen-help">Meal activity is recorded only with your consent.</p></>}</> }</section>
  </>;
}

export default function CookAlong() { const { id } = useParams(); return <KitchenShell title="Cook along" intro="Follow the recipe, set timers and ask Sunny."><CookContent key={id} id={id} /></KitchenShell>; }
