import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { track } from "../analytics/analytics";
import { pagesBucket } from "../analytics/events";
import { t as translate, useT, type MessageKey } from "../i18n";
import type { OcrItem, PageEntry, ScanImage } from "../model/document";
import { newId } from "../model/operations";
import type { ScanMode } from "./enhance";
import { isConvex, type Point, type Quad } from "./homography";
import { fullQuad, type PaperSize } from "./pipeline";
import { CameraView, canUseCamera } from "./CameraView";
import { ScanClient } from "./scanClient";
import { scanPage } from "./scanImage";
import { Toast } from "../Toast";
import { useMobile } from "../useMobile";

/** One photographed page in the batch. */
interface Shot {
  id: string;
  name: string;
  /** The photo file, for the screen. */
  photoUrl: string;
  width: number;
  height: number;
  /** Detected corners, or null when no page was found. */
  detected: Quad | null;
  quad: Quad;
  mode: ScanMode;
  quarters: number;
  /** Rendered result for the current quad, mode and rotation. */
  result?: { url: string; scan: ScanImage; key: string };
  step: "crop" | "result";
  /** Taken with the live camera (spec 020). */
  live?: boolean;
}

const MODES = [
  { mode: "original", label: "scan.modeOriginal" },
  { mode: "gray", label: "scan.modeGray" },
  { mode: "bw", label: "scan.modeBw" },
] as const satisfies readonly { mode: ScanMode; label: MessageKey }[];

const renderKey = (s: Shot, paper: PaperSize) =>
  JSON.stringify([s.quad, s.mode, s.quarters, paper]);

async function bitmapUrl(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, "image/jpeg", 0.85),
  );
  return URL.createObjectURL(blob!);
}

interface ScanViewProps {
  onClose: () => void;
  /** Adds the pages to the open document; null when no document is open. */
  onAdd: ((pages: PageEntry[], items: OcrItem[]) => void) | null;
  /** Opens the pages (and their OCR text) as a new document in the editor. */
  onOpen: (pages: PageEntry[], items: OcrItem[]) => void;
}

/**
 * Scanner (spec 002): take or choose photos, adjust the corners, choose a
 * mode and save the pages as a PDF or add them to the open document.
 */
/** OCR of freshly scanned pages, in Spanish and English. */
async function recognizePages(
  pages: PageEntry[],
  report: (status: string) => void,
): Promise<OcrItem[]> {
  const [{ OcrEngine }, { pageImage, recognizeImage, textRotation }] =
    await Promise.all([import("../ocr/ocrClient"), import("../ocr/recognize")]);
  const engine = new OcrEngine();
  const lang = "spa+eng";
  try {
    const items: OcrItem[] = [];
    for (const [i, page] of pages.entries()) {
      report(translate("scan.recognizing", i + 1, pages.length));
      const worker = await engine.get(lang);
      const image = await pageImage(null, page);
      items.push({
        kind: "ocr",
        id: newId("ocr"),
        pageId: page.id,
        lang,
        rotate: textRotation(image.geometry),
        lines: await recognizeImage(worker, image),
      });
    }
    return items;
  } finally {
    await engine.cancel();
  }
}

/** Scanner settings, remembered on this device (spec 009, CA1). */
interface ScanSettings {
  autoDetect: boolean;
  paper: PaperSize;
  withOcr: boolean;
  /** Live camera: take each page when it holds still (spec 020). */
  autoCapture: boolean;
}

const SETTINGS_KEY = "inkognitopdf.scan";
const DEFAULT_SETTINGS: ScanSettings = {
  autoDetect: true,
  paper: "auto",
  withOcr: false,
  autoCapture: true,
};

