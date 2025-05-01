import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, AudioPlayer, VoiceConnectionStatus } from '@discordjs/voice';
import { VoiceConnection } from '@discordjs/voice';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { isValidURL } from '../utils/isValidURL';
import { ChatInputCommandInteraction, VoiceBasedChannel } from 'discord.js';
import { Loop, QueueCordEventMap, QueueCordEvents } from '../enums/Events';
import { Song } from '../interfaces/Song';
import moment from 'moment';
import { isPlaylist } from '../utils/isPlaylist';

const execAsync = promisify(exec);

/**
 * The `QueueCord` class is a music queue manager for Discord bots, extending `EventEmitter`.
 * It provides functionality for managing a music queue, playing audio in voice channels,
 * handling playlists, shuffling, skipping, pausing, and resuming playback, as well as
 * maintaining a history of played songs.
 *
 * ### Features:
 * - Joins and manages voice channel connections.
 * - Plays audio from YouTube using `yt-dlp`.
 * - Handles single songs and playlists.
 * - Supports queue management (add, shuffle, skip, stop).
 * - Maintains a history of played songs with a configurable limit.
 * - Emits events for state changes and errors.
 *
 * ### Events:
 * - `QueueCordEvents.Playing`: Emitted when a song starts playing.
 * - `QueueCordEvents.Paused`: Emitted when playback is paused.
 * - `QueueCordEvents.Unpaused`: Emitted when playback is resumed.
 * - `QueueCordEvents.Stopped`: Emitted when playback is stopped.
 * - `QueueCordEvents.Skipped`: Emitted when a song is skipped.
 * - `QueueCordEvents.Previous`: Emitted when the previous song is played.
 * - `QueueCordEvents.Shuffled`: Emitted when the queue is shuffled.
 * - `QueueCordEvents.SongAdded`: Emitted when a song is added to the queue.
 * - `QueueCordEvents.PlaylistAdded`: Emitted when a playlist is added to the queue.
 * - `QueueCordEvents.Idle`: Emitted when the queue is empty or playback is idle.
 * - `QueueCordEvents.Error`: Emitted when an error occurs.
 *
 * ### Usage:
 * ```typescript
 * const queueCord = new QueueCord();
 * await queueCord.addToQueue('song_url_or_query', interaction);
 * queueCord.play(voiceChannel);
 * ```
 *
 * @class QueueCord
 * @extends EventEmitter
 * @param {number} [historyLimit=10] - The maximum number of songs to keep in the history stack. (default: 10)
 */
export class QueueCord extends EventEmitter {
	private connection: VoiceConnection;
	private player: AudioPlayer = createAudioPlayer();
	private queue: Song[] = []; // Update queue to use Song interface
	private state: QueueCordEvents = QueueCordEvents.Idle; // Idle by default
	private currentSong: Song = null; // Current song being played
	private history: Song[] = []; // Stack to store previously played songs
	private historyLimit = 10; // Limit the size of the history stack
	private loopMode: Loop = Loop.Disabled; // Loop mode for the queue

	constructor(historyLimit?: number) {
		super();
		this.historyLimit = historyLimit; // Set the history limit
	}

	/**
	 * Overrides the emit method to restrict events to QueueCordEvents.
	 * @param event The event to emit.
	 * @param args The arguments to pass to the event listeners.
	 */
	emit<E extends keyof QueueCordEventMap>(event: E, ...args: Parameters<QueueCordEventMap[E]>): boolean {
		// TypeScript now knows the correct arguments per event 🔥
		return super.emit(event, ...args);
	}

