/**
 * ST-FLASH presentation and callback wiring.
 *
 * This module deliberately does not decide when a session starts, which
 * preset to load, or how a response is reconciled. It only renders controls,
 * mirrors settings, and forwards user intent to the controller callbacks.
 */

export const UI_NAMESPACE = 'st_flash';

export const DEFAULT_PRESET_NAMES = Object.freeze({
  anchor: 'FF5.2 Anchor',
  capsule: 'Capsule',
  flash: 'FF5.2 Flash',
  landing: 'FF5.2 Landing',
  continuation: 'FF5.2 Continuation',
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  profiles: Object.freeze({ anchor: '', flash: '', landing: '' }),
  presets: DEFAULT_PRESET_NAMES,
  landingBaselineMessages: 5,
});

export const SETTING_FIELD_IDS = Object.freeze({
  enabled: 'st_flash_enabled',
  profileA: 'st_flash_profile_a',
  profileB: 'st_flash_profile_b',
  profileC: 'st_flash_profile_c',
  profileAnchor: 'st_flash_profile_a',
  profileFlash: 'st_flash_profile_b',
  profileLanding: 'st_flash_profile_c',
  presetAnchor: 'st_flash_preset_anchor',
  presetCapsule: 'st_flash_preset_capsule',
  presetFlash: 'st_flash_preset_flash',
  presetLanding: 'st_flash_preset_landing',
  presetContinuation: 'st_flash_preset_continuation',
  landingBaselineMessages: 'st_flash_landing_baseline_count',
});

export function flashStatusPresentation(state = {}) {
  const phase = state.phase || state.session?.phase || '';
  if (phase === 'CAPSULING') {
    return {
      phase,
      label: 'Generating capsule',
      detail: 'Building the local context for Flash…',
      showProgress: true,
      showTurn: false,
      canLand: false,
    };
  }
  return {
    phase,
    label: state.label ?? 'Active Flash',
    detail: state.detail ?? 'ST-FLASH session is active.',
    showProgress: false,
    showTurn: phase === 'FLASH',
    canLand: state.canLand !== false && phase === 'FLASH',
  };
}

const noop = () => {};

function isElement(value) {
  return Boolean(value && typeof value === 'object' && typeof value.querySelector === 'function');
}

function getDocument(root) {
  if (root?.nodeType === 9) return root;
  if (root?.ownerDocument) return root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  return null;
}

function getRoot(root, doc) {
  if (isElement(root)) return root;
  return doc;
}

function query(root, selector) {
  if (!root || typeof root.querySelector !== 'function') return null;
  return root.querySelector(selector);
}

function byId(root, id) {
  const doc = getDocument(root);
  if (root && root.id === id) return root;
  return query(getRoot(root, doc), `#${id}`) || doc?.getElementById?.(id) || null;
}

function makeElement(doc, tag, attributes = {}, text = null) {
  if (!doc?.createElement) return null;
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (name === 'className') element.className = value;
    else if (name === 'textContent') element.textContent = value;
    else element.setAttribute(name, String(value));
  }
  if (text != null) element.textContent = text;
  return element;
}

function append(parent, child) {
  if (parent && child) parent.appendChild(child);
  return child;
}

function resolveRuntimeRoot(root, doc, textarea) {
  if (root?.id === 'send_textarea' && root.parentElement) return root.parentElement;
  // A Document has querySelector too, but it cannot accept arbitrary sibling
  // elements via appendChild. When createUi() is called without an explicit
  // runtime root, fall through to SillyTavern's composer host instead.
  if (isElement(root) && root.nodeType !== 9) return root;
  if (textarea?.parentElement) return textarea.parentElement;
  return query(doc, '#send_form') || query(doc, '#send_textarea')?.parentElement || doc?.body || doc;
}

function resolveTextarea(root, doc, candidate) {
  if (candidate && typeof candidate !== 'string' && typeof candidate.value === 'string') return candidate;
  if (typeof candidate === 'string') return query(getRoot(root, doc), candidate) || query(doc, candidate);
  return query(getRoot(root, doc), '#send_textarea') || doc?.getElementById?.('send_textarea') || null;
}

function toText(value) {
  if (value == null) return '';
  return String(value);
}

