import { types, Instance } from 'mobx-state-tree';

const SpeedDataPoint = types.model({
  download: types.number,
  upload: types.number,
  time: types.identifierNumber,
});

const SpeedRollStore = types
  .model('SpeedRollStore', {
    data: types.array(SpeedDataPoint),
  })
  .actions((self) => {
    return {
      add(download: number, upload: number) {
        self.data.push({
          download,
          upload,
          time: Date.now(),
        });

        (self as unknown as { clean: () => void }).clean();
      },

      clean() {
        const oldestTime = Date.now() - 5 * 60 * 1000;
        while (self.data.length && self.data[0].time < oldestTime) {
          self.data.shift();
        }
      },

      setData(data: Instance<typeof SpeedDataPoint>[]) {
        self.data.replace(data);
      },
    };
  })
  .views((self) => {
    return {
      get minSpeed(): number {
        return 0;
      },
      get maxSpeed(): number {
        let maxSpeed = 0;
        const minTime = this.minTime;
        for (let i = self.data.length - 1; i >= 0; i--) {
          const item = self.data[i];
          if (item.time < minTime) {
            break;
          }
          const max = Math.max(item.download, item.upload);
          if (maxSpeed < max) {
            maxSpeed = max;
          }
        }
        return maxSpeed;
      },
      get minTime(): number {
        return this.maxTime - 60 * 1000;
      },
      get maxTime(): number {
        let result = 0;
        if (self.data.length) {
          result = self.data[self.data.length - 1].time;
        }
        return result;
      },
      getDataFromTime(minTime: number) {
        const result: { download: number; upload: number; time: number }[] = [];
        for (let i = self.data.length - 1; i >= 0; i--) {
          const item = self.data[i];
          if (item.time < minTime) {
            break;
          }
          result.unshift({ download: item.download, upload: item.upload, time: item.time });
        }
        return result;
      },
    };
  });

export type ISpeedRollStore = Instance<typeof SpeedRollStore>;
export default SpeedRollStore;
