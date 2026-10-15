// Spec 011: only the closed list of events and coarse values can be sent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pagesBucket, sanitize, sizeBucket } from "../src/analytics/events";

describe("sanitize", () => {
  it("rejects events outside the list", () => {
    expect(sanitize("file_opened", { name: "contrato.pdf" })).toBeNull();
    expect(sanitize("toString")).toBeNull();
    expect(sanitize("__proto__")).toBeNull();
  });

  it("keeps only the parameters allowed for the event", () => {
    expect(
      sanitize("open_document", {
        pages: "2-5",
        size: "<1MB",
        file_name: "nomina-enero.pdf",
        text: "Importe 1.234,56",
        lang: "es",
      }),
    ).toEqual({
      name: "open_document",
      params: { pages: "2-5", size: "<1MB" },
    });
    expect(sanitize("edit_text", { text: "nuevo texto" })).toEqual({
      name: "edit_text",
      params: {},
    });
  });

  it("drops values outside the coarse buckets", () => {
    expect(
      sanitize("open_document", { pages: "37", size: 123456 })!.params,
    ).toEqual({});
    expect(sanitize("change_language", { lang: "fr" })!.params).toEqual({});
    expect(
      sanitize("page_view", {
        page_path: "/app/?file=secreto.pdf",
        page_title: "secreto.pdf",
      })!.params,
    ).toEqual({});
    expect(
      sanitize("page_view", { page_path: "/app/", page_title: "app" })!.params,
    ).toEqual({ page_path: "/app/", page_title: "app" });
  });
});

describe("buckets", () => {
  it("counts pages in ranges", () => {
    expect([1, 2, 5, 6, 20, 21, 100, 101, 5000].map(pagesBucket)).toEqual([
      "1",
      "2-5",
      "2-5",
      "6-20",
      "6-20",
      "21-100",
      "21-100",
      "100+",
      "100+",
    ]);
  });

  it("sizes files in ranges", () => {
    const mb = 1024 * 1024;
    expect([0, mb - 1, mb, 10 * mb, 49 * mb, 50 * mb].map(sizeBucket)).toEqual([
      "<1MB",
      "<1MB",
      "1-10MB",
      "10-50MB",
      "10-50MB",
      "50MB+",
    ]);
  });
});

describe("production hosts", () => {
  it("measure on the domain, www and Firebase's addresses only", async () => {
    const { PRODUCTION_HOSTS } = await import("../src/analytics/analytics");
    expect([...PRODUCTION_HOSTS].sort()).toEqual([
      "inkognitopdf.com",
      "inkognitopdf.firebaseapp.com",
      "inkognitopdf.web.app",
      "www.inkognitopdf.com",
    ]);
    expect(PRODUCTION_HOSTS).not.toContain("localhost");
  });
});

describe("the measurement question (asked once per browser)", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  beforeEach(() => store.clear());

  it("is asked only where the site measures, and locally", async () => {
    const { asksConsent } = await import("../src/analytics/hosts");
    for (const host of [
      "inkognitopdf.com",
      "www.inkognitopdf.com",
      "inkognitopdf.web.app",
      "inkognitopdf.firebaseapp.com",
      "localhost",
      "127.0.0.1",
    ])
      expect(asksConsent(host), host).toBe(true);
    for (const host of ["copy.example.org", "inkognitopdf--preview.web.app"])
      expect(asksConsent(host), host).toBe(false);
  });

  it("accepting or rejecting is kept under one key and not asked again", async () => {
    for (const choice of ["granted", "denied"] as const) {
      // Each choice in a fresh page.
      store.clear();
      vi.resetModules();
      const consent = await import("../src/analytics/consent");
      expect(consent.consentPending("inkognitopdf.com")).toBe(true);
      consent.setConsent(choice);
      expect(store.get(consent.CONSENT_KEY)).toBe(choice);
      // A new page load (landing or app) reads the same key: nothing to ask.
      vi.resetModules();
      const reloaded = await import("../src/analytics/consent");
      expect(reloaded.getConsent()).toBe(choice);
      expect(reloaded.consentPending("inkognitopdf.com")).toBe(false);
    }
  });

  it("is not shown on other hosts, unless opened from «Privacidad»", async () => {
    const consent = await import("../src/analytics/consent");
    expect(consent.consentPending("copy.example.org")).toBe(false);
    consent.reopenConsent();
    expect(consent.consentPending("copy.example.org")).toBe(true);
    consent.closeConsent();
    expect(consent.consentPending("copy.example.org")).toBe(false);
  });
});
