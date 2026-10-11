// The status line under the editor. Screen readers announce changes to it.
export function mountStatus(container) {
  container.innerHTML = '<p role="status" class="save-status"></p>';
}

export function showSaved(container, count) {
  const status = container.querySelector('[role="status"]');
  const changes = count === 1 ? '1 change' : `${count} changes`;
  status.textContent = `Saved ${changes} at ${new Date().toLocaleTimeString()}`;
}
