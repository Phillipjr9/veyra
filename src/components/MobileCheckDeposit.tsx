import { useRef, type ChangeEvent, type RefObject } from "react";
import { Camera, Check, ImagePlus, RotateCcw, SunMedium } from "lucide-react";

export const CHECK_DEPOSIT_PATH = "/app/check-deposit";

export type CheckSide = "front" | "back";

const SIDE: Record<CheckSide, { title: string; hint: string; captured: string; shutter: string; file: string }> = {
  front: {
    title: "Front",
    hint: "Payee, amount and the MICR numbers along the bottom",
    captured: "Front captured",
    shutter: "Take photo of check front",
    file: "Photo of check front",
  },
  back: {
    title: "Back",
    hint: "Endorsed signature, written as the payee is printed",
    captured: "Back captured",
    shutter: "Take photo of check back",
    file: "Photo of check back",
  },
};

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}

/** Downscale a live frame to a JPEG data URL for on-device preview. Never uploaded. */
export function snapshotVideo(video: HTMLVideoElement): string {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) throw new Error("The camera is not ready yet. Try again in a moment.");
  return drawJpeg(video, srcW, srcH);
}

/** Read a library / native-camera photo into a JPEG data URL for on-device preview. Never uploaded. */
export async function readCheckPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo of the check.");
  if (file.size > 12_000_000) throw new Error("That photo is too large. Try a smaller image.");
  try {
    const bitmap = await createImageBitmap(file);
    try { return drawJpeg(bitmap, bitmap.width, bitmap.height); }
    finally { bitmap.close(); }
  } catch {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that photo."));
      reader.readAsDataURL(file);
    });
  }
}

function drawJpeg(source: CanvasImageSource, srcW: number, srcH: number): string {
  const max = 1600;
  const scale = Math.min(1, max / Math.max(srcW, srcH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not capture that photo.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function CheckCaptureSlot({
  side, photo, live, needsFile, videoRef, onOpenCamera, onCapture, onCancel, onRetake, onFile,
}: {
  side: CheckSide;
  photo: string;
  live: boolean;
  needsFile: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onOpenCamera: () => void;
  onCapture: () => void;
  onCancel: () => void;
  onRetake: () => void;
  onFile: (file: File) => void;
}) {
  const copy = SIDE[side];
  const fileRef = useRef<HTMLInputElement>(null);
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  };

  return (
    <div className="check-slot-wrap">
      <div className={`check-slot ${photo ? "captured" : live ? "is-live" : needsFile ? "needs-file" : ""}`}>
        {live && (
          <>
            <video ref={videoRef} className="check-viewfinder" autoPlay playsInline muted />
            <div className="check-scan-frame" aria-hidden="true"><span /><span /><span /><span /></div>
            <div className="check-scan-line" aria-hidden="true" />
            <div className="check-cam-controls">
              <button type="button" className="check-cam-cancel" onClick={onCancel}>Cancel</button>
              <button type="button" className="check-cam-shutter" aria-label={copy.shutter} onClick={onCapture}><span /></button>
            </div>
          </>
        )}
        {photo && !live && (
          <>
            <img className="check-shot" src={photo} alt={`${copy.title} of check`} />
            <span className="check-captured-tag"><Check size={12} /> {copy.captured}</span>
            <button type="button" className="check-retake" onClick={onRetake}><RotateCcw size={12} /> Retake</button>
          </>
        )}
        {!photo && !live && (
          <button type="button" className="check-slot-empty as-button" onClick={() => needsFile ? fileRef.current?.click() : onOpenCamera()}>
            {needsFile ? <SunMedium size={22} className="check-warn" /> : <Camera size={22} />}
            <strong>{copy.title}</strong>
            <small>{needsFile ? "Camera unavailable on this device. Use a photo instead." : copy.hint}</small>
            <span className="check-slot-cta">{needsFile ? "Choose a photo" : "Open camera"}</span>
          </button>
        )}
      </div>
      {!photo && (
        <label className="check-file-btn">
          <ImagePlus size={14} /> Take or choose a photo
          <input ref={fileRef} type="file" accept="image/*" capture="environment" aria-label={copy.file} onChange={choose} />
        </label>
      )}
    </div>
  );
}
