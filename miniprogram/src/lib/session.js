import Taro from "@tarojs/taro";
import { BASE_URL } from "./config.js";

/**
 * 会话与凭据管理（仅面向网页端注册用户，无游客态）。
 *
 * 登录模型（DESIGN-MINIPROGRAM.md §5.7）：
 *   ① POST /api/gate/login {passport}        → X-Passport-Token（全站门禁）
 *   ② POST /api/auth/login {username,password} → X-User-Token（个人账户）
 * 两步都成功才算登录。凭据保存在本地（wx storage），用于 token 过期时静默续登；
 * 「退出登录」会连同凭据一起清除。
 *
 * D3-B（wx.login code2session 静默续期）需要后端新增 /api/auth/wx-session 端点
 * （code2session 换发，绑定账户），后端落地后把 WX_SESSION_ENABLED 打开即可，
 * 客户端逻辑已就位。
 */

const WX_SESSION_ENABLED = false; // TODO(后端 /api/auth/wx-session 落地后改 true)

const KEY = {
  passportToken: "mp_passport_token",
  passportExpires: "mp_passport_expires",
  userToken: "mp_user_token",
  userExpires: "mp_user_expires",
  username: "mp_username",
  password: "mp_password",
  remember: "mp_remember"
};

function get(key) {
  try {
    return Taro.getStorageSync(key) || "";
  } catch (error) {
    return "";
  }
}

function set(key, value) {
  try {
    Taro.setStorageSync(key, value);
  } catch (error) { /* storage 满/隐私模式：忽略，下次登录重写 */ }
}

function remove(key) {
  try {
    Taro.removeStorageSync(key);
  } catch (error) { /* ignore */ }
}

export function normalizePassport(value) {
  // 与网站同口径：NFKC 折全角 + 去首尾空白。
  return String(value || "").normalize("NFKC").trim();
}

export function getPassportToken() {
  return get(KEY.passportToken);
}

export function getUserToken() {
  return get(KEY.userToken);
}

function tokenUsable(token, expiresKey) {
  if (!token) return false;
  const expires = Date.parse(get(expiresKey));
  if (Number.isNaN(expires)) return true;
  // 提前 5 分钟视为过期，避免临界竞态。
  return expires - Date.now() > 5 * 60 * 1000;
}

export function hasLiveSession() {
  return tokenUsable(get(KEY.passportToken), KEY.passportExpires)
    && tokenUsable(get(KEY.userToken), KEY.userExpires);
}

export function getSavedUsername() {
  return get(KEY.username);
}

async function post(path, body) {
  const res = await Taro.request({
    url: `${BASE_URL}${path}`,
    method: "POST",
    data: body,
    header: { "Content-Type": "application/json" },
    timeout: 15000
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    let message = "";
    try { message = res.data?.error || ""; } catch (error) { message = ""; }
    throw new Error(message || `登录失败（${res.statusCode}）`);
  }
  return res.data;
}

/** 完整登录：通行证 + 账户。成功后写 token 与（可选）凭据。 */
export async function loginWithCredentials(passport, username, password, remember = true) {
  const gate = await post("/api/gate/login", { passport: normalizePassport(passport) });
  set(KEY.passportToken, gate.token);
  set(KEY.passportExpires, gate.expiresAt || "");

  const auth = await post("/api/auth/login", { username: String(username || "").trim(), password: String(password || "") });
  set(KEY.userToken, auth.token);
  set(KEY.userExpires, auth.expiresAt || "");
  set(KEY.username, String(username || "").trim());
  if (remember) {
    set(KEY.password, String(password || ""));
    set(KEY.remember, "1");
  } else {
    remove(KEY.password);
    remove(KEY.remember);
  }
  return { isAdmin: Boolean(gate.isAdmin), username: auth.username || username };
}

/**
 * 静默续登：401 时用本地凭据重跑两步登录。
 * 优先尝试 wx.login code2session（后端端点落地后启用）；失败回落账号密码重登。
 */
export async function silentRefresh() {
  if (WX_SESSION_ENABLED) {
    try {
      const { code } = await Taro.login();
      const session = await post("/api/auth/wx-session", { code });
      if (session?.token) {
        set(KEY.userToken, session.token);
        set(KEY.userExpires, session.expiresAt || "");
      }
      if (session?.passportToken) {
        set(KEY.passportToken, session.passportToken);
        set(KEY.passportExpires, session.passportExpiresAt || "");
      }
      if (session?.token || session?.passportToken) return true;
    } catch (error) { /* 回落账号密码重登 */ }
  }
  const username = get(KEY.username);
  const password = get(KEY.password);
  const passport = get(KEY.passportToken) ? "" : "";
  if (!username || !password) return false;
  // 通行证 token 原样重用；仅当它也不可用时才要求用户重新输入通行证
  //（通行证 TTL 远长于账户 session，绝大多数续登只需第 ② 步）。
  try {
    if (!tokenUsable(get(KEY.passportToken), KEY.passportExpires)) return false;
    const auth = await post("/api/auth/login", { username, password });
    set(KEY.userToken, auth.token);
    set(KEY.userExpires, auth.expiresAt || "");
    return true;
  } catch (error) {
    return false;
  }
}

export function clearSession() {
  Object.values(KEY).forEach((key) => remove(key));
}

export async function logout() {
  try {
    await Taro.request({
      url: `${BASE_URL}/api/auth/logout`,
      method: "POST",
      header: { "X-Passport-Token": get(KEY.passportToken), "X-User-Token": get(KEY.userToken) },
      timeout: 10000
    });
  } catch (error) { /* 服务端会话吊销失败不阻塞本地登出 */ }
  clearSession();
}
