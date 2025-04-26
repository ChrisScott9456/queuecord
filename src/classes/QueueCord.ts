import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, AudioPlayer, VoiceConnectionStatus } from '@discordjs/voice';
import { VoiceConnection } from '@discordjs/voice';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { isValidURL } from '../utils/isValidURL';
import { VoiceBasedChannel } from 'discord.js';

const execAsync = promisify(exec);

export class QueueCord {
	private connection: VoiceConnection;
	private player: AudioPlayer = createAudioPlayer();
	private _queue: string[] = [];
	private _state: AudioPlayerStatus = AudioPlayerStatus.Idle;

	constructor() {
		this.player.on('stateChange', (oldState, newState) => {
			this.state = newState.status; // Update the state when it changes
		});
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
		return !(this.queue.length < 1 || this.isPlaying());
	}

	/**
	 * Determines if it is a song, playlist, or search query and adds the matching URLs to the queue.
	 * @param input The input string to be queued. (e.g., song URL, playlist URL, or search query)
	 */
	async queueUp(input: string, vc: VoiceBasedChannel) {
		if (isValidURL(input)) {
			if (isPlaylist(input)) {
				const videos = await getPlaylistVideos(input); // Get all video URLs from the playlist
				this.queue.push(...videos); // Add all video URLs to the queue
			} else {
				this.queue.push(input); // Add the song URL to the queue
			}
		} else {
			this.queue.push(await search(input));
		}

		console.log(this.queue);

		this.play(vc);
	}

	private async play(vc: VoiceBasedChannel) {
		if (!this.shouldPlay()) {
			return; // Do nothing if the queue is empty or already playing
		}

		const currentTrack = this.queue.shift(); // Get the next track from the queue
		if (!currentTrack) return;

		// Use yt-dlp to extract audio stream
		const process = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', currentTrack], { stdio: ['ignore', 'pipe', 'ignore'] });

		const resource = createAudioResource(process.stdout as Readable); // Create audio resource from yt-dlp output

		await this.joinChannel(vc);
		this.player.play(resource); // Play the audio resource

		this.player.once(AudioPlayerStatus.Idle, () => {
			this.play(vc); // Play the next track when the current one finishes
		});
	}

	public get queue(): string[] {
		return this._queue;
	}

	public set queue(value: string[]) {
		this._queue = value;
	}

	/**
	 * Gets the current state of the audio player.
	 * @returns The current status of the audio player as an `AudioPlayerStatus`.
	 */
	public get state(): AudioPlayerStatus {
		return this._state;
	}
	/**
	 * Sets the current state of the audio player.
	 * @param value - `AudioPlayerStatus`
	 */
	public set state(value: AudioPlayerStatus) {
		this._state = value;
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
 * Extracts all video URLs from a playlist.
 * @param playlistUrl - The URL of the playlist.
 * @returns A promise that resolves to an array of video URLs.
 */
async function getPlaylistVideos(playlistUrl: string): Promise<string[]> {
	const { stdout } = await execAsync(`yt-dlp --flat-playlist --get-id "${playlistUrl}"`);
	return stdout
		.split('\n')
		.filter((id) => id)
		.map((id) => `https://www.youtube.com/watch?v=${id}`);
}

/**
 * Searches for a YouTube video using the provided input string and returns the URL of the first result.
 *
 * @param input - The search query to look up on YouTube.
 * @returns A promise that resolves to the URL of the first YouTube video matching the search query.
 */
async function search(input: string): Promise<string> {
	const { stdout } = await execAsync(`yt-dlp --get-id "ytsearch:${input}"`);
	return `https://www.youtube.com/watch?v=${stdout.trim()}`;
}
