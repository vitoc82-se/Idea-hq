// Profile pictures are stored inline on User.image as a small data URL (the
// settings page downscales to 256×256 before upload), so no blob storage.
export const AVATAR_MAX_LENGTH = 200_000;

const AVATAR_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/webp;base64,",
];

// Returns an error message, or null when `image` is acceptable (null clears it).
export function avatarError(image: unknown): string | null {
  if (image === null) return null;
  if (typeof image !== "string" || !AVATAR_PREFIXES.some((p) => image.startsWith(p))) {
    return "Image must be a PNG, JPEG or WebP data URL";
  }
  if (image.length > AVATAR_MAX_LENGTH) {
    return "Image is too large (max 200 KB)";
  }
  return null;
}

// Only short URLs (e.g. a Google profile photo) may ride in the JWT cookie; a
// data URL would bloat every request. The app layout reads User.image instead.
export function sessionSafeImage(image: string | null | undefined): string | null {
  return image && !image.startsWith("data:") && image.length < 1000 ? image : null;
}
