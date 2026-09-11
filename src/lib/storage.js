export const ACCOUNT_LOGIN_SETTINGS_KEY = "accountLoginSettings";

export function getUserToken() {
  return localStorage.getItem("userToken") || sessionStorage.getItem("userToken") || "";
}

export function readAccountLoginSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_LOGIN_SETTINGS_KEY) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function saveAccountLoginSettings({ username, password, rememberPassword, autoLogin }) {
  const next = {
    username: String(username || "").trim(),
    rememberPassword: Boolean(rememberPassword),
    autoLogin: Boolean(autoLogin)
  };
  if (rememberPassword && password) next.password = String(password);
  localStorage.setItem(ACCOUNT_LOGIN_SETTINGS_KEY, JSON.stringify(next));
}

export function setAccountToken(token, persistent) {
  localStorage.removeItem("userToken");
  sessionStorage.removeItem("userToken");
  (persistent ? localStorage : sessionStorage).setItem("userToken", token);
}

export function clearAccountToken() {
  localStorage.removeItem("userToken");
  sessionStorage.removeItem("userToken");
}

export function disableAccountAutoLogin() {
  const settings = readAccountLoginSettings();
  localStorage.setItem(ACCOUNT_LOGIN_SETTINGS_KEY, JSON.stringify({
    ...settings,
    autoLogin: false
  }));
}

export function getPassportToken() {
  return localStorage.getItem("passportToken") || "";
}

export function readLocalPersonalization() {
  try {
    return JSON.parse(localStorage.getItem("personalizationSnapshot") || "null");
  } catch {
    return null;
  }
}
