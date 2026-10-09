# Guided cooking

Cook Along is a tab beside **At a glance** inside recipe details. Choose **Step by step** to read individual instructions, or **Timed flow** to read an instruction, wait its cooking duration and move to the next. Both modes use the recipe's original instructions.

Timed flow fills cooking waits from the recipe automatically. Start directly, or open **Edit timings** to adjust a step and reset it to the recipe time later. A time range uses its upper end; sequential timed actions are added and clear parallel actions use the longer wait. Per-side timings account for both sides. A step with no stated duration has no timed wait; unclear timings are identified for an optional adjustment. The system does not invent an unstated cooking time or treat a temperature as a duration.

Use **Pause**, **Resume** or **Stop** during timed flow. Switching to **At a glance** pauses narration and the flow, keeping the current step, timing edits and separate timers. Return and resume explicitly. **Done, next step** remains available for manual control; elapsed time never confirms that food is cooked.

Explicit numeric times in a step can fill the timer form. The cook checks or edits the duration and presses **Start timer**. Multiple timers use absolute UTC end timestamps stored with the cooking session and its version. Returning to the page recomputes remaining time, with a due alert instead of an outdated near-end reminder. Acknowledgment is persisted through the existing compare-and-swap session update. A conflicting update asks the cook to reload rather than overwrite another person's changes.

Keep the page open for audible reminders. Mobile browsers can suspend pages or block playback after a screen lock. Timers resume against the original end timestamp, but this web feature cannot promise a background alarm while the browser is suspended. Written steps and timers remain usable if speech fails. Stopping guidance mutes the local audio channel.

## Local speech and provenance

- English: `piper-tts==1.8.0`, `en_US-ljspeech-medium`, 22,050 Hz mono PCM.
- Voice weights SHA-256: `6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22`.
- Voice source revision: `c10ece1aade47bb51c153c893d14e5bf8e5b7117` in the official `rhasspy/piper-voices` repository.
- English neural synthesis uses a bounded child process with two CPU inference threads, a 25-second synthesis deadline, and a maximum three-minute WAV per request. It preserves GPU capacity for recipe intent, vision and embeddings.
- Vietnamese uses the explicitly reported local eSpeak NG fallback. This is a different voice quality and engine, not the English neural voice.
- No speech model is downloaded while serving a cooking request. Run `deploy/provision-local-voice.py` as an explicit setup operation or the documented `deploy/local-up.sh`.
- Exact, freshly verified public source steps can use a disk cache keyed by recipe, text and engine/model version. Private session steps and user-entered text remain ephemeral. Permissions and source visibility are rechecked before serving source audio.

The original catalog checked on 2026-10-08 contained 10,000 public recipes and 32,118 source steps; the longest extracted step had 1,344 characters. This is a bounds check, not a listening evaluation of every generated voice.

The provisioning manifest records the [Piper engine source and GPL-3.0 license](https://github.com/OHF-Voice/piper1-gpl), and the [voice model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/medium/MODEL_CARD), which declares the underlying LJSpeech dataset public domain. Voice attribution does not grant rights to recipe text or photographs.
