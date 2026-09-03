import { config } from "./config.js";
import crypto from "node:crypto";
import { sleep } from "./utils.js";

function inferSourceLanguage(text, targetLanguage) {
  if (targetLanguage === "en") return "auto";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

async function translateLibreText(text, targetLanguage) {
  if (!text) return "";

  const body = new URLSearchParams({
    q: text,
    source: inferSourceLanguage(text, targetLanguage),
    target: targetLanguage,
    format: "text"
  });

  if (config.libreTranslateApiKey) {
    body.set("api_key", config.libreTranslateApiKey);
  }

  const response = await fetch(`${config.libreTranslateUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Translation service returned ${response.status}: ${text.slice(0, 180)}`);
  }

  const data = await response.json();
  return Array.isArray(data.translatedText) ? data.translatedText.join("\n") : data.translatedText || "";
}

function myMemoryTarget(targetLanguage) {
  return targetLanguage === "zh" ? "zh-CN" : "en";
}

function myMemorySource(text, targetLanguage) {
  if (targetLanguage === "en") return /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en";
}

function chunkText(text, maxLength = 420) {
  const source = String(text || "").trim();
  if (!source) return [];

  const sentences = source.match(/[^.!?。！？]+[.!?。！？]*/g) || [source];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence;
      continue;
    }
    if (current) chunks.push(current.trim());
    if (sentence.length <= maxLength) {
      current = sentence;
    } else {
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength).trim());
      }
      current = "";
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

async function translateMyMemoryChunk(text, targetLanguage) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${myMemorySource(text, targetLanguage)}|${myMemoryTarget(targetLanguage)}`
  });
  if (config.myMemoryEmail) {
    params.set("de", config.myMemoryEmail);
  }

  const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`MyMemory returned ${response.status}`);
  }

  const data = await response.json();
  const translated = data.responseData?.translatedText || "";
  if (!translated) {
    throw new Error(data.responseDetails || "MyMemory returned no translation");
  }
  return translated;
}

async function translateMyMemoryText(text, targetLanguage) {
  const chunks = chunkText(text);
  const translated = [];
  for (const chunk of chunks) {
    translated.push(await translateMyMemoryChunk(chunk, targetLanguage));
  }
  return translated.join(" ");
}

function baiduTarget(targetLanguage) {
  return targetLanguage === "zh" ? "zh" : "en";
}

function baiduSource(text, targetLanguage) {
  if (targetLanguage === "en") return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}

async function translateBaiduText(text, targetLanguage) {
  if (!text) return "";
  if (!config.baiduTranslateAppId || !config.baiduTranslateKey) {
    throw new Error("Baidu Translate requires BAIDU_TRANSLATE_APPID and BAIDU_TRANSLATE_KEY");
  }

  const chunks = chunkText(text, 1200);
  const translated = [];
  for (const [index, chunk] of chunks.entries()) {
    if (index > 0) {
      await sleep(1100);
    }
    const salt = String(Date.now() + Math.floor(Math.random() * 100000));
    const sign = crypto
      .createHash("md5")
      .update(`${config.baiduTranslateAppId}${chunk}${salt}${config.baiduTranslateKey}`)
      .digest("hex");
    const params = new URLSearchParams({
      q: chunk,
      from: baiduSource(chunk, targetLanguage),
      to: baiduTarget(targetLanguage),
      appid: config.baiduTranslateAppId,
      salt,
      sign
    });

    const response = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Baidu Translate returned ${response.status}`);
    }

    const data = await response.json();
    if (data.error_code) {
      throw new Error(`Baidu Translate error ${data.error_code}: ${data.error_msg || "unknown error"}`);
    }

    translated.push((data.trans_result || []).map((item) => item.dst).join("\n"));
  }
  return translated.join(" ");
}

async function translateWithProvider(article, targetLanguage, provider) {
  const translateText =
    provider === "baidu"
      ? translateBaiduText
      : provider === "mymemory"
        ? translateMyMemoryText
        : translateLibreText;
  let title = "";
  let abstract = "";

  if (provider === "baidu") {
    title = await translateText(article.title, targetLanguage);
    await sleep(1100);
    abstract = await translateText(article.abstract, targetLanguage);
  } else {
    [title, abstract] = await Promise.all([
      translateText(article.title, targetLanguage),
      translateText(article.abstract, targetLanguage)
    ]);
  }

  return {
    title,
    abstract,
    provider
  };
}

export async function translateArticle(article, targetLanguage) {
  if (config.translationProvider === "auto") {
    if (config.baiduTranslateAppId && config.baiduTranslateKey) {
      try {
        return await translateWithProvider(article, targetLanguage, "baidu");
      } catch {
        // Fall through to public providers.
      }
    }
    try {
      return await translateWithProvider(article, targetLanguage, "libretranslate");
    } catch {
      return translateWithProvider(article, targetLanguage, "mymemory");
    }
  }

  if (!["baidu", "libretranslate", "mymemory"].includes(config.translationProvider)) {
    throw new Error(`Unsupported translation provider: ${config.translationProvider}`);
  }

  return translateWithProvider(article, targetLanguage, config.translationProvider);
}

export const internals = {
  chunkText
};
