const ROLE_HINTS = Object.freeze({
  anchor: {
    name: /^ST[- ]Flash A\b/i,
    model: /^kimi-k3-256k\(max\)$/i,
  },
  flash: {
    name: /^ST[- ]Flash B\b/i,
    model: /^kimi-k2\.7-code-highspeed$/i,
  },
  landing: {
    name: /^ST[- ]Flash C\b/i,
    model: /^kimi-k3-256k\(low\)$/i,
  },
});

function value(item, key) {
  return String(item?.[key] ?? '').trim();
}

/** Fill only blank profile roles; explicit user choices always win. */
export function detectRoleProfiles(configured = {}, available = []) {
  const result = { anchor: '', flash: '', landing: '', ...(configured || {}) };
  let changed = false;
  for (const [role, hint] of Object.entries(ROLE_HINTS)) {
    if (String(result[role] ?? '').trim()) continue;
    const byName = available.find((profile) => hint.name.test(value(profile, 'name')));
    const byModel = available.find((profile) => hint.model.test(value(profile, 'model')));
    const match = byName || byModel;
    if (!match?.id) continue;
    result[role] = String(match.id);
    changed = true;
  }
  return { profiles: result, changed };
}

export default detectRoleProfiles;
