import test from "node:test";
import assert from "node:assert/strict";
import { internals } from "./elsevier.js";

// Regression guard for the "为什么关键词总是机器标签" bug: the Article Retrieval
// API returns the author keyword list as `coredata["dcterms:subject"]`, and
// `item.authKeywords` is routinely absent on Online-First records.  When the
// dcterms fallback is missing the crawler used to accept OpenAlex concept tags
// instead, which is what produced entries such as "Penetration (warfare)".
test("reads author keywords from dcterms:subject when authKeywords is absent", () => {
  const result = internals.normalizeElsevierItem({
    "full-text-retrieval-response": {
      coredata: {
        "dc:title": "Bifacial photovoltaics in desert climates",
        "dc:description": "A complete abstract.",
        "prism:doi": "10.1016/j.renene.2026.125922",
        "prism:coverDate": "2026-09-01",
        "dcterms:subject": [
          { "@_fa": "true", $: "Bifacial photovoltaics" },
          { "@_fa": "true", $: "Ground coverage ratio" },
          { "@_fa": "true", $: "Desert climate" }
        ]
      }
    }
  });
  assert.equal(result.abstract, "A complete abstract.");
  assert.equal(result.keywords, "Bifacial photovoltaics; Ground coverage ratio; Desert climate");
});

test("prefers authKeywords over dcterms:subject when both are present", () => {
  const result = internals.normalizeElsevierItem({
    "full-text-retrieval-response": {
      coredata: {
        "dc:title": "T",
        "dc:description": "A",
        "dcterms:subject": [{ $: "subject taxonomy entry" }]
      },
      item: { authKeywords: { "author-keyword": [{ $: "microgrid" }, { $: "state estimation" }] } }
    }
  });
  assert.equal(result.keywords, "microgrid; state estimation");
});

test("deduplicates and ignores malformed dcterms:subject entries", () => {
  const result = internals.normalizeElsevierItem({
    "full-text-retrieval-response": {
      coredata: {
        "dc:title": "T",
        "dc:description": "A",
        "dcterms:subject": [
          { $: "Solar energy" },
          { $: "Solar energy" },
          { $: "  " },
          null,
          "plain string keyword"
        ]
      }
    }
  });
  assert.equal(result.keywords, "Solar energy; plain string keyword");
});

test("extractSubjects tolerates a missing or non-array dcterms:subject", () => {
  assert.equal(internals.extractSubjects({}), "");
  assert.equal(internals.extractSubjects({ "dcterms:subject": "Solar energy" }), "");
  assert.equal(internals.extractSubjects(undefined), "");
});
