#!/usr/bin/env python3
"""Compose CUA-captured panel screenshots into README GIFs (requires Pillow)."""
import argparse
from pathlib import Path
from PIL import Image

GROUPS = {
    'overview-messages': ['overview-01', 'overview-02', 'overview-03', 'overview-04'],
    'context-evolution': ['evolution-01', 'evolution-02', 'evolution-03', 'evolution-04'],
    'compression-injection': ['events-01', 'events-02', 'events-03', 'events-04', 'events-05'],
    'tools-team': ['tools-01', 'tools-02', 'tools-03'],
    'session-comparison': ['compare-02', 'compare-03', 'compare-04'],
    'export-share': ['export-01', 'export-02', 'export-03'],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frames', type=Path)
    parser.add_argument('--output', type=Path, default=Path('docs/demo/panels'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, sources in GROUPS.items():
        frames = []
        for source in sources:
            with Image.open(args.frames / f'{source}.png') as im:
                rgb = im.convert('RGB')
                rgb.thumbnail((1280, 900), Image.Resampling.LANCZOS)
                canvas = Image.new('RGB', (1280, 720), '#f5f6fa')
                canvas.paste(rgb, (0, 0))
                frames.append(canvas.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
        target = args.output / f'{name}.gif'
        frames[0].save(target, save_all=True, append_images=frames[1:],
                       duration=[2200] * len(frames), loop=0, optimize=True, disposal=2)
        with Image.open(target) as check:
            assert check.n_frames == len(frames)
            assert check.size == (1280, 720)
        print(f'{target}: {len(frames)} frames, {target.stat().st_size / 1024:.0f} KiB')

if __name__ == '__main__':
    main()
