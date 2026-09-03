import crypto from "node:crypto";
import { config } from "./config.js";

function secret() {
  return config.adminTokenSecret;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function hashUserPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyUserPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashUserPassword(password, salt).hash, "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createUserToken(accountId, sessionId, expiresAt, now = Date.now()) {
  if (!secret()) throw new Error("用户会话密钥尚未配置");
  const payload = Buffer.from(JSON.stringify({
    role: "user",
    accountId: Number(accountId),
    sessionId: String(sessionId || ""),
    exp: Number(expiresAt)
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function createPassportToken(role, now = Date.now()) {
  if (!secret()) throw new Error("网页通行证密钥尚未配置");
  if (!["admin", "user"].includes(role)) throw new Error("无效的通行证角色");
  const expiresAt = now + config.passportTokenTtlHours * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({
    type: "passport",
    role,
    exp: expiresAt
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUserToken(token, now = Date.now()) {
  if (!token || !secret()) return null;
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra) return null;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.role === "user"
      && Number(claims.accountId) > 0
      && typeof claims.sessionId === "string"
      && claims.sessionId.length >= 16
      && Number(claims.exp) > now
      ? claims
      : null;
  } catch {
    return null;
  }
}

export function verifyPassportToken(token, now = Date.now()) {
  if (!token || !secret()) return null;
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra) return null;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.type === "passport"
      && ["admin", "user"].includes(claims.role)
      && Number(claims.exp) > now
      ? claims
      : null;
  } catch {
    return null;
  }
}

export function getUserClaims(req) {
  return verifyUserToken(String(req.headers["x-user-token"] || ""));
}

export function getPassportClaims(req) {
  return verifyPassportToken(String(req.headers["x-passport-token"] || ""));
}
