const PLAYER_CHANNEL = 'abceed-player-keys-v1';
const PLAYER_APP = 'https://app.abceed.com';
const PLAYER_CONTENT = 'https://private.abceed.com';
const PLAYER_ACTIONS = { ArrowLeft: 'back', ArrowRight: 'forward', ' ': 'toggle' };

function playerButtonVisible(element) {
  if (!element || element.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"],.disabled,.is-disabled') || element.disabled) return false;
  const win = element.ownerDocument.defaultView;
  const rect = element.getBoundingClientRect();
  const style = win.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth && style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
}

export function playerControls(doc) {
  const candidates = [...doc.querySelectorAll('.sound-controller-main-component')].map(container => {
    // Verified abceed layout: previous track, -3s, play/pause, +3s, next track.
    const buttons = [...container.querySelectorAll(':scope > a.sound-controller_item')];
    return buttons.length === 5 ? { back: buttons[1], toggle: buttons[2], forward: buttons[3] } : null;
  }).filter(controls => controls && Object.values(controls).some(playerButtonVisible));
  if (candidates.length !== 1) return {};
  return Object.fromEntries(Object.entries(candidates[0]).filter(([, button]) => playerButtonVisible(button)));
}

export function playerKeyAction(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const action = PLAYER_ACTIONS[event.key];
  if (!action) return null;
  const excluded = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-abceed-ai-ui],[role="textbox"],[role="slider"],[role="combobox"],[role="listbox"],[role="menu"],[role="tablist"]';
  for (const node of event.composedPath()) {
    if (node.closest?.(excluded)) return null;
    if (action === 'toggle' && node.closest?.('button,a[href],summary,[role="button"],[role="checkbox"],[role="switch"]')) return null;
  }
  return action;
}

export function attachPlayerKeys(doc, win) {
  const embedded = win.top !== win;
  if (embedded && win.location.origin !== PLAYER_CONTENT) return { destroy() {} };
  let available = {}, timer, pointerControl;
  const onPointer = event => {
    const target = event.target?.closest?.('.sound-controller-main-component > a.sound-controller_item');
    pointerControl = target && Object.values(playerControls(doc)).includes(target) ? target : undefined;
  };
  const execute = action => {
    const button = playerControls(doc)[action];
    if (!button) return false;
    button.click();
    return true;
  };
  const onKey = event => {
    if (event.key === 'Tab') pointerControl = undefined;
    const action = playerKeyAction(event);
    if (!action || !(embedded ? available[action] : playerControls(doc)[action])) return;
    // Mouse focus should not acquire a keyboard focus ring when seeking.
    // Tab navigation deliberately retains focus and its accessible indicator.
    if (pointerControl && doc.activeElement === pointerControl && Object.values(playerControls(doc)).includes(pointerControl)) {
      pointerControl.blur();
      pointerControl = undefined;
    }
    // Holding Space must not rapidly toggle playback. Arrow repeats remain useful.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === 'toggle' && event.repeat) return;
    if (embedded) win.parent.postMessage({ channel: PLAYER_CHANNEL, type: 'action', action }, PLAYER_APP);
    else execute(action);
  };
  const query = () => win.parent.postMessage({ channel: PLAYER_CHANNEL, type: 'query' }, PLAYER_APP);
  const onMessage = event => {
    const data = event.data;
    if (data?.channel !== PLAYER_CHANNEL) return;
    if (embedded) {
      if (event.source === win.parent && event.origin === PLAYER_APP && data.type === 'state') {
        available = Object.fromEntries(['back', 'toggle', 'forward'].map(action => [action, data.available?.[action] === true]));
      }
      return;
    }
    if (event.origin !== PLAYER_CONTENT) return;
    const frame = [...doc.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source);
    if (!frame) return;
    if (data.type === 'query') {
      const controls = playerControls(doc);
      event.source.postMessage({ channel: PLAYER_CHANNEL, type: 'state', available: Object.fromEntries(Object.keys(controls).map(action => [action, true])) }, PLAYER_CONTENT);
    } else if (data.type === 'action' && doc.activeElement === frame && ['back', 'toggle', 'forward'].includes(data.action)) execute(data.action);
  };
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('message', onMessage);
  if (embedded) { query(); timer = win.setInterval(query, 500); win.addEventListener('focus', query); }
  return { destroy() {
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('message', onMessage);
    win.removeEventListener('focus', query);
    win.clearInterval(timer);
  } };
}
