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

// Narrowed interface for Daemon (only needs subset of Bg)
export interface IBgForDaemon {
  bgStore: {
    config: {
      backgroundUpdateInterval: number;
    };
  };
  client: {
    updateTorrents(): Promise<void>;
  } | null;
}

// Narrowed interface for ContextMenu
export interface IBgForContextMenu {
  bgStore: {
    config: {
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
    putTorrent(data: { blob?: Blob; url?: string }, directory?: string): Promise<void>;
    updateTorrents(): Promise<void>;
  } | null;
  whenReady(): Promise<void>;
  torrentErrorNotify(message: string): void;
}
