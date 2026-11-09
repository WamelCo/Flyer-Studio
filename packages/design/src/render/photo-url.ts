/** Unsplash serves any size from the same URL: ask for one close to what will be drawn. */
export function photoAtWidth(url: string, width: number) {
  return url.startsWith("https://images.unsplash.com/") ? url.replace(/([?&])w=\d+/, `$1w=${Math.round(width)}`) : url;
}