function safeInteger(value, fallback = DEFAULT_SETTINGS.landingBaselineMessages) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(99, Math.trunc(number)));
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const profiles = source.profiles && typeof source.profiles === 'object' ? source.profiles : {};
  const presets = source.presets && typeof source.presets === 'object' ? source.presets : {};
  return {
    enabled: source.enabled == null ? DEFAULT_SETTINGS.enabled : Boolean(source.enabled),
    profiles: {
      anchor: toText(profiles.anchor ?? profiles.a ?? source.profileAnchor ?? source.profileA ?? DEFAULT_SETTINGS.profiles.anchor),
      flash: toText(profiles.flash ?? profiles.b ?? source.profileFlash ?? source.profileB ?? DEFAULT_SETTINGS.profiles.flash),
      landing: toText(profiles.landing ?? profiles.c ?? source.profileLanding ?? source.profileC ?? DEFAULT_SETTINGS.profiles.landing),
    },
    presets: {
      anchor: toText(presets.anchor ?? source.presetAnchor ?? DEFAULT_PRESET_NAMES.anchor),
      capsule: toText(presets.capsule ?? source.presetCapsule ?? DEFAULT_PRESET_NAMES.capsule),
      flash: toText(presets.flash ?? source.presetFlash ?? DEFAULT_PRESET_NAMES.flash),
      landing: toText(presets.landing ?? source.presetLanding ?? DEFAULT_PRESET_NAMES.landing),
      continuation: toText(presets.continuation ?? source.presetContinuation ?? DEFAULT_PRESET_NAMES.continuation),
    },
    landingBaselineMessages: safeInteger(
      source.landingBaselineMessages ?? source.landingBaselineCount,
      DEFAULT_SETTINGS.landingBaselineMessages,
    ),
  };
}

function fieldValue(root, id) {
  const field = byId(root, id);
  if (!field) return null;
  if (field.type === 'checkbox') return Boolean(field.checked);
  return field.value ?? '';
}

function setFieldValue(root, id, value) {
  const field = byId(root, id);
  if (!field) return false;
  if (field.type === 'checkbox') field.checked = Boolean(value);
  else field.value = toText(value);
  return true;
}

function normalizeProfileEntries(profiles) {
  const source = Array.isArray(profiles)
    ? profiles
    : (Array.isArray(profiles?.profiles) ? profiles.profiles : Object.entries(profiles || {}).map(([id, value]) => ({ id, name: value })));
  const entries = [];
  const seen = new Set();
  for (const item of source) {
    const profileId = typeof item === 'string'
      ? item
      : (item?.id ?? item?.profileId ?? item?.value ?? item?.name ?? item?.label);
    if (profileId == null || String(profileId).trim() === '') continue;
    const id = String(profileId);
    if (seen.has(id)) continue;
    seen.add(id);
    const label = typeof item === 'string'
      ? item
      : (item?.name ?? item?.label ?? item?.title ?? id);
    entries.push({ id, label: String(label) });
  }
  return entries;
}

function selectedProfileValue(selected, key, index) {
  if (Array.isArray(selected)) return selected[index] ?? '';
  const source = selected?.profiles && typeof selected.profiles === 'object' ? selected.profiles : selected;
  return source?.[key] ?? source?.[['a', 'b', 'c'][index]] ?? '';
}

/** Populate the three ST-FLASH Connection Manager profile selectors. */
export function setProfileOptions(root, profiles = [], selected = {}) {
  const target = root || getDocument();
  const entries = normalizeProfileEntries(profiles);
  const fields = [
    [SETTING_FIELD_IDS.profileAnchor, 'anchor', 0],
    [SETTING_FIELD_IDS.profileFlash, 'flash', 1],
    [SETTING_FIELD_IDS.profileLanding, 'landing', 2],
  ];
  for (const [id, key, index] of fields) {
    const select = byId(target, id);
    if (!select) continue;
    const current = selectedProfileValue(selected, key, index) || select.value;
    if (select.replaceChildren) select.replaceChildren();
    else while (select.firstChild) select.removeChild(select.firstChild);
    append(select, makeElement(select.ownerDocument || getDocument(target), 'option', { value: '' }, 'Select a connection profile…'));
    for (const entry of entries) append(select, makeElement(select.ownerDocument || getDocument(target), 'option', { value: entry.id }, entry.label));
    if (current && !entries.some((entry) => entry.id === String(current))) {
      append(select, makeElement(select.ownerDocument || getDocument(target), 'option', { value: current }, `${current} (saved)`));
    }
    select.value = current || '';
  }
  return entries;
}

