import crypto from "node:crypto";
import { config } from "./config.js";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload, secret = config.adminTokenSecret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function passwordMatches(password, expected = config.adminPassword) {
  const actualBuffer = Buffer.from(String(password || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAdminToken(now = Date.now()) {
  if (!config.adminTokenSecret) throw new Error("管理员凭据尚未配置");
  const payload = encode(JSON.stringify({ role: "admin", exp: now + config.adminTokenTtlHours * 60 * 60 * 1000 }));
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token, now = Date.now()) {
  if (!token || !config.adminTokenSecret) return false;
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra) return false;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.role === "admin" && Number(claims.exp) > now;
  } catch {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: "需要管理员权限" });
    return;
  }
  next();
}
