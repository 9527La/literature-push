import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { internals } from "./crawler.js";

// OpenAlex 自 2026-02 起要求所有请求带 API key，并改为按日额度计费。没有 key 时
// 会落到一个极小的匿名共享额度上，额度一空接口立刻返回 429「Insufficient budget」，
// 这正是关键词/摘要补全整批失败的根因之一。
test("applyOpenAlexAuth sends the API key when configured", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "oa-secret";
    config.crossrefMailto = "ops@example.com";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.get("api_key"), "oa-secret");
    assert.equal(params.get("mailto"), "ops@example.com");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});

test("applyOpenAlexAuth keeps mailto as the keyless courtesy identifier", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "";
    config.crossrefMailto = "ops@example.com";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.get("api_key"), null);
    assert.equal(params.get("mailto"), "ops@example.com");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});

test("applyOpenAlexAuth adds nothing when neither a key nor a mailto exists", () => {
  const originalKey = config.openAlexApiKey;
  const originalMailto = config.crossrefMailto;
  try {
    config.openAlexApiKey = "";
    config.crossrefMailto = "";
    const params = internals.applyOpenAlexAuth(new URLSearchParams());
    assert.equal(params.toString(), "");
  } finally {
    config.openAlexApiKey = originalKey;
    config.crossrefMailto = originalMailto;
  }
});