/** Read the ST-FLASH settings fields without changing them. */
export function readSettings(root) {
  const source = root || getDocument();
  const settings = normalizeSettings({
    enabled: fieldValue(source, SETTING_FIELD_IDS.enabled),
    profiles: {
      anchor: fieldValue(source, SETTING_FIELD_IDS.profileAnchor),
      flash: fieldValue(source, SETTING_FIELD_IDS.profileFlash),
      landing: fieldValue(source, SETTING_FIELD_IDS.profileLanding),
    },
    presets: {
      anchor: fieldValue(source, SETTING_FIELD_IDS.presetAnchor),
      capsule: fieldValue(source, SETTING_FIELD_IDS.presetCapsule),
      flash: fieldValue(source, SETTING_FIELD_IDS.presetFlash),
      landing: fieldValue(source, SETTING_FIELD_IDS.presetLanding),
      continuation: fieldValue(source, SETTING_FIELD_IDS.presetContinuation),
    },
    landingBaselineMessages: fieldValue(source, SETTING_FIELD_IDS.landingBaselineMessages),
  });
  return settings;
}

/** Apply settings to the ST-FLASH fields. This does not dispatch events. */
export function applySettings(root, settings = {}) {
  const target = root || getDocument();
  const value = normalizeSettings(settings);
  setFieldValue(target, SETTING_FIELD_IDS.enabled, value.enabled);
  setFieldValue(target, SETTING_FIELD_IDS.profileAnchor, value.profiles.anchor);
  setFieldValue(target, SETTING_FIELD_IDS.profileFlash, value.profiles.flash);
  setFieldValue(target, SETTING_FIELD_IDS.profileLanding, value.profiles.landing);
  setFieldValue(target, SETTING_FIELD_IDS.presetAnchor, value.presets.anchor);
  setFieldValue(target, SETTING_FIELD_IDS.presetCapsule, value.presets.capsule);
  setFieldValue(target, SETTING_FIELD_IDS.presetFlash, value.presets.flash);
  setFieldValue(target, SETTING_FIELD_IDS.presetLanding, value.presets.landing);
  setFieldValue(target, SETTING_FIELD_IDS.presetContinuation, value.presets.continuation);
  setFieldValue(target, SETTING_FIELD_IDS.landingBaselineMessages, value.landingBaselineMessages);
  return value;
}

/** Bind ST-FLASH settings events to a persistence callback supplied by the controller. */
export function bindSettingsUI(options = {}, legacyOptions = {}) {
  const normalizedOptions = isElement(options) || options?.nodeType === 9
    ? { ...legacyOptions, root: options }
    : (options || {});
  const root = normalizedOptions.root;
  const doc = getDocument(root);
  const target = getRoot(root, doc);
  const onChange = typeof normalizedOptions.onChange === 'function' ? normalizedOptions.onChange : noop;
  const onInput = typeof normalizedOptions.onInput === 'function' ? normalizedOptions.onInput : noop;
  const initial = normalizedOptions.initial ?? normalizedOptions.settings;
  if (initial) applySettings(target, initial);
  if (normalizedOptions.profileOptions) {
    setProfileOptions(target, normalizedOptions.profileOptions, initial || normalizedOptions.selectedProfiles);
  }

  const fields = [...new Set(Object.values(SETTING_FIELD_IDS))]
    .map((id) => byId(target, id))
    .filter(Boolean);
  const listeners = [];
  const emitChange = (event, callback = onChange) => callback(readSettings(target), event);
  for (const field of fields) {
    const eventName = field.type === 'checkbox' || field.tagName === 'SELECT' ? 'change' : 'input';
    const callback = eventName === 'input' ? onInput : onChange;
    const handler = (event) => emitChange(event, callback);
    field.addEventListener?.(eventName, handler);
    listeners.push({ field, eventName, handler });
    // ST-FLASH text and number fields also persist when the user leaves the field.
    if (eventName === 'input') {
      const changeHandler = (event) => emitChange(event, onChange);
      field.addEventListener?.('change', changeHandler);
      listeners.push({ field, eventName: 'change', handler: changeHandler });
    }
  }

  return {
    root: target,
    read: () => readSettings(target),
    getSettings: () => readSettings(target),
    set: (value) => applySettings(target, value),
    setProfileOptions: (profiles, selected) => setProfileOptions(target, profiles, selected ?? readSettings(target).profiles),
    destroy: () => listeners.splice(0).forEach(({ field, eventName, handler }) => field.removeEventListener?.(eventName, handler)),
  };
}

