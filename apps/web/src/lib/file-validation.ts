export type UploadKind = "avatar" | "attachment"

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

const ATTACHMENT_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/zip",
])

export type ValidationError = { status: 400; message: string }

export const validateUpload = (
  kind: UploadKind,
  size: number,
  mimeType: string,
): ValidationError | null => {
  const maxBytes = kind === "avatar" ? AVATAR_MAX_BYTES : ATTACHMENT_MAX_BYTES
  if (size === 0) return { status: 400, message: "Empty file" }
  if (size > maxBytes) {
    return { status: 400, message: `File exceeds limit of ${maxBytes} bytes` }
  }
  const allowed = kind === "avatar" ? AVATAR_MIME : ATTACHMENT_MIME
  if (!allowed.has(mimeType)) {
    return { status: 400, message: `Mime type ${mimeType} not allowed for ${kind}` }
  }
  return null
}

export const extractExt = (filename: string): string => {
  const dot = filename.lastIndexOf(".")
  if (dot < 0 || dot === filename.length - 1) return ""
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16)
}

export const computeS3Key = (hash: string, ext: string): string => {
  const prefix = hash.slice(0, 2)
  return ext ? `${prefix}/${hash}.${ext}` : `${prefix}/${hash}`
}
