import { Song } from '../interfaces/Song';

/**
 * Custom enums for QueueCord events.
 */
export enum QueueCordEvents {
	Error = 'Error',
	Idle = 'Idle',
	Paused = 'Paused',
	Playing = 'Playing',
	PlaylistAdded = 'PlaylistAdded',
	Shuffled = 'Shuffled',
	Skipped = 'Skipped',
	SongAdded = 'SongAdded',
	Stopped = 'Stopped',
	Unpaused = 'Unpaused',
}

/**
 * Used for EventEmitter to restrict events to QueueCordEvents.
 */
export type QueueCordEventMap = {
	[QueueCordEvents.Error]: (error: Error) => void;
	[QueueCordEvents.Idle]: () => void;
	[QueueCordEvents.Paused]: (song: Song) => void;
	[QueueCordEvents.Playing]: (song: Song) => void;
	[QueueCordEvents.PlaylistAdded]: (playlist: Song[]) => void;
	[QueueCordEvents.Shuffled]: (queue: Song[]) => void;
	[QueueCordEvents.Skipped]: (song: Song) => void;
	[QueueCordEvents.SongAdded]: (song: Song) => void;
	[QueueCordEvents.Stopped]: (song: Song) => void;
	[QueueCordEvents.Unpaused]: (song: Song) => void;
};
