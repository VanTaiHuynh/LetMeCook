export function requestFailure(status, message, service = 'This service', conflictMessage) {
  let text;
  if (status === 401) text = 'Your session has expired. Log in again to continue.';
  else if (status === 403) text = 'You do not have access to this action. Log in with an account that has access.';
  else if (status === 409) text = conflictMessage || 'This changed elsewhere. Reload the latest version before trying again.';
  else if (status === 429) text = 'Too many requests. Wait a moment, then try again.';
  else if (status === 504 || status === 408) text = `${service} took too long. Try again.`;
  else if (status >= 500) text = `${service} is temporarily unavailable. Try again in a moment.`;
  else text = typeof message === 'string' && message.trim() ? message.trim() : 'This request could not be completed. Try again.';
  const error = new Error(text);
  error.status = status;
  return error;
}

export async function fetchWithRecovery(url, options) {
  try { return await fetch(url, options); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    const failure = new Error('Connection lost. Check your network, then try again.');
    failure.cause = error;
    throw failure;
  }
}

export async function readJSON(response) {
  try { return await response.json(); }
  catch (error) { if (error.name === "AbortError") throw error; return null; }
}
