/**
 * Global Type Definitions
 *
 * This file re-exports all types for easy importing throughout the project.
 * Usage: import { Torrent, File, TransmissionRequest } from '../types';
 */

// Transmission API types
export * from './transmission';

// Store types
export * from './stores';

// Message types
export * from './messages';

// Background script types
export * from './bg';

// Chrome extension message types
// Used for sending messages to background script
export interface ChromeMessage {
  action: string;
  [key: string]: unknown;
}

export interface ChromeResponse<T = unknown> {
  result?: T;
  error?: {
    message: string;
    code?: string;
    name?: string;
  };
}

// ID types used throughout the app
/**
 * Transmission's `ids` fields accept the session-scoped numeric id OR the
 * hashString. Destructive actions send hashes: numeric ids are reassigned on a
 * daemon restart, so an id captured in a confirmation dialog could otherwise
 * address a different torrent by the time the user clicks Yes.
 */
export type TorrentId = number | string;
