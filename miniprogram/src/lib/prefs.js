import Taro from "@tarojs/taro";

/**
 * 本地偏好（对应网站 localStorage 的三组数据）：
 * - displayPrefs：卡片显示开关（authors/keywords/abstract/bilingual/translatedAbstract）
 * - chipPrefs：研究速览方向 chips 排序与隐藏（reportsChipPrefs 同结构）
 * 结构与网站一致，便于后续「个性化上传/下载」打通。
 */

const DISPLAY_KEY = "mp_display_prefs";
const CHIP_KEY = "mp_chip_prefs";

const DEFAULT_DISPLAY = { authors: true, keywords: true, abstract: true, bilingual: true, translatedAbstract: false };

function readJson(key, fallback) {
  try {
    const raw = Taro.getStorageSync(key);
    if (!raw) return fallback;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    Taro.setStorageSync(key, JSON.stringify(value));
  } catch (error) { /* ignore */ }
}

export function loadDisplayPrefs() {
  return { ...DEFAULT_DISPLAY, ...readJson(DISPLAY_KEY, {}) };
}

export function saveDisplayPrefs(prefs) {
  writeJson(DISPLAY_KEY, prefs);
  return prefs;
}

export function loadChipPrefs() {
  const raw = readJson(CHIP_KEY, { order: [], hidden: [] });
  return {
    order: Array.isArray(raw.order) ? raw.order : [],
    hidden: Array.isArray(raw.hidden) ? raw.hidden : []
  };
}

export function saveChipPrefs(prefs) {
  writeJson(CHIP_KEY, prefs);
  return prefs;
}
