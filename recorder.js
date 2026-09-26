// One take from the microphone, raw (no browser clean-up filters: they distort the voice for training).
// startTake() resolves once recording has started; take.stop() ends it early; take.done gives the audio.

const MAX_TAKE_MS = 15000; // phrases, not stories; also caps upload size

export async function startTake() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  let discarded = false;
  const done = new Promise((resolve) => {
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      resolve(discarded ? null : new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
  });
  recorder.start();
  const timer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_TAKE_MS);
  const stop = () => recorder.state === 'recording' && recorder.stop();
  return { done, stop, discard: () => { discarded = true; stop(); } };
}

export const canRecord = () => Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