function makeNoopController() {
  return {
    element: null,
    show: () => null,
    hide: () => null,
    setState: () => null,
    setError: () => null,
    setCallbacks: () => null,
    isVisible: () => false,
    destroy: noop,
  };
}

/** Mount the ST-FLASH approval/decline bar next to SillyTavern's composer. */
export function mountDecisionBar(options = {}, legacyCallbacks = {}) {
  const normalizedOptions = isElement(options) || options?.nodeType === 9
    ? { ...legacyCallbacks, root: options }
    : (options || {});
  const root = normalizedOptions.root;
  const doc = getDocument(root);
  if (!doc?.createElement) return makeNoopController();
  const targetRoot = getRoot(root, doc);
  const textarea = resolveTextarea(targetRoot, doc, normalizedOptions.textarea);
  const host = resolveRuntimeRoot(normalizedOptions.runtimeRoot || targetRoot, doc, textarea);
  const existing = byId(doc, 'st_flash_decision_bar');
  const bar = existing || makeElement(doc, 'section', {
    id: 'st_flash_decision_bar',
    className: 'st_flash_runtime st_flash_decision_bar',
    'data-st-flash': 'decision-bar',
    'aria-label': 'ST-FLASH decision',
    role: 'group',
    hidden: 'hidden',
  });
  if (!bar) return makeNoopController();

  let label = query(bar, '[data-st-flash-role="decision-label"]');
  let hint = query(bar, '[data-st-flash-role="decision-hint"]');
  let actionGroup = query(bar, '[data-st-flash-role="actions"]');
  let enterButton = query(bar, '[data-st-flash-action="enter-flash"]');
  let normalButton = query(bar, '[data-st-flash-action="answer-normally"]');
  let cancelButton = query(bar, '[data-st-flash-action="cancel"]');
  if (!label || !hint || !actionGroup || !enterButton || !normalButton || !cancelButton) {
    bar.replaceChildren?.();
    label = makeElement(doc, 'span', { className: 'st_flash_bar_label', 'data-st-flash-role': 'decision-label' });
    const title = makeElement(doc, 'strong', {}, 'ST-FLASH');
    hint = makeElement(doc, 'span', { className: 'st_flash_bar_hint', 'data-st-flash-role': 'decision-hint' }, 'Choose how to handle this turn.');
    append(label, title);
    append(label, hint);
    actionGroup = makeElement(doc, 'div', { className: 'st_flash_action_group', 'data-st-flash-role': 'actions' });
    enterButton = makeElement(doc, 'button', {
      id: 'st_flash_enter',
      type: 'button',
      className: 'st_flash_button st_flash_button_primary',
      'data-st-flash-action': 'enter-flash',
    }, 'Enter Flash');
    normalButton = makeElement(doc, 'button', {
      id: 'st_flash_answer_normally',
      type: 'button',
      className: 'st_flash_button',
      'data-st-flash-action': 'answer-normally',
    }, 'Answer Normally');
    cancelButton = makeElement(doc, 'button', {
      id: 'st_flash_cancel',
      type: 'button',
      className: 'st_flash_button',
      'data-st-flash-action': 'cancel',
    }, 'Cancel');
    append(actionGroup, enterButton);
    append(actionGroup, normalButton);
    append(actionGroup, cancelButton);
    append(bar, label);
    append(bar, actionGroup);
  }
  if (!bar.isConnected) {
    if (textarea?.insertAdjacentElement) textarea.insertAdjacentElement('afterend', bar);
    else append(host, bar);
  }

  let callbacks = {
    onEnterFlash: normalizedOptions.onEnterFlash ?? normalizedOptions.onAccept ?? noop,
    onAnswerNormally: normalizedOptions.onAnswerNormally ?? normalizedOptions.onDecline ?? noop,
    onCancelOffer: normalizedOptions.onCancelOffer ?? normalizedOptions.onCancel ?? noop,
  };
  const readComposer = () => toText(textarea?.value);
  const updateNormalLabel = () => {
    const text = readComposer();
    const buttonText = text.trim() ? 'Answer Normally' : 'Continue';
    normalButton.textContent = buttonText;
    normalButton.setAttribute('aria-label', buttonText);
  };
  const handleInput = () => updateNormalLabel();
  const handleEnter = (event) => callbacks.onEnterFlash(readComposer(), event);
  const handleNormal = (event) => callbacks.onAnswerNormally(readComposer(), event);
  const handleCancel = (event) => callbacks.onCancelOffer(event);
  textarea?.addEventListener?.('input', handleInput);
  enterButton.addEventListener?.('click', handleEnter);
  normalButton.addEventListener?.('click', handleNormal);
  cancelButton.addEventListener?.('click', handleCancel);
  updateNormalLabel();
  if (normalizedOptions.initiallyVisible) bar.hidden = false;

  return {
    element: bar,
    textarea,
    readComposer,
    setComposer: (value) => {
      if (textarea) textarea.value = toText(value);
      updateNormalLabel();
      return readComposer();
    },
    show: (showOptions = {}) => {
      if (typeof showOptions === 'string') showOptions = { text: showOptions };
      if (Object.prototype.hasOwnProperty.call(showOptions, 'text')) {
        if (textarea) textarea.value = toText(showOptions.text);
      }
      if (showOptions.hint != null && hint) hint.textContent = toText(showOptions.hint);
      bar.hidden = false;
      updateNormalLabel();
      return bar;
    },
    hide: () => {
      bar.hidden = true;
      return bar;
    },
    setVisible: (visible) => {
      bar.hidden = !Boolean(visible);
      updateNormalLabel();
      return bar;
    },
    isVisible: () => !bar.hidden,
    setCallbacks: (nextCallbacks = {}) => {
      callbacks = {
        ...callbacks,
        ...nextCallbacks,
        ...(nextCallbacks.onAccept && !nextCallbacks.onEnterFlash ? { onEnterFlash: nextCallbacks.onAccept } : {}),
        ...(nextCallbacks.onDecline && !nextCallbacks.onAnswerNormally ? { onAnswerNormally: nextCallbacks.onDecline } : {}),
      };
      return callbacks;
    },
    destroy: () => {
      textarea?.removeEventListener?.('input', handleInput);
      enterButton.removeEventListener?.('click', handleEnter);
      normalButton.removeEventListener?.('click', handleNormal);
      cancelButton.removeEventListener?.('click', handleCancel);
      bar.remove?.();
    },
  };
}

