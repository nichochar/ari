export const MAX_CHAT_PHOTOS = 8;
export const MAX_CHAT_PHOTO_SIZE = 6_000_000;

export function photoLimitError(images: string[]): string | undefined {
  if (images.length > MAX_CHAT_PHOTOS) return `Attach up to ${MAX_CHAT_PHOTOS} photos per message.`;
  if (images.reduce((size, image) => size + image.length, 0) > MAX_CHAT_PHOTO_SIZE)
    return 'These photos are too large to send together. Remove a photo or send them in separate messages.';
}
