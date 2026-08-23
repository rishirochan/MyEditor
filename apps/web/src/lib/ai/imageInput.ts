export const AI_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_AI_IMAGES = 3;
export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AI_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_AI_IMAGE_BASE64_CHARS =
  Math.ceil(MAX_AI_IMAGE_BYTES / 3) * 4;

export type AiImageMediaType = (typeof AI_IMAGE_MEDIA_TYPES)[number];

export interface AiImageInput {
  mediaType: AiImageMediaType;
  data: string;
}

export function isAiImageMediaType(value: string): value is AiImageMediaType {
  return AI_IMAGE_MEDIA_TYPES.includes(value as AiImageMediaType);
}

export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length * 3) / 4 - padding;
}

export function isValidAiImage(image: AiImageInput): boolean {
  if (
    image.data.length === 0 ||
    image.data.length % 4 !== 0 ||
    image.data.length > MAX_AI_IMAGE_BASE64_CHARS ||
    base64ByteLength(image.data) > MAX_AI_IMAGE_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
  ) {
    return false;
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(image.data.slice(0, 24)), (char) =>
      char.charCodeAt(0)
    );
  } catch {
    return false;
  }

  if (image.mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (image.mediaType === "image/webp") {
    return textAt(bytes, 0) === "RIFF" && textAt(bytes, 8) === "WEBP";
  }
  return [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => bytes[index] === byte
  );
}

function textAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + 4));
}
