import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, Keyboard, X, Scan, RotateCcw } from 'lucide-react';
import { Modal } from './Modal';

/**
 * Barcode scan modal with two modes:
 * 1. USB scanner — most pharma barcode scanners emulate a keyboard. They
 *    type the barcode digits and press Enter. We listen for that on a
 *    focused input. Zero hardware setup, just plug in and go.
 * 2. Camera (browser) — fallback when no scanner exists. Uses the laptop
 *    camera + @zxing/browser (decoded entirely in the renderer, no cloud).
 *
 * On a successful read, calls onScan(code) and closes.
 */
export function BarcodeScanModal({
  open,
  onClose,
  onScan,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  hint?: string;
}) {
  const [mode, setMode] = useState<'usb' | 'camera'>('usb');
  const [usbBuffer, setUsbBuffer] = useState('');
  const usbInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the USB input the moment the modal opens.
  useEffect(() => {
    if (open && mode === 'usb') {
      const t = setTimeout(() => usbInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, mode]);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);

  useEffect(() => {
    if (!open || mode !== 'camera') {
      // Tear down camera when modal closes or switches to USB.
      controlsRef.current?.stop();
      controlsRef.current = null;
      readerRef.current = null;
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setCameraStarting(true);

    (async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        if (!devices || devices.length === 0) {
          setCameraError('No camera found on this device.');
          setCameraStarting(false);
          return;
        }
        // Prefer the back/environment camera if available.
        const preferred = devices.find((d) => /back|rear|environment/i.test(d.label)) || devices[0];
        if (!videoRef.current) {
          setCameraError('Camera surface not ready — try Rescan.');
          setCameraStarting(false);
          return;
        }
        const controls = await reader.decodeFromVideoDevice(
          preferred.deviceId,
          videoRef.current,
          (result, err) => {
            if (cancelled) return;
            if (result) {
              const text = result.getText();
              if (text) {
                controls.stop();
                onScan(text);
              }
            }
            // err is expected on every frame that doesn't contain a barcode — ignore.
            void err;
          }
        );
        controlsRef.current = controls;
        setCameraStarting(false);
      } catch (e: any) {
        if (!cancelled) {
          setCameraError(e?.message || String(e));
          setCameraStarting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      readerRef.current = null;
    };
  }, [open, mode, onScan]);

  const handleUsbSubmit = () => {
    const code = usbBuffer.trim();
    if (!code) return;
    setUsbBuffer('');
    onScan(code);
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan Barcode" size="md">
      <div className="space-y-3">
        <div className="flex gap-2 bg-gray-100 dark:bg-slate-700 p-1 rounded-lg">
          <button
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${mode === 'usb' ? 'bg-white dark:bg-slate-800 shadow-sm text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}`}
            onClick={() => setMode('usb')}
          >
            <Keyboard className="w-3.5 h-3.5" /> USB Scanner / Keyboard
          </button>
          <button
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${mode === 'camera' ? 'bg-white dark:bg-slate-800 shadow-sm text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}`}
            onClick={() => setMode('camera')}
          >
            <Camera className="w-3.5 h-3.5" /> Camera
          </button>
        </div>

        {hint && (
          <div className="text-[11px] text-gray-600 dark:text-slate-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded p-2">
            {hint}
          </div>
        )}

        {mode === 'usb' && (
          <div className="space-y-3">
            <div className="text-xs text-gray-600 dark:text-slate-300">
              Plug in a USB barcode scanner and click <b>Scan</b> on the strip/box.
              The scanner types the code into the box below and presses Enter automatically.
              Or type the code manually if needed.
            </div>
            <div className="relative">
              <Scan className="w-5 h-5 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2 animate-pulse" />
              <input
                ref={usbInputRef}
                className="input pl-10 font-mono text-base text-center"
                placeholder="Waiting for scan…"
                value={usbBuffer}
                onChange={(e) => setUsbBuffer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleUsbSubmit();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
              <button className="btn-primary text-xs" onClick={handleUsbSubmit} disabled={!usbBuffer.trim()}>
                Use Code
              </button>
            </div>
          </div>
        )}

        {mode === 'camera' && (
          <div className="space-y-3">
            <div className="text-xs text-gray-600 dark:text-slate-300">
              Hold the barcode steady inside the frame. Reads EAN-13 / UPC / Code128 — most pharma cartons.
            </div>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
              {cameraStarting && (
                <div className="absolute inset-0 flex items-center justify-center text-white text-xs">
                  Starting camera…
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-xs p-4 text-center bg-black/80">
                  <div className="font-semibold text-red-300 mb-1">Camera error</div>
                  <div>{cameraError}</div>
                  <button
                    className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white/20 rounded hover:bg-white/30"
                    onClick={() => { setCameraError(null); setMode('usb'); setTimeout(() => setMode('camera'), 50); }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button className="btn-secondary text-xs" onClick={onClose}>
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