	on<E extends keyof QueueCordEventMap>(event: E, listener: QueueCordEventMap[E]): this {
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
	 * Determines whether playback should occur based on the current state of the queue and playback status.
	 * @returns {boolean} `true` if the queue is empty or playback is currently active; otherwise, `false`.
	 */
	private shouldPlay(): boolean {
		return !(this.queue.length < 1 || this.state === QueueCordEvents.Playing); // Use this.queue to apply getter logic
	}

	/**
	 * Adds a song or playlist to the queue.
	 * @param input - The input string (URL or search query) to add to the queue.
	 * @param interaction - The interaction object for the command.
	 */
	async addToQueue(input: string, interaction: ChatInputCommandInteraction<'cached'>, shuffle = false) {
		if (isValidURL(input) && isPlaylist(input)) {
			await this.addPlaylist(input, interaction, shuffle);
		} else {
			await this.addSong(input, interaction);
		}

		this.play(interaction?.member?.voice?.channel);
	}

	/**
	 * Extracts all video metadata from a playlist.
	 * @param playlistUrl - The URL of the playlist.
	 * @returns A promise that resolves to an array of Songs.
	 */
	async addPlaylist(playlistUrl: string, interaction: ChatInputCommandInteraction<'cached'>, shuffle: boolean) {
		// Fetch playlist metadata
		const { stdout } = await execAsync(`yt-dlp --dump-single-json --flat-playlist --skip-download "${playlistUrl}"`);
		const playlistMetadata = JSON.parse(stdout);

		const videoIds = playlistMetadata.entries.map((entry: any) => entry.id); // Extract video IDs

		// Fetch metadata for each video in the playlist
		const songs = await Promise.all(
			videoIds.map((id) =>
				extractMetadata(`https://www.youtube.com/watch?v=${id}`, interaction).then((song) => ({
					...song,
					playlist: playlistMetadata.title || song.playlist,
					playlist_id: playlistMetadata.id || song.playlist_id,
					playlist_title: playlistMetadata.title || song.playlist_title,
					playlist_uploader: playlistMetadata.uploader || song.playlist_uploader,
					playlist_uploader_id: playlistMetadata.uploader_id || song.playlist_uploader_id,
					playlist_channel: playlistMetadata.channel || song.playlist_channel,
					playlist_channel_id: playlistMetadata.channel_id || song.playlist_channel_id,
					playlist_webpage_url: playlistMetadata.webpage_url || song.playlist_webpage_url,
				}))
			)
		);

		this.queue.push(...songs); // Add all Songs to the queue
		if (shuffle) this.shuffle(); // Shuffle the queue if specified
		this.emit(QueueCordEvents.PlaylistAdded, songs); // Emit event for playlist added
	}

	/**
	 * Fetches metadata for a song, either from a direct URL or a search query.
	 * @param input - The input string (URL or search query).
	 * @param interaction - The interaction object.
	 * @returns A promise that resolves to a Song object.
	 */
	async addSong(input: string, interaction: ChatInputCommandInteraction<'cached'>) {
		const query = isValidURL(input) ? input : `ytsearch:${input}`; // If not a valid URL, treat it as a search query
		const song = await extractMetadata(query, interaction);

		this.queue.push(song); // Add the Song to the queue
		this.emit(QueueCordEvents.SongAdded, song); // Emit event for song added
	}

	/**
	 * Plays the first track in the queue in the specified voice channel.
	 *
	 * This method checks if playback should start, retrieves the first track
	 * from the queue, and uses `yt-dlp` to extract the audio stream. It then
	 * creates an audio resource, joins the voice channel, and plays the track.
	 *
	 * The method also sets up elapsed time tracking for the current song and
	 * emits a `Playing` event when playback starts. Once the track finishes,
	 * it removes the current song from the queue and plays the next one if
	 * available. If the queue is empty, it emits an `Idle` event.
	 *
	 * @param vc - The voice channel where the audio will be played.
	 * @returns A promise that resolves when the playback process is initiated.
	 */
	private async play(vc: VoiceBasedChannel) {
		if (!this.shouldPlay()) {
			return; // Do nothing if the queue is empty or already playing
		}

		// Pull the first track from the queue
		this.currentSong = this.queue[0];
		if (!this.currentSong) return;

		// Use yt-dlp to extract audio stream
		const process = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', this.currentSong.webpage_url], { stdio: ['ignore', 'pipe', 'ignore'] });

		// Create audio resource from yt-dlp output
		const resource = createAudioResource(process.stdout as Readable);

		// Join the channel and play the audio resource
		await this.joinChannel(vc);
		this.player.play(resource);

		// Set the start time and elapsed time method on the current song
		this.currentSong.startTime = Date.now();
		this.currentSong.getElapsedTime = () => {
			if (!this.currentSong.startTime) return 0;
			const elapsedMilliseconds = Date.now() - this.currentSong.startTime;
			return Math.floor(elapsedMilliseconds / 1000); // Convert to seconds
		};
		this.currentSong.getElapsedTimeString = () => {
			const elapsedSeconds = this.currentSong.getElapsedTime?.() || 0;
			return moment.utc(elapsedSeconds * 1000).format('mm:ss'); // Format as mm:ss
		};

		this.emitState(QueueCordEvents.Playing, this.currentSong); // Emit event for song playing

		/*
		 * When the player is Idle, remove the current song and play the next one in the queue.
		 * If the queue is empty, emit an Idle event.
		 */
		this.player.once(AudioPlayerStatus.Idle, async () => {
			// Only remove the current song if it's not the previous song
			if (this.state !== QueueCordEvents.Previous) {
				// Add the finished song to history
				this.history.push(this.currentSong);

				// Remove the oldest song if history exceeds the limit
				if (this.history.length > this.historyLimit) {
					this.history.shift();
				}

				this.queue.shift();
			}

			this.emitState(QueueCordEvents.Idle);

			if (this.queue.length > 0) {
				await this.play(vc); // Play the next song
			} else {
				this.currentSong = null; // No more songs in the queue
			}
		});
	}

	/**
	 * Toggles the playback state of the audio player between paused and playing.
	 * @returns {Promise<QueueCordEvents>} The current state of the audio player after the toggle.
	 */
	async pause(): Promise<QueueCordEvents> {
		if (this.state === QueueCordEvents.Playing || this.state === QueueCordEvents.Unpaused) {
			// Pauses the player, and if it was paused succesfully, emits the Paused event.
			if (this.player.pause()) {
				this.emitState(QueueCordEvents.Paused);
			}
		} else if (this.state === QueueCordEvents.Paused) {
			// Unpauses the player, and if it was unpaused succesfully, emits the Unpaused event.
			if (this.player.unpause()) {
				this.emitState(QueueCordEvents.Unpaused);
			}
		}

		return this.state;
	}

	/**
	 * Shuffles the current queue of songs.
	 * - This method uses the Fisher-Yates algorithm to randomize the order of the songs in the queue.
	 */
	public shuffle(): void {
		let currSong;

		if (this.state === QueueCordEvents.Playing) {
			currSong = this.queue.shift(); // Remove the first song from the queue
		}

		for (let i = this.queue.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1)); // Random index from 0 to i
			[this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]; // Swap elements
		}

