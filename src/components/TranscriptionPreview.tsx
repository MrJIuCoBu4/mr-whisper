import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const TARGET_WIDTH = 460;
const DEFAULT_AUTO_HIDE_MS = 8000;
const COPIED_RESET_MS = 1400;

interface PreviewState {
  text?: string;
  autoHideMs?: number;
  visible?: boolean;
}

/**
 * Window shown after dictation with the recognised text.
 *
 * The window itself is non-focusable (WIN: WS_EX_NOACTIVATE), so it never receives
 * keystrokes — Esc cannot work here, closing is the X button plus the auto-hide that
 * the main process runs. Copying therefore goes through the main process clipboard:
 * `navigator.clipboard` rejects in a non-focused, sandboxed renderer.
 */
export default function TranscriptionPreview() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [autoHideMs, setAutoHideMs] = useState(DEFAULT_AUTO_HIDE_MS);
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTick, setShowTick] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.electronAPI;

    const offText = api?.onPreviewText?.((incoming: string) => {
      setText(incoming);
      setIsVisible(true);
      setShowTick((tick) => tick + 1);
    });
    const offHide = api?.onPreviewHide?.(() => setIsVisible(false));

    // Pull once on mount: the window is created lazily and the first `preview-text`
    // can be sent before this component has subscribed.
    let disposed = false;
    api
      ?.getPreviewState?.()
      .then((state) => {
        if (disposed) return;
        const next = state as PreviewState;
        if (next?.text && next.visible) {
          setText(next.text);
          setAutoHideMs(next.autoHideMs ?? DEFAULT_AUTO_HIDE_MS);
          setIsVisible(true);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      offText?.();
      offHide?.();
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // The window is frameless with a fixed width, so its height has to follow the text.
  useEffect(() => {
    if (!isVisible) return undefined;
    const raf = window.requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      // The window is sized to fit the card exactly, so the root padding (p-1.5 above
      // and below) and the card border have to be added — otherwise the countdown bar
      // at the bottom is clipped.
      const CHROME = 12 + 2;
      window.electronAPI?.resizeTranscriptionPreviewWindow?.(
        TARGET_WIDTH,
        Math.ceil(el.scrollHeight) + CHROME
      );
    });
    return () => window.cancelAnimationFrame(raf);
  }, [text, isVisible, showTick]);

  const handleCopy = useCallback(async () => {
    await window.electronAPI?.writeClipboard?.(text);
    setCopied(true);
  }, [text]);

  const handleClose = useCallback(() => {
    window.electronAPI?.hideDictationPreview?.();
    setIsVisible(false);
  }, []);

  return (
    <div className="meeting-notification-window h-full w-full p-1.5">
      <style>{`
        @keyframes ow-preview-countdown { from { width: 100%; } to { width: 0%; } }
        .ow-preview-scroll::-webkit-scrollbar { display: none; }
        .ow-preview-scroll { scrollbar-width: none; }
      `}</style>

      {isVisible && (
        <div
          ref={cardRef}
          className="w-full overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-muted-foreground">
                {t("transcriptionPreview.ready", { defaultValue: "Готово" })}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t("settings.close", { defaultValue: "Закрыть" })}
              className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>

          <div className="ow-preview-scroll max-h-[220px] overflow-y-auto px-3 py-2.5">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {text}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-3"
            >
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied
                ? t("transcriptionPreview.copied", { defaultValue: "Скопировано" })
                : t("transcriptionPreview.copy", { defaultValue: "Копировать" })}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {t("transcriptionPreview.hint", { defaultValue: "Текст уже в буфере обмена" })}
            </span>
          </div>

          <div className="h-[3px] w-full bg-surface-3">
            <div
              key={showTick}
              className="h-full bg-emerald-500/70"
              style={{ animation: `ow-preview-countdown ${autoHideMs}ms linear forwards` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