function loadSettings(): ScanSettings {
  try {
    const saved = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? "{}",
    ) as Partial<ScanSettings>;
    return {
      autoDetect:
        typeof saved.autoDetect === "boolean"
          ? saved.autoDetect
          : DEFAULT_SETTINGS.autoDetect,
      paper: (["auto", "a4", "letter"] as PaperSize[]).includes(
        saved.paper as PaperSize,
      )
        ? (saved.paper as PaperSize)
        : DEFAULT_SETTINGS.paper,
      withOcr:
        typeof saved.withOcr === "boolean"
          ? saved.withOcr
          : DEFAULT_SETTINGS.withOcr,
      autoCapture:
        typeof saved.autoCapture === "boolean"
          ? saved.autoCapture
          : DEFAULT_SETTINGS.autoCapture,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function storeSettings(settings: ScanSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private windows may refuse storage: the settings last this session.
  }
}

/** Size of an element's content box, kept up to date. */
function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setSize({
        w:
          el.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        h:
          el.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The largest size of a `w`×`h` image that fits in `box`, whole. */
function contain(
  box: { w: number; h: number } | null,
  w: number,
  h: number,
): { width: number; height: number } | undefined {
  if (!box || box.w <= 0 || box.h <= 0) return undefined;
  const k = Math.min(box.w / w, box.h / h);
  return { width: Math.floor(w * k), height: Math.floor(h * k) };
}

export function ScanView({ onClose, onAdd, onOpen }: ScanViewProps) {
  const t = useT();
  const mobile = useMobile();
  const client = useRef<ScanClient | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [current, setCurrent] = useState(0);
  const [settings, setSettings] = useState(loadSettings);
  const { autoDetect, withOcr, autoCapture } = settings;
  // Spec 020, ID card mode: each photo is one side of a card, at its real
  // size, and every two go on one A4 page. Not remembered: it is for one scan.
  const [idCard, setIdCard] = useState(false);
  const paper: PaperSize = idCard ? "card" : settings.paper;
  const [camera, setCamera] = useState(false);
  const liveCamera = canUseCamera();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Phone layout (spec 009): editing one photo, or the list of pages.
  const [view, setView] = useState<"edit" | "pages">("edit");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Spec 027: "+" offers the live camera, a new photo or the gallery.
  const [addOpen, setAddOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(mainRef);
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  });

  const change = (patch: Partial<ScanSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      storeSettings(next);
      return next;
    });

  useEffect(() => {
    const c = new ScanClient();
    client.current = c;
    return () => {
      c.terminate();
      client.current = null;
      for (const s of shotsRef.current) {
        URL.revokeObjectURL(s.photoUrl);
        if (s.result) URL.revokeObjectURL(s.result.url);
      }
    };
  }, []);

  const update = (id: string, change: (s: Shot) => Shot) =>
    setShots((all) => all.map((s) => (s.id === id ? change(s) : s)));

  /**
   * Adds a photo to the batch: the worker looks for the page in it. A photo
   * from the live camera whose page was found needs no cropping (spec 020).
   */
  const addShot = async (
    full: ImageBitmap,
    name: string,
    photoUrl: string,
    live: boolean,
  ): Promise<Shot> => {
    const id = newId("scan");
    const found = await client.current!.add(id, full, true);
    const detected = found.found ? found.quad : null;
    const shot: Shot = {
      id,
      name,
      photoUrl,
      width: found.width,
      height: found.height,
      detected,
      quad:
        autoDetect && detected ? detected : fullQuad(found.width, found.height),
      // An ID card keeps its colours, or the mode of its other sides (spec
      // 027); a sheet becomes a photocopy.
      mode: idCard ? (shotsRef.current[0]?.mode ?? "original") : "bw",
      quarters: 0,
      step: live && autoDetect && detected ? "result" : "crop",
      live,
    };
    setShots((all) => [...all, shot]);
    if (autoDetect && !detected) setNotice(t("scan.pageNotFound"));
    return shot;
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !client.current) return;
    setNotice(null);
    const start = shotsRef.current.length;
    let added = 0;
    for (const file of Array.from(files)) {
      setBusy(t("scan.reading", file.name));
      try {
        // EXIF orientation is applied here, before anything else (CA1).
        const full = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
        // The browser shows the file itself, upright (EXIF) like the bitmap.
        await addShot(full, file.name, URL.createObjectURL(file), false);
        added++;
      } catch {
        setNotice(t("scan.unreadable", file.name));
      }
    }
    setBusy(null);
    if (added > 0) {
      setCurrent(start);
      setView("edit");
    }
  };

  const fileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void addFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  };

  // Spec 020: the live camera, and where it leaves the user when done.
  const cameraStart = useRef(0);
  const openCamera = () => {
    setNotice(null);
    cameraStart.current = shotsRef.current.length;
    setCamera(true);
  };
  const cameraShot = async (frame: ImageBitmap) => {
    const url = await bitmapUrl(frame);
    await addShot(
      frame,
      t("scan.cameraName", shotsRef.current.length + 1),
      url,
      true,
    );
  };
  const closeCamera = () => {
    setCamera(false);
    const all = shotsRef.current;
    const start = cameraStart.current;
    if (all.length === start) return;
    // A page the camera could not find is cropped by hand first.
    const crop = all.findIndex((s, i) => i >= start && s.step === "crop");
    const shown = crop >= 0 ? crop : start;
    setCurrent(shown);
    setView(crop >= 0 || !mobile ? "edit" : "pages");
    // The other cropped pages get their result too, for the thumbnails.
    void (async () => {
      for (const [i, s] of all.entries())
        if (i >= start && i !== shown && s.step === "result")
          await render(s).catch(() => undefined);
    })();
  };

  /** Renders a shot (in the worker) if its result is out of date. */
  const render = async (shot: Shot): Promise<Shot> => {
    const key = renderKey(shot, paper);
    if (shot.result?.key === key) return shot;
    const result = await client.current!.render(
      shot.id,
      shot.quad,
      shot.mode,
      shot.quarters,
      paper,
    );
    const url = await bitmapUrl(result.preview);
    result.preview.close();
    const next = { ...shot, result: { url, scan: result.scan, key } };
    const old = shotsRef.current.find((s) => s.id === shot.id)?.result?.url;
    setShots((all) =>
      all.map((s) => (s.id === shot.id ? { ...s, result: next.result } : s)),
    );
    if (old && old !== url) URL.revokeObjectURL(old);
    return next;
  };

  const shot = shots[current];

  /**
   * Spec 027: in the ID card mode the mode is the whole scan's, as every side
   * goes on the same photocopy; otherwise it is the shown page's.
   */
  const setMode = (mode: ScanMode) =>
    setShots((all) =>
      all.map((s) => (idCard || s.id === shot?.id ? { ...s, mode } : s)),
    );

  // Spec 027: the other sides follow a change of mode, thumbnails included.
  const modes = shots.map((s) => s.mode).join();
  useEffect(() => {
    if (!idCard) return;
    let stale = false;
    void (async () => {
      for (const s of shotsRef.current)
        if (!stale && s.step === "result" && s.id !== shot?.id)
          await render(s).catch(() => undefined);
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idCard, modes, paper]);

  // Keep the shown result in step with the mode, rotation and paper size.
  useEffect(() => {
    if (!shot || shot.step !== "result") return;
    if (shot.result?.key === renderKey(shot, paper)) return;
    let stale = false;
    render(shot).catch((e: unknown) => {
      if (!stale) setNotice(e instanceof Error ? e.message : String(e));
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id, shot?.step, shot?.mode, shot?.quarters, shot?.quad, paper]);

  const remove = (index: number) => {
    const s = shots[index];
    if (!s) return;
    void client.current?.drop(s.id);
    URL.revokeObjectURL(s.photoUrl);
    if (s.result) URL.revokeObjectURL(s.result.url);
    setShots((all) => all.filter((x) => x.id !== s.id));
    setCurrent((c) => Math.max(0, Math.min(c, shots.length - 2)));
    if (shots.length === 1) setView("edit");
  };

  const move = (index: number, to: number) => {
    if (to < 0 || to >= shots.length) return;
    setShots((all) => {
      const next = [...all];
      const [s] = next.splice(index, 1);
      next.splice(to, 0, s!);
      return next;
    });
    setCurrent(to);
  };

  /** Every shot rendered, as document pages. */
  const finish = async (): Promise<PageEntry[] | null> => {
    setBusy(t("scan.processingPages"));
    try {
      const pages: PageEntry[] = [];
      const all = shotsRef.current;
      if (idCard) {
        // Spec 020: front and back on one A4 page, at their real size.
        for (let i = 0; i < all.length; i += 2) {
          const { scan } = await client.current!.compose(
            all.slice(i, i + 2).map((s) => ({
              id: s.id,
              quad: s.quad,
              mode: s.mode,
              quarters: s.quarters,
            })),
          );
          pages.push(scanPage(newId("scan-page"), scan));
        }
        return pages;
      }
      for (const s of all) {
        const done = await render(s);
        pages.push(scanPage(newId("scan-page"), done.result!.scan));
      }
      return pages;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Spec 011: a scan, with its page count and the mode of the first page. */
  const trackScan = (count: number) =>
    track("scan_document", {
      pages: pagesBucket(count),
      ...(shots[0] ? { mode: shots[0].mode } : {}),
      capture: shots.some((s) => s.live) ? "live" : "photo",
      card: idCard ? "yes" : "no",
    });

  const savePdf = async () => {
    const pages = await finish();
    if (!pages) return;
    try {
      // HU7 (spec 003): a searchable PDF straight from the scanner.
      const items = withOcr ? await recognizePages(pages, setBusy) : [];
      setBusy(t("scan.saving"));
      const { buildPdf, downloadPdf } = await import("../editor/save");
      const { bytes } = await buildPdf(null, { pages, items });
      downloadPdf(bytes, t("scan.fileName"));
      trackScan(pages.length);
      if (withOcr) track("ocr_run", { pages: pagesBucket(pages.length) });
      track("save_document", {
        pages: pagesBucket(pages.length),
        source: "scan",
      });
      setToast(t("scan.saved"));
    } catch (e) {
      setNotice(
        t("scan.saveFailed", e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(null);
    }
  };

  /**
   * Hands the pages to the editor, with their text when "Recognize text" is
   * checked (spec 009, CA9), and closes the scanner.
   */
  const deliver = async () => {
    const pages = await finish();
    if (!pages) return;
    let items: OcrItem[] = [];
    if (withOcr)
      try {
        items = await recognizePages(pages, setBusy);
      } catch (e) {
        setNotice(
          t("scan.ocrFailed", e instanceof Error ? e.message : String(e)),
        );
        return;
      } finally {
        setBusy(null);
      }
    trackScan(pages.length);
    if (onAdd) onAdd(pages, items);
    else onOpen(pages, items);
    onClose();
  };

  const valid = shot ? isConvex(shot.quad) : false;
  const rendering =
    shot?.step === "result" && shot.result?.key !== renderKey(shot, paper);
  const status = busy ?? (rendering ? t("scan.processing") : notice);
  const toastView = toast && (
    <Toast message={toast} onDone={() => setToast(null)} />
  );

  const resetQuad = (full: boolean) =>
    shot &&
    update(shot.id, (s) => ({
      ...s,
      quad: full
        ? fullQuad(s.width, s.height)
        : (s.detected ?? fullQuad(s.width, s.height)),
    }));
  const rotate = (quarters: number) =>
    shot &&
    update(shot.id, (s) => ({ ...s, quarters: (s.quarters + quarters) % 4 }));

  const modeButtons = shot && (
    <span
      role="group"
      aria-label={t("scan.mode")}
      className={mobile ? "scan-modes" : undefined}
    >
      {MODES.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={shot.mode === mode}
          onClick={() => setMode(mode)}
        >
          {t(label)}
        </button>
      ))}
    </span>
  );

  const settingsFields = (
    <>
      <label className="scan-check">
        <input
          type="checkbox"
          checked={autoDetect}
          onChange={(e) => change({ autoDetect: e.currentTarget.checked })}
        />
        {t("scan.autoDetect")}
      </label>
      <label className="scan-size">
        {t("scan.size")}{" "}
        <select
          aria-label={t("scan.pageSize")}
          value={settings.paper}
          disabled={idCard}
          onChange={(e) =>
            change({ paper: e.currentTarget.value as PaperSize })
          }
        >
          <option value="auto">{t("scan.sizeAuto")}</option>
          <option value="a4">A4</option>
          <option value="letter">{t("scan.sizeLetter")}</option>
        </select>
      </label>
      <label className="scan-check">
        <input
          type="checkbox"
          checked={withOcr}
          onChange={(e) => change({ withOcr: e.currentTarget.checked })}
        />
        {t("scan.withOcr")}
      </label>
    </>
  );

  const idCardField = (
    <label className="scan-check">
      <input
        type="checkbox"
        checked={idCard}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          setIdCard(on);
          // Spec 027: the sides already taken share the shown one's mode.
          if (on && shot)
            setShots((all) => all.map((s) => ({ ...s, mode: shot.mode })));
        }}
      />
      {t("scan.idCard")}
    </label>
  );

  const cameraView = camera && (
    <CameraView
      detect={(frame) => client.current!.detect(frame)}
      count={shots.length}
      auto={autoCapture}
      onAuto={(auto) => change({ autoCapture: auto })}
      idCard={idCard}
      onShot={cameraShot}
      onDone={closeCamera}
      onError={() => {
        setCamera(false);
        setNotice(t("scan.cameraFailed"));
      }}
    />
  );

  if (mobile) {
    const isFull =
      !!shot &&
      JSON.stringify(shot.quad) ===
        JSON.stringify(fullQuad(shot.width, shot.height));
    const showDetected = isFull && !!shot?.detected;
    /** After the mode: the next photo still to crop, or the list of pages. */
    const next = () => {
      const after = shots.findIndex((s, i) => i > current && s.step === "crop");
      const any =
        after >= 0 ? after : shots.findIndex((s) => s.step === "crop");
      if (any >= 0) setCurrent(any);
      else setView("pages");
    };
    const heading = !shot
      ? null
      : view === "pages"
        ? idCard
          ? t("scan.idSides", shots.length)
          : t("scan.pageCount", shots.length)
        : t("scan.pageOf", current + 1, shots.length);

    let content: ReactNode;
    let bottom: ReactNode = null;
    if (!shot) {
      content = (
        <div className="scan-empty">
          <p className="hint">{t("scan.hint")}</p>
          {liveCamera && (
            <button type="button" className="primary" onClick={openCamera}>
              <ScanIcon name="live" />
              {t("scan.cameraOpen")}
            </button>
          )}
          <button
            type="button"
            className={liveCamera ? undefined : "primary"}
            onClick={() => cameraRef.current?.click()}
          >
            <ScanIcon name="camera" />
            {t("scan.takePhoto")}
          </button>
          <button type="button" onClick={() => imagesRef.current?.click()}>
            <ScanIcon name="images" />
            {t("scan.chooseImages")}
          </button>
          {idCardField}
        </div>
      );
    } else if (view === "edit" && shot.step === "crop") {
      content = (
        <>
          <CropEditor
            shot={shot}
            fit={contain(box, shot.width, shot.height)}
            onChange={(quad) => update(shot.id, (s) => ({ ...s, quad }))}
          />
          {!valid && (
            <p className="error scan-float" role="alert">
              {t("scan.cornersCross")}
            </p>
          )}
        </>
      );
      bottom = (
        <div className="scan-row">
          <button type="button" onClick={() => resetQuad(!showDetected)}>
            {showDetected ? t("scan.detectedEdges") : t("scan.fullImage")}
          </button>
          <button
            type="button"
            className="primary grow"
            disabled={!valid || !!busy}
            onClick={() => update(shot.id, (s) => ({ ...s, step: "result" }))}
          >
            {t("scan.continue")}
          </button>
        </div>
      );
    } else {
      const result = shot.result;
      content = result && (
        <img
          className="scan-result"
          src={result.url}
          alt={t("scan.resultAlt", current + 1)}
          data-mode={shot.mode}
          style={contain(box, result.scan.width, result.scan.height)}
        />
      );
      bottom =
        view === "edit" ? (
          <>
            {modeButtons}
            <div className="scan-row">
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.rotateLeft")}
                onClick={() => rotate(3)}
              >
                <ScanIcon name="rotateLeft" />
              </button>
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.rotateRight")}
                onClick={() => rotate(1)}
              >
                <ScanIcon name="rotateRight" />
              </button>
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.adjustEdges")}
                onClick={() => update(shot.id, (s) => ({ ...s, step: "crop" }))}
              >
                <ScanIcon name="crop" />
              </button>
              <button
                type="button"
                className="primary grow"
                disabled={!!busy}
                onClick={next}
              >
                {t("scan.continue")}
              </button>
            </div>
          </>
        ) : (
          <>
            {modeButtons}
            <div className="scan-row scan-page-tools">
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.moveBefore", current + 1)}
                disabled={current === 0}
                onClick={() => move(current, current - 1)}
              >
                <ScanIcon name="left" />
              </button>
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.moveAfter", current + 1)}
                disabled={current === shots.length - 1}
                onClick={() => move(current, current + 1)}
              >
                <ScanIcon name="right" />
              </button>
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.editPage", current + 1)}
                onClick={() => setView("edit")}
              >
                <ScanIcon name="crop" />
              </button>
              <button
                type="button"
                className="scan-icon"
                aria-label={t("scan.remove", current + 1)}
                onClick={() => remove(current)}
              >
                <ScanIcon name="trash" />
              </button>
            </div>
            <ol className="scan-strip" aria-label={t("scan.pages")}>
              {shots.map((s, i) => (
                <li
                  key={s.id}
                  aria-current={i === current ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="scan-thumb"
                    aria-label={t("scan.thumb", i + 1, s.name)}
                    onClick={() => setCurrent(i)}
                  >
                    <img src={s.result?.url ?? s.photoUrl} alt="" />
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="scan-thumb scan-add"
                  aria-label={t("scan.addPage")}
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen(true)}
                >
                  <ScanIcon name="plus" />
                </button>
              </li>
            </ol>
            <div className="scan-row">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void savePdf()}
              >
                {t("scan.savePdf")}
              </button>
              <button
                type="button"
                className="primary grow"
                disabled={!!busy}
                onClick={() => void deliver()}
              >
                {onAdd ? t("scan.addToDocument") : t("scan.openInEditor")}
              </button>
            </div>
          </>
        );
    }

    return (
      <div
        className="scan-view scan-mobile"
        role="dialog"
        aria-label={t("scan.title")}
      >
        <header className="scan-top">
          <button
            type="button"
            className="scan-icon"
            aria-label={t("scan.close")}
            onClick={onClose}
          >
            <ScanIcon name="close" />
          </button>
          <div className="scan-heading">
            <strong>{t("scan.shortTitle")}</strong>
            {heading && <span>{heading}</span>}
          </div>
          <button
            type="button"
            className="scan-icon"
            aria-label={t("scan.settings")}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <ScanIcon name="settings" />
          </button>
        </header>
        <div className="scan-main" ref={mainRef}>
          {content}
          {status && (
            <p
              className="scan-float scan-status"
              role="status"
              onClick={() => setNotice(null)}
            >
              {status}
            </p>
          )}
        </div>
        {bottom && <div className="scan-bottom">{bottom}</div>}
        {settingsOpen && (
          <>
            <div
              className="sheet-backdrop"
              onClick={() => setSettingsOpen(false)}
            />
            <div
              className="mobile-sheet scan-settings"
              role="dialog"
              aria-label={t("scan.settings")}
            >
              <header>
                <h2>{t("scan.settings")}</h2>
                <button
                  type="button"
                  aria-label={t("scan.closeSettings")}
                  onClick={() => setSettingsOpen(false)}
                >
                  ×
                </button>
              </header>
              {settingsFields}
              <p className="hint">{t("scan.settingsRemembered")}</p>
              {idCardField}
            </div>
          </>
        )}
        {addOpen && (
          <>
            <div className="sheet-backdrop" onClick={() => setAddOpen(false)} />
            <div
              className="mobile-sheet scan-add-sheet"
              role="dialog"
              aria-label={t("scan.addPage")}
            >
              <header>
                <h2>{t("scan.addPage")}</h2>
                <button
                  type="button"
                  aria-label={t("scan.closeAdd")}
                  onClick={() => setAddOpen(false)}
                >
                  ×
                </button>
              </header>
              {liveCamera && (
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    openCamera();
                  }}
                >
                  <ScanIcon name="live" />
                  {t("scan.cameraOpen")}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  cameraRef.current?.click();
                }}
              >
                <ScanIcon name="camera" />
                {t("scan.takePhoto")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  imagesRef.current?.click();
                }}
              >
                <ScanIcon name="images" />
                {t("scan.chooseImages")}
              </button>
            </div>
          </>
        )}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          data-testid="scan-camera"
          hidden
          onChange={fileChange}
        />
        <input
          ref={imagesRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          data-testid="scan-images"
          hidden
          onChange={fileChange}
        />
        {cameraView}
        {toastView}
      </div>
    );
  }

  return (
    <div className="scan-view" role="dialog" aria-label={t("scan.title")}>
      <div className="scan-toolbar">
        <label className="open-button">
          {t("scan.takePhoto")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="scan-camera"
            onChange={fileChange}
          />
        </label>
        <label className="open-button">
          {t("scan.chooseImages")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            data-testid="scan-images"
            onChange={fileChange}
          />
        </label>
        {liveCamera && (
          <button type="button" onClick={openCamera}>
            {t("scan.cameraOpen")}
          </button>
        )}
        {settingsFields}
        {idCardField}
        <span className="scan-spacer" />
        <button
          type="button"
          className="primary"
          disabled={shots.length === 0 || !!busy}
          onClick={() => void savePdf()}
        >
          {t("scan.savePdf")}
        </button>
        <button
          type="button"
          disabled={shots.length === 0 || !!busy}
          onClick={() => void deliver()}
        >
          {onAdd ? t("scan.addToDocument") : t("scan.openInEditor")}
        </button>
        <button type="button" onClick={onClose}>
          {t("scan.close")}
        </button>
      </div>

      {status && (
        <p className="scan-status" role="status">
          {status}
        </p>
      )}
      {idCard && shots.length > 0 && (
        <p className="hint scan-id-hint">
          {t("scan.idHint")} {t("scan.idSides", shots.length)}.
        </p>
      )}

      <div className="scan-body">
        {!shot && <p className="hint">{t("scan.hint")}</p>}
        {shot && shot.step === "crop" && (
          <div className="scan-stage">
            <CropEditor
              shot={shot}
              onChange={(quad) => update(shot.id, (s) => ({ ...s, quad }))}
            />
            {!valid && (
              <p className="error" role="alert">
                {t("scan.cornersCross")}
              </p>
            )}
            <div className="scan-actions">
              <button type="button" onClick={() => resetQuad(false)}>
                {t("scan.detectedEdges")}
              </button>
              <button type="button" onClick={() => resetQuad(true)}>
                {t("scan.fullImage")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!valid}
                onClick={() =>
                  update(shot.id, (s) => ({ ...s, step: "result" }))
                }
              >
                {t("scan.continue")}
              </button>
            </div>
          </div>
        )}
        {shot && shot.step === "result" && (
          <div className="scan-stage">
            {shot.result && (
              <img
                className="scan-result"
                src={shot.result.url}
                alt={t("scan.resultAlt", current + 1)}
                data-mode={shot.mode}
              />
            )}
            <div className="scan-actions">
              {modeButtons}
              <button
                type="button"
                aria-label={t("scan.rotateLeft")}
                onClick={() => rotate(3)}
              >
                ⟲
              </button>
              <button
                type="button"
                aria-label={t("scan.rotateRight")}
                onClick={() => rotate(1)}
              >
                ⟳
              </button>
              <button
                type="button"
                onClick={() => update(shot.id, (s) => ({ ...s, step: "crop" }))}
              >
                {t("scan.adjustEdges")}
              </button>
            </div>
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <ol className="scan-strip" aria-label={t("scan.pages")}>
          {shots.map((s, i) => (
            <li key={s.id} aria-current={i === current ? "true" : undefined}>
              <button
                type="button"
                className="scan-thumb"
                aria-label={t("scan.thumb", i + 1, s.name)}
                onClick={() => setCurrent(i)}
              >
                <img src={s.result?.url ?? s.photoUrl} alt="" />
              </button>
              <span className="scan-thumb-actions">
                <button
                  type="button"
                  aria-label={t("scan.moveBefore", i + 1)}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={t("scan.moveAfter", i + 1)}
                  disabled={i === shots.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  aria-label={t("scan.remove", i + 1)}
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {cameraView}
      {toastView}
    </div>
  );
}

const ICON_PATHS = {
  live: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  images: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m21 16-5-5-9 8" />
    </>
  ),
  rotateLeft: (
    <>
      <path d="M4 4v5h5" />
      <path d="M5.1 15a7 7 0 1 0 .9-7.6L4 9" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M20 4v5h-5" />
      <path d="M18.9 15a7 7 0 1 1-.9-7.6L20 9" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
} as const;

function ScanIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="scan-svg" viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

const CORNER_NAMES = [
  "scan.cornerTopLeft",
  "scan.cornerTopRight",
  "scan.cornerBottomRight",
  "scan.cornerBottomLeft",
] as const satisfies readonly MessageKey[];

/** The photo with four draggable corners and a magnifier (HU3, CA3). */
function CropEditor({
  shot,
  fit,
  onChange,
}: {
  shot: Shot;
  /** Size to show the photo at (phone layout); by default, CSS limits. */
  fit?: { width: number; height: number };
  onChange: (quad: Quad) => void;
}) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ index: number; at: Point } | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => setSize({ w: img.clientWidth, h: img.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    return () => observer.disconnect();
  }, [shot.photoUrl]);

  const k = size ? size.w / shot.width : 0;
  const toPhoto = (e: ReactPointerEvent): Point => {
    const rect = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(shot.width, Math.max(0, (e.clientX - rect.left) / k)),
      y: Math.min(shot.height, Math.max(0, (e.clientY - rect.top) / k)),
    };
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const at = toPhoto(e);
    const quad = shot.quad.map((p, i) => (i === drag.index ? at : p)) as Quad;
    setDrag({ index: drag.index, at });
    onChange(quad);
  };

  const valid = isConvex(shot.quad);
  const points = shot.quad.map((p) => `${p.x * k},${p.y * k}`).join(" ");
  const ZOOM = 3;
  const LENS = 120;

  return (
    <div className="crop-editor">
      <img
        ref={imgRef}
        src={shot.photoUrl}
        alt={t("scan.photoAlt", shot.name)}
        draggable={false}
        style={fit}
        onLoad={(e) =>
          setSize({
            w: e.currentTarget.clientWidth,
            h: e.currentTarget.clientHeight,
          })
        }
      />
      {size && (
        <svg
          className="crop-overlay"
          width={size.w}
          height={size.h}
          onPointerMove={onMove}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
          data-valid={valid ? "true" : "false"}
        >
          <polygon
            points={points}
            className={valid ? "crop-quad" : "crop-quad invalid"}
          />
          {shot.quad.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x * k}
                cy={p.y * k}
                r={22}
                className="crop-hit"
                role="slider"
                aria-label={t(CORNER_NAMES[i]!)}
                aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
                data-corner={i}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.ownerSVGElement?.setPointerCapture(
                    e.pointerId,
                  );
                  setDrag({ index: i, at: p });
                }}
              />
              <circle cx={p.x * k} cy={p.y * k} r={9} className="crop-handle" />
            </g>
          ))}
        </svg>
      )}
      {drag && size && (
        <div
          className="crop-lens"
          data-testid="crop-lens"
          style={{
            width: LENS,
            height: LENS,
            // Above and to the side of the finger, so it is not covered.
            left: Math.min(
              size.w - LENS,
              Math.max(0, drag.at.x * k - LENS - 20),
            ),
            top: Math.max(0, drag.at.y * k - LENS - 40),
            backgroundImage: `url(${shot.photoUrl})`,
            backgroundSize: `${size.w * ZOOM}px ${size.h * ZOOM}px`,
            backgroundPosition: `${LENS / 2 - drag.at.x * k * ZOOM}px ${
              LENS / 2 - drag.at.y * k * ZOOM
            }px`,
          }}
        />
      )}
    </div>
  );
}