/** Mount the visible ST-FLASH active-session status and controls. */
export function mountFlashStatus(options = {}, legacyCallbacks = {}) {
  const normalizedOptions = isElement(options) || options?.nodeType === 9
    ? { ...legacyCallbacks, root: options }
    : (options || {});
  const root = normalizedOptions.root;
  const doc = getDocument(root);
  if (!doc?.createElement) return makeNoopController();
  const targetRoot = getRoot(root, doc);
  const host = resolveRuntimeRoot(normalizedOptions.runtimeRoot || targetRoot, doc, normalizedOptions.textarea);
  const existing = byId(doc, 'st_flash_status');
  const status = existing || makeElement(doc, 'section', {
    id: 'st_flash_status',
    className: 'st_flash_runtime st_flash_status',
    'data-st-flash': 'status',
    'aria-live': 'polite',
    role: 'status',
    hidden: 'hidden',
  });
  if (!status) return makeNoopController();
  status.replaceChildren?.();
  const label = makeElement(doc, 'div', { className: 'st_flash_status_label', 'data-st-flash-role': 'status-label' });
  const title = makeElement(doc, 'strong', {}, 'Active Flash');
  const detail = makeElement(doc, 'span', { className: 'st_flash_status_detail', 'data-st-flash-role': 'status-detail' }, 'ST-FLASH session is active.');
  append(label, title);
  append(label, detail);
  const progress = makeElement(doc, 'div', {
    id: 'st_flash_capsule_progress',
    className: 'st_flash_progress',
    'data-st-flash-role': 'capsule-progress',
    role: 'progressbar',
    'aria-label': 'Generating Flash capsule',
    'aria-valuetext': 'Generating capsule',
    hidden: 'hidden',
  });
  append(progress, makeElement(doc, 'span', { className: 'st_flash_progress_indicator' }));
  const turnCount = makeElement(doc, 'span', { id: 'st_flash_turn_count', className: 'st_flash_turn_count', 'data-st-flash-role': 'turn-count' });
  append(turnCount, makeElement(doc, 'span', {}, 'Turn'));
  const turnValue = makeElement(doc, 'strong', {}, '0');
  append(turnCount, turnValue);
  const actionGroup = makeElement(doc, 'div', { className: 'st_flash_action_group', 'data-st-flash-role': 'actions' });
  const landButton = makeElement(doc, 'button', {
    id: 'st_flash_land',
    type: 'button',
    className: 'st_flash_button st_flash_button_primary',
    'data-st-flash-action': 'land',
  }, 'Land');
  const abortButton = makeElement(doc, 'button', {
    id: 'st_flash_abort',
    type: 'button',
    className: 'st_flash_button st_flash_button_danger',
    'data-st-flash-action': 'abort',
  }, 'Abort');
  append(actionGroup, landButton);
  append(actionGroup, abortButton);
  append(status, label);
  append(status, progress);
  append(status, turnCount);
  append(status, actionGroup);
  if (!status.isConnected) append(host, status);

  let callbacks = {
    onLand: normalizedOptions.onLand ?? noop,
    onAbort: normalizedOptions.onAbort ?? noop,
  };
  const handleLand = (event) => callbacks.onLand(event);
  const handleAbort = (event) => callbacks.onAbort(event);
  landButton.addEventListener?.('click', handleLand);
  abortButton.addEventListener?.('click', handleAbort);
  let state = {};
  const setState = (nextState = {}) => {
    state = { ...state, ...nextState };
    const presentation = flashStatusPresentation(state);
    const rawTurn = state.turnCount ?? state.turn ?? state.flashTurn;
    const turn = Number.isFinite(Number(rawTurn)) ? Math.max(0, Math.trunc(Number(rawTurn))) : 0;
    turnValue.textContent = String(turn);
    title.textContent = toText(presentation.label);
    detail.textContent = toText(presentation.detail);
    progress.hidden = !presentation.showProgress;
    turnCount.hidden = !presentation.showTurn;
    landButton.hidden = !presentation.showTurn;
    const canLand = presentation.canLand;
    const canAbort = state.canAbort !== false;
    landButton.disabled = !canLand;
    abortButton.disabled = !canAbort;
    if (state.active != null) status.hidden = !Boolean(state.active);
    return state;
  };

  const controller = {
    element: status,
    show: (nextState = {}) => {
      setState({ ...nextState, active: true });
      status.hidden = false;
      return status;
    },
    hide: () => {
      status.hidden = true;
      state = { ...state, active: false };
      return status;
    },
    setState,
    getState: () => ({ ...state }),
    setCallbacks: (nextCallbacks = {}) => {
      callbacks = { ...callbacks, ...nextCallbacks };
      return callbacks;
    },
    isVisible: () => !status.hidden,
    destroy: () => {
      landButton.removeEventListener?.('click', handleLand);
      abortButton.removeEventListener?.('click', handleAbort);
      status.remove?.();
    },
  };
  if (normalizedOptions.initialState) setState(normalizedOptions.initialState);
  if (normalizedOptions.initiallyVisible) controller.show(normalizedOptions.initialState || {});
  return controller;
}

