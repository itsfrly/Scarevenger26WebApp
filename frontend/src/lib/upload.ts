import imageCompression from "browser-image-compression";
import { MAX_UPLOAD_BYTES, type SubmissionFile } from "shared";
import { api } from "./api";

// Browsers cannot decode RAW, so these are detected and refused rather than
// silently uploaded at full size.
const RAW_EXTENSIONS = [
  "dng", "cr2", "cr3", "nef", "arw", "orf", "rw2", "raf", "srw", "pef",
];

export class UploadError extends Error {}

export function checkFile(file: File): void {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (RAW_EXTENSIONS.includes(ext)) {
    throw new UploadError(
      "That's a RAW photo, which phones can't display here. Switch your camera " +
        "back to normal photo mode and retake it.",
    );
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    throw new UploadError("Only photos and video can be uploaded.");
  }
}

/**
 * Compresses images before upload; video is passed through untouched, since
 * transcoding in the browser is far more than this needs.
 */
export async function prepare(file: File): Promise<File> {
  checkFile(file);

  if (file.type.startsWith("video/")) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UploadError(
        `That video is ${mb(file.size)}MB. Keep it under ${mb(MAX_UPLOAD_BYTES)}MB — ` +
          "a few seconds is plenty.",
      );
    }
    return file;
  }

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 2400,
    maxSizeMB: 2,
    useWebWorker: true,
    initialQuality: 0.8,
  });

  if (compressed.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("That photo is too large even after compression.");
  }
  return compressed;
}

/** Presign, then POST straight to S3. The file never passes through Lambda. */
export async function uploadOne(
  challengeId: string,
  file: File,
): Promise<SubmissionFile> {
  const prepared = await prepare(file);

  const presigned = await api.post<{
    key: string;
    url: string;
    fields: Record<string, string>;
  }>("/uploads", { challengeId, contentType: prepared.type });

  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) form.append(k, v);
  form.append("file", prepared);

  const res = await fetch(presigned.url, { method: "POST", body: form });
  if (!res.ok) {
    throw new UploadError(`Upload failed (${res.status}). Check your signal and retry.`);
  }

  return { key: presigned.key, contentType: prepared.type, size: prepared.size };
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
