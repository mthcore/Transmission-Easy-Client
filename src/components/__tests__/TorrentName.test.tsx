import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import TorrentName from '../TorrentName';

/**
 * Torrent names come from whoever made the torrent, so this component is the
 * boundary where hostile text meets the page.
 *
 * A right-to-left override (U+202E) placed inside a name reverses everything
 * after it when rendered: "photo‮gnp.exe" reads as "photo.exe" backwards —
 * on screen it looks like photo.png, and the user clicks a .exe. Stripping
 * those controls is the whole defence, and it applies to the tooltip too,
 * which is the copy people read when the row is too narrow.
 *
 * The rest is the marquee: names wider than their column scroll on hover,
 * driven by a <style> element shared between every row using the same width
 * bucket. It is reference-counted, and the accounting is the fragile part —
 * releasing twice deletes a stylesheet other rows are still animating with.
 */

afterEach(cleanup);

const OVERRIDE = '‮';
const styleCount = () => document.querySelectorAll('style[class^="mv_"]').length;

beforeEach(() => {
  document.querySelectorAll('style[class^="mv_"]').forEach((el) => el.remove());
});

/**
 * Render with a span wide enough (or not) to need the marquee. The span is
 * looked up inside THIS render's container: a document-wide query returns the
 * first row on the page, so a second render would silently drive the first.
 */
function draw(props: { name: string; width: number; title?: string }, spanWidth = 500) {
  const result = render(<TorrentName {...props} />);
  const span = result.container.querySelector('span') as HTMLSpanElement;
  Object.defineProperty(span, 'offsetWidth', { value: spanWidth, configurable: true });
  return { ...result, span };
}

describe('TorrentName — hostile names', () => {
  it('strips a right-to-left override from the name', () => {
    // Left in, the extension the user sees is not the extension they get.
    const { span } = draw({ name: `photo${OVERRIDE}gnp.exe`, width: 100 });

    expect(span.textContent).not.toContain(OVERRIDE);
    expect(span.textContent).toBe('photognp.exe');
  });

  it('strips them from the tooltip as well', () => {
    // The tooltip is what people read when the column is too narrow, so
    // cleaning only the visible text would move the problem rather than fix it.
    const { span } = draw({
      name: 'short',
      width: 100,
      title: `photo${OVERRIDE}gnp.exe`,
    });

    expect(span.getAttribute('title')).not.toContain(OVERRIDE);
  });

  it('falls back to the cleaned name when there is no tooltip of its own', () => {
    const { span } = draw({ name: `photo${OVERRIDE}gnp.exe`, width: 100 });

    expect(span.getAttribute('title')).toBe('photognp.exe');
  });

  it('leaves an ordinary name untouched', () => {
    const { span } = draw({ name: 'Ubuntu 24.04 — édition FR.iso', width: 100 });

    expect(span.textContent).toBe('Ubuntu 24.04 — édition FR.iso');
  });
});

describe('TorrentName — the marquee stylesheet', () => {
  it('creates one on hover for a name wider than its column', () => {
    const { span } = draw({ name: 'a very long name', width: 100 }, 500);
    fireEvent.mouseEnter(span);

    expect(styleCount()).toBe(1);
  });

  it('creates none for a name that already fits', () => {
    // Nothing to scroll, so nothing to install in the document.
    const { span } = draw({ name: 'short', width: 500 }, 100);
    fireEvent.mouseEnter(span);

    expect(styleCount()).toBe(0);
  });

  it('shares one stylesheet between rows in the same width bucket', () => {
    // Widths are rounded into buckets precisely so a thousand rows do not
    // install a thousand stylesheets.
    const a = draw({ name: 'first long name', width: 100 }, 500);
    const b = draw({ name: 'second long name', width: 100 }, 500);
    fireEvent.mouseEnter(a.span);
    fireEvent.mouseEnter(b.span);

    expect(styleCount()).toBe(1);
  });

  it('keeps it while another row is still using it', () => {
    // Releasing on the first unmount would delete a stylesheet the other row
    // is still animating with.
    const a = draw({ name: 'first long name', width: 100 }, 500);
    const b = draw({ name: 'second long name', width: 100 }, 500);
    fireEvent.mouseEnter(a.span);
    fireEvent.mouseEnter(b.span);
    a.unmount();

    expect(styleCount()).toBe(1);
  });

  it('removes it once the last row using it has gone', () => {
    const a = draw({ name: 'first long name', width: 100 }, 500);
    const b = draw({ name: 'second long name', width: 100 }, 500);
    fireEvent.mouseEnter(a.span);
    fireEvent.mouseEnter(b.span);
    a.unmount();
    b.unmount();

    expect(styleCount()).toBe(0);
  });

  it('acquires the same bucket once across a name change', () => {
    // A renamed torrent re-arms the measurement, so the row is hovered and
    // measured again and lands in the same bucket. Acquiring twice would leave
    // the stylesheet behind for ever, since only one release ever runs.
    //
    // Re-hovering alone cannot show this: the handler is detached after the
    // first measurement and only a name or width change puts it back.
    const { span, rerender, container, unmount } = draw(
      { name: 'a very long name', width: 100 },
      500
    );
    fireEvent.mouseEnter(span);

    rerender(<TorrentName name="a different long name" width={100} />);
    const again = container.querySelector('span') as HTMLSpanElement;
    Object.defineProperty(again, 'offsetWidth', { value: 500, configurable: true });
    fireEvent.mouseEnter(again);

    unmount();
    expect(styleCount()).toBe(0);
  });

  it('leaves nothing behind when the row is unmounted', () => {
    const { span, unmount } = draw({ name: 'a very long name', width: 100 }, 500);
    fireEvent.mouseEnter(span);
    unmount();

    expect(styleCount()).toBe(0);
  });

  it('applies the animation class to the row', () => {
    const { span, container } = draw({ name: 'a very long name', width: 100 }, 500);
    fireEvent.mouseEnter(span);

    expect((container.firstChild as HTMLElement).className).toMatch(/\bmv_\d+_\d+\b/);
  });
});
