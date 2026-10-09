import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelAiRequest } from '../../utils/aiControl';
import { readPhoto } from '../../utils/sunny';

export default function useCookingMicrophone({ transcribe, onText, setError, setNotice }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const recorder = useRef(null), stream = useRef(null), timeout = useRef(null), request = useRef(null);
  const active = useRef(true), discard = useRef(false), permissionGeneration = useRef(0), permissionPending = useRef(false);
  const invalidatePermission = useCallback(() => { permissionGeneration.current++; permissionPending.current = false; }, []);
  useEffect(() => { active.current = true; return () => { active.current = false; invalidatePermission(); discard.current = true; request.current?.abort(); if (recorder.current?.state === 'recording') recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); clearTimeout(timeout.current); }; }, [invalidatePermission]);
  const upload = async blob => {
    if (!active.current) return;
    if (!blob.size || blob.size > 5 * 1024 * 1024) { setError('Try a recording up to 60 seconds and 5 MB.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy('Transcribing');
    try {
      const audioBase64 = await readPhoto(blob, controller.signal);
      const value = await transcribe({ audioBase64, mimeType: blob.type }, controller.signal);
      if (controller.signal.aborted || !active.current) return;
      if (value.local !== true) throw new Error('Local transcription is unavailable. Type your question instead.');
      onText(value.text || ''); setNotice('Check the transcript, then ask Sunny.');
    } catch (failure) { if (!controller.signal.aborted && active.current) setError(failure.message); }
    finally { if (request.current === controller && active.current) { request.current = null; setBusy(''); } }
  };
  const start = async () => {
    if (permissionPending.current || recorder.current || request.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('This browser cannot record audio. Type your question instead.'); return; }
    const generation = ++permissionGeneration.current; permissionPending.current = true;
    setBusy('Requesting microphone access'); setError('');
    try {
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current || generation !== permissionGeneration.current) { capture.getTracks().forEach(track => track.stop()); return; }
      stream.current = capture; discard.current = false;
      const mimeType = ['audio/webm', 'audio/ogg', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
      const microphone = new MediaRecorder(capture, mimeType ? { mimeType } : undefined), chunks = [];
      recorder.current = microphone;
      microphone.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      microphone.onstop = () => { capture.getTracks().forEach(track => track.stop()); clearTimeout(timeout.current); if (!active.current) return; setRecording(false); recorder.current = null; if (!discard.current) void upload(new Blob(chunks, { type: microphone.mimeType || mimeType || 'audio/webm' })); else setBusy(''); };
      microphone.onerror = () => { discard.current = true; capture.getTracks().forEach(track => track.stop()); if (active.current) { setRecording(false); setBusy(''); setError('Recording failed. Type your question or try again.'); } };
      microphone.start(); setRecording(true); setBusy(''); timeout.current = setTimeout(() => { if (microphone.state === 'recording') microphone.stop(); }, 60_000);
    } catch (failure) { if (generation === permissionGeneration.current) { stream.current?.getTracks().forEach(track => track.stop()); if (active.current) { setBusy(''); setError(failure.name === 'NotAllowedError' ? 'Microphone access was declined. You can still type your question.' : 'Could not start recording. Type your question or try again.'); } } }
    finally { if (generation === permissionGeneration.current) permissionPending.current = false; }
  };
  const stop = () => recorder.current?.stop();
  const cancel = () => { invalidatePermission(); discard.current = true; if (recorder.current?.state === 'recording') recorder.current.stop(); void cancelAiRequest(request.current?.signal); request.current?.abort(); request.current = null; setBusy(''); };
  return { recording, busy, start, stop, cancel };
}
