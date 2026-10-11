// Session ids: a timestamp plus a random suffix.
export function newSessionId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
