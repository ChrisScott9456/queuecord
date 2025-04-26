import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, AudioPlayer, VoiceConnectionStatus } from '@discordjs/voice';
import { VoiceConnection } from '@discordjs/voice';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { isValidURL } from '../utils/isValidURL';
import { VoiceBasedChannel } from 'discord.js';
import { QueueCordEvents } from '../enums/Events';
import { Song } from '../interfaces/Song';

const execAsync = promisify(exec);

export class QueueCord extends EventEmitter {
	private connection: VoiceConnection;
	private player: AudioPlayer = createAudioPlayer();
	private queue: Song[] = []; // Update queue to use Song interface
	private state: AudioPlayerStatus = AudioPlayerStatus.Idle; // Idle by default
	private currentSong: Song = null; // Current song being played

	constructor() {
		super();

		// Update the player's state when it changes
		this.player.on('stateChange', (oldState, newState) => {
			this.state = newState.status;
			this.emit(newState.status, this.currentSong);
		});
	}

	/**
	 * Overrides the emit method to restrict events to QueueCordEvents.
	 * @param event The event to emit.
	 * @param args The arguments to pass to the event listeners.
	 */
	emit<E extends keyof QueueCordEvents>(event: E, ...args: Parameters<QueueCordEvents[E]>): boolean {
		// TypeScript now knows the correct arguments per event 🔥
		return super.emit(event, ...args);
	}

	on<E extends keyof QueueCordEvents>(event: E, listener: QueueCordEvents[E]): this {
		return super.on(event, listener);
	}

	/**
	 * Joins a voice channel if not already connected.
	 * @param channel The voice channel to join.
	 */
	async joinChannel(channel: VoiceBasedChannel) {
		if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Disconnected) {
			return; // Already connected to a voice channel
		}

		// Joins the voice channel
		this.connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
		});

		// Subscribes to an audio player, allowing the player to play audio on this voice connection.
		this.connection.subscribe(this.player);

		this.connection.on(VoiceConnectionStatus.Disconnected, () => {
			this.connection.destroy(); // Clean up connection if disconnected
			this.connection = null;
		});

		this.connection.on('error', (error) => {
			console.error('Voice connection error:', error);
			this.connection.destroy();
			this.connection = null;

			// Emit error event
			this.emit(QueueCordEvents.Error, error);
		});
	}

	/**
	 * Determines whether the audio player is currently playing or not.
	 * @returns {boolean} `true` if the audio player's state is not idle, otherwise `false`.
	 */
	private isPlaying(): boolean {
		return this.state !== AudioPlayerStatus.Idle;
	}

	/**
	 * Determines whether playback should occur based on the current state of the queue and playback status.
	 * @returns {boolean} `true` if the queue is empty or playback is currently active; otherwise, `false`.
	 */
	private shouldPlay(): boolean {
		return !(this.queue.length < 1 || this.isPlaying()); // Use this.queue to apply getter logic
	}

	/**
	 * Determines if it is a song, playlist, or search query and adds the matching Songs to the queue.
	 * @param input The input string to be queued. (e.g., song URL, playlist URL, or search query)
	 */
	async addToQueue(input: string, vc: VoiceBasedChannel) {
		if (isValidURL(input)) {
			if (isPlaylist(input)) {
				const videos = await getPlaylistVideos(input); // Get all video metadata from the playlist
				this.queue.push(...videos); // Add all Songs to the queue
			} else {
				const song = await getSongMetadata(input); // Get metadata for the song URL
				this.queue.push(song); // Add the Song to the queue
			}
		} else {
			const song = await search(input); // Search and get metadata for the first result
			this.queue.push(song);
		}

		this.play(vc);
	}

	private async play(vc: VoiceBasedChannel) {
		if (!this.shouldPlay()) {
			return; // Do nothing if the queue is empty or already playing
		}

		// Pull the first track from the queue
		this.currentSong = this.queue.shift();
		if (!this.currentSong) return;

		// Use yt-dlp to extract audio stream
		const process = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', this.currentSong.webpage_url], { stdio: ['ignore', 'pipe', 'ignore'] });

		// Create audio resource from yt-dlp output
		const resource = createAudioResource(process.stdout as Readable);

		// Join the channel and play the audio resource
		await this.joinChannel(vc);
		this.player.play(resource);

		// Play the next track when the current one finishes
		this.player.once(AudioPlayerStatus.Idle, () => {
			this.play(vc);
		});
	}

	/**
	 * Retrieves the current queue.
	 * @returns An array of Songs to be played.
	 */
	public getQueue(): Song[] {
		return this.queue;
	}

	/**
	 * Sets the queue with a new array of Songs.
	 * @param value - An array of Songs to be played.
	 */
	public setQueue(value: Song[]) {
		this.queue = value;
	}

	/**
	 * Gets the current state of the audio player.
	 * @returns The current status of the audio player as an `AudioPlayerStatus`.
	 */
	public get getState(): AudioPlayerStatus {
		return this.state;
	}
	/**
	 * Sets the current state of the audio player.
	 * @param value - `AudioPlayerStatus`
	 */
	public setState(value: AudioPlayerStatus) {
		this.state = value;
	}
}

