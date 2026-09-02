import { useRef, useEffect, RefObject } from 'react';
import { autorun, IReactionDisposer } from 'mobx';

interface SpeedDataPoint {
  time: number;
  upload: number;
  download: number;
}

interface SpeedRoll {
  minTime: number;
  maxTime: number;
  minSpeed: number;
  maxSpeed: number;
  getDataFromTime(minTime: number): SpeedDataPoint[];
}

interface Scale {
  (value: number): number;
  domain(d: [number, number]): Scale;
  range(r: [number, number]): Scale;
}

function createScale(): Scale {
  let domain: [number, number] = [0, 1];
  let range: [number, number] = [0, 1];

  const scale = (value: number): number => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    if (d1 === d0) return r0;
    return r0 + ((value - d0) * (r1 - r0)) / (d1 - d0);
  };

  scale.domain = (d: [number, number]): Scale => {
    domain = d;
    return scale;
  };
  scale.range = (r: [number, number]): Scale => {
    range = r;
    return scale;
  };

  return scale;
}

function generatePath(
  data: SpeedDataPoint[],
  xScale: Scale,
  yScale: Scale,
  valueKey: 'upload' | 'download'
): string {
  if (!data || data.length === 0) return '';
  if (data.length === 1) {
    const x = xScale(data[0].time);
    const y = yScale(data[0][valueKey]);
    return `M${x},${y}`;
  }

  let path = `M${xScale(data[0].time)},${yScale(data[0][valueKey])}`;

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    const x0 = xScale(prev.time);
    const y0 = yScale(prev[valueKey]);
    const x1 = xScale(curr.time);
    const y1 = yScale(curr[valueKey]);

    const cpX = (x0 + x1) / 2;
    path += ` Q${cpX},${y0} ${x1},${y1}`;
  }

  return path;
}

export function useGraph(
  chartRef: RefObject<HTMLElement | null>,
  speedRoll: SpeedRoll | null | undefined
): void {
  const graphAutorunRef = useRef<IReactionDisposer | null>(null);
  const svgElRef = useRef<SVGSVGElement | null>(null);
  const uploadPathRef = useRef<SVGPathElement | null>(null);
  const downloadPathRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (!chartRef.current || !speedRoll) return;

    const ctr = chartRef.current;

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElRef.current = svgEl;

    const uploadPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    uploadPath.setAttribute('fill', 'none');
    uploadPath.setAttribute('stroke', '#41B541');
    uploadPath.setAttribute('stroke-width', '1.5');
    uploadPath.setAttribute('stroke-linejoin', 'round');
    uploadPath.setAttribute('stroke-linecap', 'round');
    uploadPath.style.transition = 'd 0.5s ease-out';
    uploadPathRef.current = uploadPath;

    const downloadPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    downloadPath.setAttribute('fill', 'none');
    downloadPath.setAttribute('stroke', '#6b7280');
    downloadPath.setAttribute('stroke-width', '1.5');
    downloadPath.setAttribute('stroke-linejoin', 'round');
    downloadPath.setAttribute('stroke-linecap', 'round');
    downloadPath.style.transition = 'd 0.5s ease-out';
    downloadPathRef.current = downloadPath;

    svgEl.appendChild(uploadPath);
    svgEl.appendChild(downloadPath);

    const xScale = createScale();
    const yScale = createScale();

    let width: number | null = null;
    const height = 30;

    const drawGraph = () => {
      if (!chartRef.current) return;

      const newWidth = ctr.clientWidth;
      if (newWidth > 0 && newWidth !== width) {
        width = newWidth;
        svgEl.setAttribute('width', String(width));
        svgEl.setAttribute('height', String(height));
        svgEl.setAttribute('viewBox', `0,0,${width},${height}`);
        yScale.range([height, 0]);
        xScale.range([0, width]);
      }

      if (width === null || width === 0) return;

      yScale.domain([speedRoll.minSpeed, speedRoll.maxSpeed || 1]);
      xScale.domain([speedRoll.minTime, speedRoll.maxTime]);

      // Never fetch points older than the x-domain start: they map to
      // negative coordinates and drew a spurious lead-in segment entering the
      // plot from outside after a speed spike aged out of the window.
      // speedRoll.minTime only ever advances, so it IS that start — the local
      // "furthest back we've seen" copy this used to Math.max against could
      // never win, and its staleness check was unreachable.
      const data = speedRoll.getDataFromTime(speedRoll.minTime);

      const uploadD = generatePath(data, xScale, yScale, 'upload');
      const downloadD = generatePath(data, xScale, yScale, 'download');

      uploadPathRef.current?.setAttribute('d', uploadD);
      downloadPathRef.current?.setAttribute('d', downloadD);
    };

    graphAutorunRef.current = autorun(drawGraph);

    ctr.appendChild(svgEl);

    // clientWidth is not observable, so the autorun only re-ran when the speed
    // data changed: the graph kept a stale width after a resize (indefinitely
    // when polling was paused or the daemon was unreachable)
    let resizeObserver: ResizeObserver | null = null;
    // Just redraw. Disposing the autorun and creating a new one ran on every
    // frame of a resize drag — and ResizeObserver fires once immediately on
    // observe(), so it tore down the autorun created two lines earlier.
    const redraw = () => {
      width = null;
      drawGraph();
    };
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(redraw);
      resizeObserver.observe(ctr);
    } else {
      window.addEventListener('resize', redraw);
    }

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', redraw);
      if (graphAutorunRef.current) {
        graphAutorunRef.current();
        graphAutorunRef.current = null;
      }
      if (svgElRef.current && svgElRef.current.parentNode) {
        svgElRef.current.parentNode.removeChild(svgElRef.current);
      }
    };
  }, [chartRef, speedRoll]);
}
