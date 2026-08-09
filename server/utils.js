// Shared utility functions

export function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function decodeBasicEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeLike(value) {
  return String(value || "").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function calculatePushDays(frequency) {
  if (frequency === "daily") return 1;
  if (frequency === "monthly") return 30;
  return 7;
}

export const ELECTRICAL_FILTER_KEYWORDS = [
  "power grid", "power system", "electric", "electrical", "microgrid", "micro-grid",
  "distributed generation", "renewable energy", "solar", "photovoltaic", "wind",
  "energy storage", "battery", "EV", "electric vehicle", "V2G", "vehicle-to-grid",
  "smart grid", "demand response", "load forecasting", "power electronics",
  "inverter", "converter", "DC-DC", "AC-DC", "power quality", "voltage regulation",
  "frequency control", "grid", "transmission", "distribution", "substation",
  "protection", "relay", "fault", "power flow", "optimal power flow", "OPF",
  "unit commitment", "economic dispatch", "energy management", "EMS",
  "aggregation", "DER", "distributed energy resource", "VPP", "virtual power plant",
  "flexibility", "curtailment", "intermittency", "uncertainty",
  "demand side", "demand management", "peak shaving", "valley filling",
  "energy internet", "cyber-physical", "internet of things", "IoT",
  "machine learning", "deep learning", "reinforcement learning", "neural network",
  "optimization", "stochastic", "robust", "resilience",
  "carbon", "emission", "sustainability", "clean energy", "green energy",
  "hydrogen", "fuel cell", "power-to-X", "P2X",
  "electricity market", "energy market", "pricing", "tariff",
  "phasor", "PMU", "SCADA", "state estimation",
  "FACTS", "HVDC", "UHVDC", "AC-DC",
  "motor", "generator", "transformer", "induction",
  "control", "stability", "oscillation", "oscillat",
  "island", "off-grid", "standalone"
];
