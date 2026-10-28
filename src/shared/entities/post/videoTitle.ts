/** A generic block title («Video», «Видео», «Видео 2»; any case) says nothing. */
const GENERIC_VIDEO_TITLE = /^(video|видео)(\s+\d+)?$/i;

/** True for an empty or generic video title (Story 4.1 rule). */
export function isGenericVideoTitle(videoTitle: string): boolean {
  const title = videoTitle.trim();
  return title.length === 0 || GENERIC_VIDEO_TITLE.test(title);
}

/**
 * The title a video is shown by outside its post (the Continue card, Story
 * 4.7): its own title, else (empty or generic) the post title.
 */
export function videoDisplayTitle(videoTitle: string, postTitle: string): string {
  return isGenericVideoTitle(videoTitle) ? postTitle.trim() : videoTitle.trim();
}
