/**
 * Represents a song with detailed metadata.
 */
export interface Song {
	/**
	 * The unique identifier of the song.
	 */
	id: string;

	/**
	 * The title of the song.
	 */
	title: string;

	/**
	 * The URL of the song's thumbnail image.
	 */
	thumbnail: string;

	/**
	 * A brief description of the song.
	 */
	description: string;

	/**
	 * The URL of the channel where the song is hosted.
	 */
	channel_url: string;

	/**
	 * The duration of the song in seconds.
	 */
	duration: number;

	/**
	 * The number of views the song has received.
	 */
	view_count: number;

	/**
	 * The age restriction limit for the song.
	 */
	age_limit: number;

	/**
	 * The URL of the song's webpage.
	 */
	webpage_url: string;

	/**
	 * The number of likes the song has received.
	 */
	like_count: number;

	/**
	 * The name of the channel that uploaded the song.
	 */
	channel: string;

	/**
	 * The URL of the uploader's profile.
	 */
	uploader_url: string;

	/**
	 * The upload date of the song in YYYYMMDD format.
	 */
	upload_date: string;

	/**
	 * The timestamp of the song's upload in seconds since the Unix epoch.
	 */
	timestamp: number;

	/**
	 * The original URL of the song.
	 */
	original_url: string;

	/**
	 * The number of songs in the playlist containing this song.
	 */
	playlist_count: number;

	/**
	 * The name of the playlist containing this song.
	 */
	playlist: string;

	/**
	 * The unique identifier of the playlist containing this song.
	 */
	playlist_id: string;

	/**
	 * The title of the playlist containing this song.
	 */
	playlist_title: string;

	/**
	 * The name of the uploader of the playlist.
	 */
	playlist_uploader: string;

	/**
	 * The unique identifier of the playlist uploader.
	 */
	playlist_uploader_id: string;

	/**
	 * The name of the channel associated with the playlist.
	 */
	playlist_channel: string;

	/**
	 * The unique identifier of the playlist's channel.
	 */
	playlist_channel_id: string;

	/**
	 * The URL of the playlist's webpage.
	 */
	playlist_webpage_url: string;

	/**
	 * The full title of the song.
	 */
	fulltitle: string;

	/**
	 * The duration of the song as a formatted string (e.g., "3:45").
	 */
	duration_string: string;
}