/**
 * Checks if the input is a playlist URL.
 * @param url - The input URL to check.
 * @returns True if the URL is a playlist, false otherwise.
 */
function isPlaylist(url: string): boolean {
	return url.includes('list=');
}

/**
 * Extracts metadata for a song or playlist item using yt-dlp.
 * @param input - The input string (URL or search query) to extract metadata for.
 * @returns A promise that resolves to a Song object.
 */
async function extractMetadata(input: string): Promise<Song> {
	const { stdout } = await execAsync(`yt-dlp --dump-json "${input}"`); // Using --dump-json gets ALL metadata
	const metadata = JSON.parse(stdout);

	return {
		id: metadata.id || '',
		title: metadata.title || '',
		thumbnail: metadata.thumbnail || '',
		description: metadata.description || '',
		channel_url: metadata.channel_url || '',
		duration: metadata.duration || 0,
		view_count: metadata.view_count || 0,
		age_limit: metadata.age_limit || 0,
		webpage_url: metadata.webpage_url || '',
		like_count: metadata.like_count || 0,
		channel: metadata.channel || '',
		uploader_url: metadata.uploader_url || '',
		upload_date: metadata.upload_date || '',
		timestamp: metadata.timestamp || 0,
		original_url: metadata.original_url || '',
		playlist_count: metadata.playlist_count || 0,
		playlist: metadata.playlist || '',
		playlist_id: metadata.playlist_id || '',
		playlist_title: metadata.playlist_title || '',
		playlist_uploader: metadata.playlist_uploader || '',
		playlist_uploader_id: metadata.playlist_uploader_id || '',
		playlist_channel: metadata.playlist_channel || '',
		playlist_channel_id: metadata.playlist_channel_id || '',
		playlist_webpage_url: metadata.playlist_webpage_url || '',
		fulltitle: metadata.fulltitle || '',
		duration_string: metadata.duration_string || '',
	};
}

/**
 * Extracts all video metadata from a playlist.
 * @param playlistUrl - The URL of the playlist.
 * @returns A promise that resolves to an array of Songs.
 */
async function getPlaylistVideos(playlistUrl: string): Promise<Song[]> {
	const { stdout } = await execAsync(`yt-dlp --flat-playlist --get-id "${playlistUrl}"`);
	const videoIds = stdout.split('\n').filter((id) => id);

	// Map each video ID to its metadata
	const songs = await Promise.all(videoIds.map((id) => extractMetadata(`https://www.youtube.com/watch?v=${id}`)));
	return songs;
}

/**
 * Retrieves metadata for a single song URL.
 * @param url - The song URL.
 * @returns A promise that resolves to a Song object.
 */
async function getSongMetadata(url: string): Promise<Song> {
	return extractMetadata(url);
}

/**
 * Searches for a YouTube video using the provided input string and returns the metadata of the first result.
 *
 * @param input - The search query to look up on YouTube.
 * @returns A promise that resolves to a Song object.
 */
async function search(input: string): Promise<Song> {
	return extractMetadata(`ytsearch:${input}`);
}
