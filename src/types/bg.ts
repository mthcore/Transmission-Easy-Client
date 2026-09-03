/**
 * Background Script Interface Types
 *
 * Shared interface for the Bg class used by Daemon, ContextMenu, and TransmissionClient.
 */

import type { Instance } from 'mobx-state-tree';
import type BgStore from '../stores/BgStore';
import type TransmissionClient from '../bg/TransmissionClient';

// Type for the BgStore instance
export type IBgStore = Instance<typeof BgStore>;

// Interface for folder configuration
export interface Folder {
  name?: string;
  path: string;
}

// Interface for the Bg class as seen by dependent classes
export interface IBg {
  bgStore: IBgStore;
  client: TransmissionClient | null;
  whenReady(): Promise<void>;
  torrentAddedNotify(torrent: { id: number; name: string }): void;
  torrentIsExistsNotify(torrent: { id: number; name: string }): void;
  torrentExistsNotify(): void;
  torrentCompleteNotify(torrent: { id: number; name: string; stateText?: string }): void;
  torrentErrorNotify(message: string): void;
}

/**
 * What Daemon needs from Bg.
 *
 * Narrow on purpose, and asking for `requireConfig()` rather than `config`.
 * The store's `config` is `maybe`; stating it here as a plain field made this
 * interface disagree with the real store, and the disagreement was settled
 * with a cast at the construction site — which also stopped the compiler
 * checking every other field named below.
 *
 * A narrow list only stays honest while something compares it against the
 * store. That something is `new Daemon(this)` in Bg.init, uncast: rename a
 * field here or there and it no longer compiles.
 */
export interface IBgForDaemon {
  bgStore: {
    requireConfig(): {
      backgroundUpdateInterval: number;
    };
  };
  client: {
    updateTorrents(): Promise<unknown>;
  } | null;
}

/** What ContextMenu needs from Bg. See IBgForDaemon on the shape of it. */
export interface IBgForContextMenu {
  bgStore: {
    requireConfig(): {
      folders: Folder[];
      treeViewContextMenu: boolean;
      putDefaultPathInContextMenu: boolean;
      selectDownloadCategoryAfterPutTorrentFromContextMenu: boolean;
      hasFolder(path: string): boolean;
      addFolder(path: string): void;
      setSelectedLabel(label: string, custom: boolean): void;
    };
  };
  client: {
    putTorrent(data: { blob?: Blob; url?: string }, directory?: string): Promise<unknown>;
    updateTorrents(): Promise<unknown>;
  } | null;
  whenReady(): Promise<void>;
  torrentErrorNotify(message: string): void;
}