		if (currSong) this.queue.unshift(currSong); // Add the first song back to the front of the queue

		this.emit(QueueCordEvents.Shuffled, this.queue);
	}

	public skip(position?: number): QueueCordEvents {
		// Stop the current song if it's the only one in the queue
		if (this.queue.length === 1) {
			this.stop();
			return QueueCordEvents.Stopped;
		}

		if (position) {
			// Ensure the position is within bounds
			if (position < 1 || position >= this.queue.length) {
				throw new Error(`Invalid position: ${position}. Must be between 0 and ${this.queue.length - 1}.`);
			}

			this.queue = this.queue.slice(position - 1); // Remove songs up to the specified position
		}

		this.emit(QueueCordEvents.Skipped, this.currentSong);

		// Set the player to Idle so the next song plays
		this.player.emit(AudioPlayerStatus.Idle);
		return QueueCordEvents.Skipped;
	}

	public stop(): void {
		this.emit(QueueCordEvents.Stopped, this.currentSong);
		this.queue = [];
		this.currentSong = null;
		this.player.stop();
		this.emitState(QueueCordEvents.Idle);
	}

	/**
	 * Plays the previous song from the history stack.
	 * If no previous song exists, it does nothing.
	 */
	public async previous(): Promise<void> {
		const previousSong = this.history.pop(); // Get the last played song

		if (!previousSong) {
			throw new Error('No previous song available');
			return;
		}

		this.queue.unshift(previousSong); // Add the current song back to the queue

		this.emitState(QueueCordEvents.Previous, this.currentSong, previousSong);
		this.currentSong = previousSong; // Set the current song to the previous one

		// Set the player to Idle so the next song plays
		this.player.emit(AudioPlayerStatus.Idle);
	}

	/**
	 * Cycles through the loop modes
	 * - Disabled --> Song --> Queue
	 */
	public async loop() {
		this.loopMode++; // Increment the loop mode

		if (this.loopMode > 2) {
			this.loopMode = 0; // Reset to no loop
		}

		return this.loopMode; // Return the current loop mode
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
	public getState(): QueueCordEvents {
		return this.state;
	}
	/**
	 * Sets the current state of the audio player.
	 * @param value - `QueueCordEventsKeys`
	 */
	public setState(value: QueueCordEvents) {
		this.state = value;
	}

	/**
	 * Changes QueueCord's state and emits the corresponding event.
	 * @param state - The new state
	 * @param args - Additional arguments to pass to the event listeners
	 */
	public emitState(state: QueueCordEvents, ...args: any) {
		this.state = state; // Set the current state of the audio player
		this.emit(state, ...args); // Emit the state change event
	}
}

/**
 * Extracts metadata for a song or playlist item using yt-dlp.
 * @param input - The input string (URL or search query) to extract metadata for.
 * @returns A promise that resolves to a Song object.
 */
async function extractMetadata(input: string, interaction: ChatInputCommandInteraction<'cached'>): Promise<Song> {
	const { stdout } = await execAsync(`yt-dlp --dump-json --skip-download "${input}"`); // Using --dump-json gets ALL metadata
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
		interaction: interaction, // Pass the interaction object to the Song object
	};
}
