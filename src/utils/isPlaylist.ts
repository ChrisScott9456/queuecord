/**
 * Checks if the input is a playlist URL.
 * @param url - The input URL to check.
 * @returns True if the URL is a playlist, false otherwise.
 */
export function isPlaylist(url: string): boolean {
	return url.includes('list=');
}
