import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "./i18n";

describe("language defaults", () => {
  it("defaults missing or invalid language values to English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("unsupported")).toBe("en");
  });

  it("preserves both supported saved languages", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
  });
});
