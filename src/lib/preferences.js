import { DEFAULT_DISPLAY, DISPLAY_PREFERENCES_VERSION } from "./constants.js";

export function normalizeDisplayPreferences(snapshot) {
  const saved = snapshot && typeof snapshot === "object" ? snapshot : {};
  const preferences = saved.displayPreferences && typeof saved.displayPreferences === "object"
    ? saved.displayPreferences
    : {};
  const isLegacySnapshot = Number(saved.displayPreferencesVersion || 0) < DISPLAY_PREFERENCES_VERSION;
  return {
    ...DEFAULT_DISPLAY,
    ...preferences,
    // Before version 2, true meant the old default rather than an explicit
    // user choice. Do not let that legacy value keep re-enabling the section.
    ...(isLegacySnapshot ? { translatedAbstract: false } : {})
  };
}
