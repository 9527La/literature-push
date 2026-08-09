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

export function createUserToken(accountId, now = Date.now()) {
  if (!secret()) throw new Error("用户会话密钥尚未配置");
  const payload = Buffer.from(JSON.stringify({
    role: "user",
    accountId: Number(accountId),
    exp: now + config.userTokenTtlDays * 24 * 60 * 60 * 1000
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
    return claims.role === "user" && Number(claims.accountId) > 0 && Number(claims.exp) > now ? claims : null;
  } catch {
    return null;
  }
}

export function getUserClaims(req) {
  return verifyUserToken(String(req.headers["x-user-token"] || ""));
}

export function requireUser(req, res, next) {
  const claims = getUserClaims(req);
  if (!claims) {
    res.status(401).json({ error: "请先登录用户账户" });
    return;
  }
  req.userClaims = claims;
  next();
}
