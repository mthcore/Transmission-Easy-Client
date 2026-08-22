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
  priority: number;
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

  setPriority(id: TorrentId, level: number, idxs: number[]): Promise<unknown[]> {
    return Promise.all(
      splitByPart(idxs, FILE_PRIORITY_CHUNK_SIZE).map((partIdxs) => {
        const args: Record<string, unknown> = {
          ids: [id],
        };

        if (level === 0) {
          args['files-unwanted'] = partIdxs;
        } else {
          args['files-wanted'] = partIdxs;
          switch (level) {
            case 1: {
              args['priority-low'] = partIdxs;
              break;
            }
            case 2: {
              args['priority-normal'] = partIdxs;
              break;
            }
            case 3: {
              args['priority-high'] = partIdxs;
              break;
            }
          }
        }

        return this.transport.sendAction({
          method: 'torrent-set',
          arguments: args,
        });
      })
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
      const priority = !state.wanted ? 0 : state.priority + 2;

      return { name, shortName, size, downloaded, priority };
    });
  };
}

export default FileService;