function errorParts(error) {
  if (error == null) return { message: '', code: '' };
  if (typeof error === 'string') return { message: error, code: '' };
  const message = error.message ?? error.detail ?? error.error ?? '';
  let fallback = '';
  if (!message) {
    try {
      fallback = JSON.stringify(error);
    } catch {
      fallback = String(error);
    }
  }
  return { message: toText(message || fallback), code: toText(error.code ?? '') };
}

/** Mount ST-FLASH recovery/error controls without deciding how recovery works. */
export function mountRecoveryPanel(options = {}, legacyCallbacks = {}) {
  const normalizedOptions = isElement(options) || options?.nodeType === 9
    ? { ...legacyCallbacks, root: options }
    : (options || {});
  const root = normalizedOptions.root;
  const doc = getDocument(root);
  if (!doc?.createElement) return makeNoopController();
  const targetRoot = getRoot(root, doc);
  const host = resolveRuntimeRoot(normalizedOptions.runtimeRoot || targetRoot, doc, normalizedOptions.textarea);
  const existing = byId(doc, 'st_flash_recovery');
  const panel = existing || makeElement(doc, 'section', {
    id: 'st_flash_recovery',
    className: 'st_flash_runtime st_flash_recovery',
    'data-st-flash': 'recovery',
    'aria-live': 'assertive',
    role: 'alert',
    hidden: 'hidden',
  });
  if (!panel) return makeNoopController();
  panel.replaceChildren?.();
  const label = makeElement(doc, 'div', { className: 'st_flash_recovery_label', 'data-st-flash-role': 'recovery-label' });
  append(label, makeElement(doc, 'strong', {}, 'ST-FLASH recovery'));
  const detail = makeElement(doc, 'span', { className: 'st_flash_recovery_detail', 'data-st-flash-role': 'recovery-detail' }, 'The previous action needs attention.');
  append(label, detail);
  const error = makeElement(doc, 'p', { id: 'st_flash_error', className: 'st_flash_error', 'data-st-flash-role': 'error', hidden: 'hidden' });
  const errorMessage = makeElement(doc, 'span', { id: 'st_flash_error_message', 'data-st-flash-role': 'error-message' });
  const errorCode = makeElement(doc, 'span', { id: 'st_flash_error_code', className: 'st_flash_error_code', 'data-st-flash-role': 'error-code' });
  append(error, errorMessage);
  append(error, errorCode);
  const actionGroup = makeElement(doc, 'div', { className: 'st_flash_action_group', 'data-st-flash-role': 'actions' });
  const retryButton = makeElement(doc, 'button', { id: 'st_flash_retry', type: 'button', className: 'st_flash_button st_flash_button_primary', 'data-st-flash-action': 'retry' }, 'Retry');
  const resetButton = makeElement(doc, 'button', { id: 'st_flash_reset', type: 'button', className: 'st_flash_button', 'data-st-flash-action': 'reset' }, 'Reset ST-FLASH');
  append(actionGroup, retryButton);
  append(actionGroup, resetButton);
  append(panel, label);
  append(panel, error);
  append(panel, actionGroup);
  if (!panel.isConnected) append(host, panel);

  let callbacks = {
    onRetry: normalizedOptions.onRetry ?? noop,
    onReset: normalizedOptions.onReset ?? noop,
  };
  const handleRetry = (event) => callbacks.onRetry(event);
  const handleReset = (event) => callbacks.onReset(event);
  retryButton.addEventListener?.('click', handleRetry);
  resetButton.addEventListener?.('click', handleReset);

  let currentError = null;
  const setError = (nextError) => {
    currentError = nextError;
    const parts = errorParts(nextError);
    errorMessage.textContent = parts.message;
    errorCode.textContent = parts.code ? `Code: ${parts.code}` : '';
    error.hidden = !parts.message;
    return parts;
  };
  const controller = {
    element: panel,
    show: (nextError) => {
      if (nextError !== undefined) setError(nextError);
      panel.hidden = false;
      return panel;
    },
    hide: () => {
      panel.hidden = true;
      return panel;
    },
    setError,
    getError: () => currentError,
    setCallbacks: (nextCallbacks = {}) => {
      callbacks = { ...callbacks, ...nextCallbacks };
      return callbacks;
    },
    isVisible: () => !panel.hidden,
    destroy: () => {
      retryButton.removeEventListener?.('click', handleRetry);
      resetButton.removeEventListener?.('click', handleReset);
      panel.remove?.();
    },
  };
  if (normalizedOptions.initialError !== undefined) setError(normalizedOptions.initialError);
  if (normalizedOptions.initiallyVisible) controller.show();
  return controller;
}

