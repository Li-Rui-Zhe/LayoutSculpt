export const emptyPreferences = () => ({
  favorites: [],
  archived: [],
  recent: [],
  aiEnabled: [],
});

export function applyPreference(value, { key, id, enabled = true }) {
  const list = Array.isArray(value[key]) ? value[key] : [];
  const without = list.filter((item) => item !== id);
  return {
    ...value,
    [key]:
      key === "recent"
        ? [id, ...without].slice(0, 50)
        : enabled
          ? [...without, id]
          : without,
  };
}

export function rebasePreferences(remote, operations) {
  return operations.reduce(applyPreference, {
    ...emptyPreferences(),
    ...remote,
  });
}
