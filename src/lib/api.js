import { getPassportToken, getUserToken } from "./storage.js";

async function parseResponse(response) {
  if (response.ok) return response.json();
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const error = new Error(data.error || text);
    error.status = response.status;
    error.payload = data;
    if (data.article) error.article = data.article;
    throw error;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const looksLikeHtml = /<!doctype\s+html|<html\b|<head\b|<body\b|cf-error-details/i.test(text);
      throw new Error(looksLikeHtml ? `外部服务暂时不可用（${response.status}）` : (text.slice(0, 300) || `请求失败（${response.status}）`));
    }
    throw error;
  }
}

export function requestHeaders(hasBody = false) {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const passportToken = getPassportToken();
  if (passportToken) headers["X-Passport-Token"] = passportToken;
  const userToken = getUserToken();
  if (userToken) headers["X-User-Token"] = userToken;
  return headers;
}

export const api = {
  async get(path) {
    return parseResponse(await fetch(path, { headers: requestHeaders() }));
  },
  async post(path, body) {
    return parseResponse(await fetch(path, {
      method: "POST",
      headers: requestHeaders(Boolean(body)),
      body: body ? JSON.stringify(body) : undefined
    }));
  },
  async put(path, body) {
    return parseResponse(await fetch(path, {
      method: "PUT",
      headers: requestHeaders(true),
      body: JSON.stringify(body)
    }));
  },
  async patch(path, body) {
    return parseResponse(await fetch(path, { method: "PATCH", headers: requestHeaders(true), body: JSON.stringify(body) }));
  },
  async delete(path) {
    return parseResponse(await fetch(path, { method: "DELETE", headers: requestHeaders() }));
  }
};
