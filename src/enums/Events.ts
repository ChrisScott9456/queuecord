import { AudioPlayerStatus } from '@discordjs/voice';
import { Song } from '../interfaces/Song';

/**
 * Custom enums for QueueCord events.
 */
export enum CustomEvents {
	Error = 'Error',
	Test = 'Test',
}

/**
 * Combined enum of AudioPlayerStatus and CustomEvents.
 */
export const QueueCordEvents = {
	...AudioPlayerStatus,
	...CustomEvents,
} as const;

// The QueueCordEvents type is a union of all possible event names
export type QueueCordEvents = {
	[AudioPlayerStatus.Playing]: (song: Song) => void;
	[AudioPlayerStatus.Idle]: () => void;
	[AudioPlayerStatus.Paused]: () => void;
	[AudioPlayerStatus.AutoPaused]: () => void;
	[AudioPlayerStatus.Buffering]: () => void;
	[CustomEvents.Error]: (error: Error) => void;
	[CustomEvents.Test]: (...args: any[]) => void;
};