/**
 * Create the complete ST-FLASH runtime surface. All state changes still belong
 * to the controller; these methods only show/hide and forward callbacks.
 */
export function createUi(callbacks = {}) {
  const options = callbacks && typeof callbacks === 'object' ? callbacks : {};
  const root = options.root || options.runtimeRoot;
  const decision = mountDecisionBar({
    ...options,
    root,
    runtimeRoot: options.runtimeRoot || root,
  });
  const status = mountFlashStatus({
    ...options,
    root,
    runtimeRoot: options.runtimeRoot || root,
    onLand: options.onLand,
    onAbort: options.onAbort,
  });
  const recovery = mountRecoveryPanel({
    ...options,
    root,
    runtimeRoot: options.runtimeRoot || root,
    onRetry: options.onRetry,
    onReset: options.onReset,
    onDismiss: options.onDismiss,
  });
  let settingsBinding = null;
  let pendingProfileOptions = null;
  const doc = getDocument(root);
  const sendButton = doc?.getElementById?.('send_but');
  const textarea = decision.textarea || doc?.getElementById?.('send_textarea');
  let interactionMode = 'idle';
  const sendIsLocked = () => ['decision', 'busy', 'recovery'].includes(interactionMode);
  const blockHostSend = (event) => {
    if (!sendIsLocked()) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  };
  const blockHostEnter = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) blockHostSend(event);
  };
  sendButton?.addEventListener?.('click', blockHostSend, true);
  textarea?.addEventListener?.('keydown', blockHostEnter, true);
  const setInteractionMode = (mode = 'idle') => {
    interactionMode = ['idle', 'decision', 'busy', 'flash', 'recovery'].includes(mode) ? mode : 'idle';
    const locked = sendIsLocked();
    sendButton?.classList?.toggle('st_flash_host_send_locked', locked);
    sendButton?.setAttribute?.('aria-disabled', String(locked));
    doc?.documentElement?.classList?.toggle('st_flash_session_active', interactionMode === 'flash' || interactionMode === 'busy');
    return interactionMode;
  };

  return {
    decision,
    status,
    recovery,
    showOffer: (offer = {}) => { setInteractionMode('decision'); status.hide(); recovery.hide(); return decision.show(offer); },
    showDecisionBar: (offer = {}) => { setInteractionMode('decision'); status.hide(); recovery.hide(); return decision.show(offer); },
    hideOffer: () => decision.hide(),
    hideDecisionBar: () => decision.hide(),
    showFlashStatus: (state = {}) => {
      const phase = state.phase || state.session?.phase;
      setInteractionMode(phase === 'FLASH' ? 'flash' : 'busy');
      decision.hide();
      recovery.hide();
      return status.show({ ...state, phase });
    },
    showFlash: (state = {}) => { setInteractionMode('flash'); return status.show(state); },
    hideFlashStatus: () => status.hide(),
    hideFlash: () => status.hide(),
    setFlashStatus: (state = {}) => status.setState(state),
    showRecovery: (error) => { setInteractionMode('recovery'); decision.hide(); status.hide(); return recovery.show(error); },
    showError: (error) => { setInteractionMode('recovery'); decision.hide(); status.hide(); return recovery.show(error); },
    hideRecovery: () => recovery.hide(),
    hideError: () => recovery.hide(),
    clearRuntime: () => {
      setInteractionMode('idle');
      decision.hide();
      status.hide();
      recovery.hide();
    },
    readComposer: () => decision.readComposer?.() ?? '',
    setComposer: (value) => decision.setComposer?.(value) ?? '',
    setInteractionMode,
    getInteractionMode: () => interactionMode,
    bindSettings: (settingsOptions = {}, legacyOnChange) => {
      settingsBinding?.destroy?.();
      const isBindingOptions = settingsOptions && typeof settingsOptions === 'object' && (
        isElement(settingsOptions)
        || settingsOptions?.nodeType === 9
        || 'root' in settingsOptions
        || 'initial' in settingsOptions
        || 'settings' in settingsOptions
        || 'profileOptions' in settingsOptions
        || 'onChange' in settingsOptions
        || 'onInput' in settingsOptions
      );
      const normalized = isElement(settingsOptions) || settingsOptions?.nodeType === 9
        ? { root: settingsOptions }
        : (isBindingOptions ? { ...settingsOptions } : { initial: settingsOptions });
      if (typeof legacyOnChange === 'function') normalized.onChange = legacyOnChange;
      if (pendingProfileOptions && !normalized.profileOptions) normalized.profileOptions = pendingProfileOptions.profiles;
      if (pendingProfileOptions && !normalized.selectedProfiles) normalized.selectedProfiles = pendingProfileOptions.selected;
      settingsBinding = bindSettingsUI({
        ...normalized,
        onChange: normalized.onChange || options.onSettingsChange,
        onInput: normalized.onInput || options.onSettingsInput,
      });
      return settingsBinding;
    },
    setProfileOptions: (profiles, selected) => {
      pendingProfileOptions = { profiles, selected };
      if (settingsBinding?.setProfileOptions) return settingsBinding.setProfileOptions(profiles, selected);
      return setProfileOptions(options.settingsRoot || root, profiles, selected);
    },
    setCallbacks: (nextCallbacks = {}) => {
      decision.setCallbacks(nextCallbacks);
      status.setCallbacks(nextCallbacks);
      recovery.setCallbacks(nextCallbacks);
      return nextCallbacks;
    },
    destroy: () => {
      setInteractionMode('idle');
      sendButton?.removeEventListener?.('click', blockHostSend, true);
      textarea?.removeEventListener?.('keydown', blockHostEnter, true);
      settingsBinding?.destroy?.();
      decision.destroy();
      status.destroy();
      recovery.destroy();
    },
  };
}

export const createSTFlashUI = createUi;
export const mountSTFlashUI = createUi;
export const createUI = createUi;
export const createFlashUI = createUi;
export const createSettingsUI = bindSettingsUI;
export const populateProfileOptions = setProfileOptions;
export const renderDecisionBar = mountDecisionBar;
export const renderFlashStatus = mountFlashStatus;
export const renderRecovery = mountRecoveryPanel;
