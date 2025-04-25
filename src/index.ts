import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import { VoiceConnection } from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { Readable } from 'stream';
import { isValidURL } from './utils/isValidURL';

/**
 * Joins a voice channel and plays a song from a YouTube URL.
 * @param channelId The ID of the voice channel to join.
 * @param guildId The ID of the guild (server) containing the voice channel.
 * @param adapterCreator The adapter creator for the guild.
 * @param input The YouTube URL or search query.
 */
export async function playSong(channelId: string, guildId: string, adapterCreator: any, input: string): Promise<void> {
	// Join the voice channel
	const connection: VoiceConnection = joinVoiceChannel({
		channelId,
		guildId,
		adapterCreator,
	});

	const url = isValidURL(input) ? input : await search(input);

	// Use yt-dlp to stream audio
	const ytDlpProcess = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'ignore'] });

	if (!ytDlpProcess.stdout) {
		throw new Error('Failed to start yt-dlp process');
	}

	const audioStream: Readable = ytDlpProcess.stdout;

	// Create an audio resource and player
	const resource = createAudioResource(audioStream);
	const player = createAudioPlayer();

	// Play the audio
	connection.subscribe(player);
	player.play(resource);

	// Handle player events
	player.on(AudioPlayerStatus.Idle, () => {
		console.log('Playback finished.');
		connection.destroy();
		ytDlpProcess.kill();
	});

	player.on('error', (error) => {
		console.error('Error during playback:', error);
		connection.destroy();
		ytDlpProcess.kill();
	});
}

/**
 * Searches for a YouTube video using the provided input string and returns the URL of the first result.
 *
 * @param input - The search query to look up on YouTube.
 * @returns A promise that resolves to the URL of the first YouTube video matching the search query.
 */
async function search(input: string) {
	const id = execSync(`yt-dlp --get-id "ytsearch:${input}"`, { encoding: 'utf-8' });
	return `https://www.youtube.com/watch?v=${id}`;
}
