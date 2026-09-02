import ErrorWithCode from '../tools/ErrorWithCode';
import type { TorrentId } from '../types';
import splitByPart from '../tools/splitByPart';
import { parseTransmissionResponse } from '../tools/safeJsonParse';
import { FILE_PRIORITY_CHUNK_SIZE } from '../constants';
import type TransmissionTransport from './TransmissionTransport';

export interface NormalizedFile {
  name: string;
  shortName: string;
  size: number;
  downloaded: number;
  /**
   * Transmission's own scale shifted to 1..3 (low/normal/high). It no longer
   * doubles as "not wanted": the daemon keeps the two independent, and
   * collapsing them meant excluding a file silently discarded its priority and
   * re-including it silently returned it to normal.
   */
  priority: number;
  /** Whether the daemon will download this file at all */
  wanted: boolean;
}

class FileService {
  private transport: TransmissionTransport;

  constructor(transport: TransmissionTransport) {
    this.transport = transport;
  }

  getFileList(id: TorrentId): Promise<NormalizedFile[]> {
    return this.transport
      .sendAction(
        {
          method: 'torrent-get',
          arguments: {
            fields: ['id', 'files', 'fileStats'],
            ids: [id],
          },
        },
        // File names are arbitrary bytes — repair-parse like the torrent list
        parseTransmissionResponse
      )
      .then((response) => {
        let files: NormalizedFile[] | null = null;
        type TorrentFiles = {
          id: number;
          files: Array<{ name: string; length: number; bytesCompleted: number }>;
          fileStats: Array<{ wanted: boolean; priority: number }>;
        };
        const torrents = (response.arguments as { torrents: TorrentFiles[] }).torrents;
        torrents.some((torrent) => {
          if (torrent.id === id) {
            files = this.normalizeFiles(torrent);
            return true;
          }
          return false;
        });

        if (!files) {
          throw new ErrorWithCode("Files don't received");
        }
        return files;
      });
  }

  /**
   * Priority only. Setting a priority no longer marks the files wanted: the two
   * are independent on the daemon, and a file excluded from the download keeps
   * the priority it will have if it is included again.
   *
   * Chunked because a torrent can hold tens of thousands of files and the whole
   * index list would otherwise go in one request.
   */
  setPriority(id: TorrentId, level: number, idxs: number[]): Promise<unknown[]> {
    const key = level === 1 ? 'priority-low' : level === 3 ? 'priority-high' : 'priority-normal';
    return Promise.all(
      splitByPart(idxs, FILE_PRIORITY_CHUNK_SIZE).map((partIdxs) =>
        this.transport.sendAction({
          method: 'torrent-set',
          arguments: { ids: [id], [key]: partIdxs },
        })
      )
    );
  }

  /** Whether the daemon downloads these files, independent of their priority. */
  setWanted(id: TorrentId, wanted: boolean, idxs: number[]): Promise<unknown[]> {
    const key = wanted ? 'files-wanted' : 'files-unwanted';
    return Promise.all(
      splitByPart(idxs, FILE_PRIORITY_CHUNK_SIZE).map((partIdxs) =>
        this.transport.sendAction({
          method: 'torrent-set',
          arguments: { ids: [id], [key]: partIdxs },
        })
      )
    );
  }

  private normalizeFiles = (torrent: {
    files: Array<{ name: string; length: number; bytesCompleted: number }>;
    fileStats: Array<{ wanted: boolean; priority: number }>;
  }): NormalizedFile[] => {
    return torrent.files.map((file, index) => {
      const state = torrent.fileStats[index];

      const name = file.name;
      const shortName = name;
      const size = file.length;
      const downloaded = file.bytesCompleted;
      const priority = state.priority + 2;
      const wanted = state.wanted;

      return { name, shortName, size, downloaded, priority, wanted };
    });
  };
}

export default FileService;
