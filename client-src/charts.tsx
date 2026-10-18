/**
 * Shared SVG chart primitives for the dashboard.
 *
 * Zero dependencies by design: the client bundle must stay loadable with only
 * the host's React seed. All charts render inline SVG with currentColor-based
 * theming so they follow the app's light/dark theme.
 */
import { Fragment, h, useEffect, useRef, useState } from './react-binding.js';
import { formatTokens, utilizationColor } from './format.js';

/* ------------------------------------------------------------------ */
/* Ring gauge (PRD §3.1 occupancy, status-bar badge)                    */
/* ------------------------------------------------------------------ */

export function RingGauge(props: {
  ratio: number | null;
  size?: number;
  label?: string;
  sublabel?: string;
  pulse?: boolean;
  onClick?: () => void;
  title?: string;
}): unknown {
  const size = props.size ?? 120;
  const raw = props.ratio !== null && props.ratio !== undefined && Number.isFinite(props.ratio)
    ? Math.max(0, props.ratio)
    : null;
  const ratio = raw === null ? null : Math.min(1, raw);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const color = ratio === null ? 'currentColor' : utilizationColor(ratio);
  const percent = raw === null ? '—' : `${(raw * 100).toFixed(1)}%`;
  return h('button', {
    type: 'button',
    onClick: props.onClick,
    title: props.title,
    className: props.pulse && ratio !== null && ratio > 0.8 ? 'dsh-eval-pulse' : undefined,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '10px',
      background: 'transparent', border: 'none', padding: 0, cursor: props.onClick ? 'pointer' : 'default',
      font: 'inherit', color: 'inherit', textAlign: 'left',
    },
  },
    h('svg', {
      viewBox: '0 0 100 100',
      width: size, height: size,
      'aria-hidden': true,
      style: { flex: 'none' },
    }, [
      h('circle', { key: 'track', cx: '50', cy: '50', r: String(radius), fill: 'none', stroke: 'color-mix(in srgb, currentColor 15%, transparent)', strokeWidth: '9' }),
      ratio !== null ? h('circle', {
        key: 'fill', cx: '50', cy: '50', r: String(radius), fill: 'none',
        stroke: color, strokeWidth: '9',
        strokeDasharray: `${(ratio * circumference).toFixed(1)} ${circumference.toFixed(1)}`,
        strokeLinecap: 'round', transform: 'rotate(-90 50 50)',
        style: { transition: 'stroke-dasharray 0.3s ease, stroke 0.3s ease' },
      }) : null,
      h('text', {
        key: 'text', x: '50', y: '50', textAnchor: 'middle', dominantBaseline: 'middle',
        fontSize: raw !== null && raw >= 1 ? '13' : '16', fontWeight: '600', fill: color,
      }, percent),
    ]),
    props.label !== undefined || props.sublabel !== undefined
      ? h('span', { key: 'info', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
        props.label !== undefined ? h('span', { key: 'l', style: { fontSize: '12px', fontWeight: 500 } }, props.label) : null,
        props.sublabel !== undefined ? h('span', { key: 's', style: { fontSize: '11px', opacity: 0.65 } }, props.sublabel) : null,
      ])
      : null,
  );
}

/* ------------------------------------------------------------------ */
/* Stacked bar (PRD §3.1 composition strip)                            */
/* ------------------------------------------------------------------ */

export interface Segment {
  key: string;
  label: string;
  tokens: number;
  color: string;
}

export function StackedBar(props: {
  segments: Segment[];
  total: number;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  compact?: boolean;
}): unknown {
  const [hover, setHover] = useState<string | null>(null);
  const total = props.total > 0 ? props.total : props.segments.reduce((sum, s) => sum + s.tokens, 0);
  const visible = props.segments.filter((s) => s.tokens > 0);
  if (visible.length === 0) {
    return h('div', { style: { fontSize: '12px', opacity: 0.55, padding: '6px 0' } }, '暂无组成数据');
  }
  return h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '4px' },
  }, [
    h('div', {
      key: 'bar',
      role: 'img',
      'aria-label': visible.map((s) => `${s.label} ${formatTokens(s.tokens)} (${total > 0 ? Math.round((s.tokens / total) * 100) : 0}%)`).join(', '),
      style: {
        display: 'flex', height: props.compact ? '10px' : '16px', borderRadius: '6px',
        overflow: 'hidden', border: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
      },
    }, visible.map((segment) => h('div', {
      key: segment.key,
      title: `${segment.label}：${formatTokens(segment.tokens)} Token · ${total > 0 ? ((segment.tokens / total) * 100).toFixed(1) : '0.0'}%`,
      onMouseEnter: () => setHover(segment.key),
      onMouseLeave: () => setHover(null),
      onClick: () => props.onSelect?.(props.selected === segment.key ? null : segment.key),
      style: {
        width: total > 0 ? `${(segment.tokens / total) * 100}%` : '0%',
        background: segment.color,
        opacity: props.selected !== undefined && props.selected !== null && props.selected !== segment.key ? 0.35 : hover === segment.key ? 1 : 0.85,
        cursor: props.onSelect ? 'pointer' : 'default',
        transition: 'opacity 0.15s ease',
        boxSizing: 'border-box',
      },
    }))),
    props.compact ? null : h('div', {
      key: 'legend',
      style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '11px' },
    }, visible.map((segment) => h('span', {
      key: segment.key,
      onMouseEnter: () => setHover(segment.key),
      onMouseLeave: () => setHover(null),
      onClick: () => props.onSelect?.(props.selected === segment.key ? null : segment.key),
      style: {
        display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: props.onSelect ? 'pointer' : 'default',
        opacity: props.selected !== undefined && props.selected !== null && props.selected !== segment.key ? 0.45 : 1,
      },
    }, [
      h('span', { key: 'dot', style: { width: '8px', height: '8px', borderRadius: '2px', background: segment.color, flex: 'none' } }),
      h('span', { key: 'label' }, segment.label),
      h('span', { key: 'value', style: { opacity: 0.65 } }, `${formatTokens(segment.tokens)} · ${total > 0 ? ((segment.tokens / total) * 100).toFixed(1) : '0.0'}%`),
    ]))),
  ]);
}

/* ------------------------------------------------------------------ */
/* Pie chart (PRD §3.2 composition)                                    */
/* ------------------------------------------------------------------ */

export function PieChart(props: {
  segments: Segment[];
  total: number;
  size?: number;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}): unknown {
  const size = props.size ?? 150;
  const total = props.total > 0 ? props.total : props.segments.reduce((sum, s) => sum + s.tokens, 0);
  const visible = props.segments.filter((s) => s.tokens > 0);
  if (visible.length === 0 || total <= 0) {
    return h('div', { style: { display: 'grid', placeItems: 'center', width: size, height: size, opacity: 0.55, fontSize: '12px' } }, '暂无数据');
  }
  const cx = 50, cy = 50, r = 38;
  let angle = -Math.PI / 2;
  const slices = visible.map((segment) => {
    const share = segment.tokens / total;
    const startAngle = angle;
    const endAngle = angle + share * Math.PI * 2;
    angle = endAngle;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const midAngle = (startAngle + endAngle) / 2;
    const labelRadius = r * 0.62;
    const labelX = cx + labelRadius * Math.cos(midAngle);
    const labelY = cy + labelRadius * Math.sin(midAngle);
    return {
      segment,
      share,
      path: `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      labelX, labelY,
    };
  });
  return h('svg', {
    viewBox: '0 0 100 100', width: size, height: size, role: 'img',
    'aria-label': visible.map((s) => `${s.label} ${((s.tokens / total) * 100).toFixed(0)}%`).join(', '),
  }, slices.map((slice) => h('path', {
    key: slice.segment.key,
    d: slice.path,
    fill: slice.segment.color,
    opacity: props.selected !== undefined && props.selected !== null && props.selected !== slice.segment.key ? 0.35 : 0.9,
    stroke: 'var(--dsh-eval-surface, Canvas)', strokeWidth: '1',
    style: { cursor: props.onSelect ? 'pointer' : 'default', transition: 'opacity 0.15s ease' },
    onClick: () => props.onSelect?.(props.selected === slice.segment.key ? null : slice.segment.key),
  }, [
    slice.share > 0.09 ? h('title', { key: 't' }, `${slice.segment.label}：${formatTokens(slice.segment.tokens)} · ${(slice.share * 100).toFixed(1)}%`) : null,
    slice.share > 0.14
      ? h('text', {
        key: 'label', x: slice.labelX.toFixed(1), y: slice.labelY.toFixed(1),
        textAnchor: 'middle', dominantBaseline: 'middle', fontSize: '9', fontWeight: '600', fill: '#fff',
        pointerEvents: 'none',
      }, `${Math.round(slice.share * 100)}%`)
      : null,
  ])));
}

/* ------------------------------------------------------------------ */
/* Line chart (PRD §3.4 evolution timeline)                            */
/* ------------------------------------------------------------------ */

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: Array<{ x: number; y: number }>;
}

export interface ChartMarker {
  x: number;
  kind: 'compaction' | 'prune' | 'injection' | 'spike' | 'retry';
  title: string;
}

export function LineChart(props: {
  series: LineSeries[];
  eventLanes?: boolean;
  /** Full-window vertical extent without implying a single shared limit line. */
  scaleMax?: number | undefined;
  markers?: ChartMarker[];
  limit?: { value: number; label: string } | null;
  height?: number;
  yLabel?: string;
  xLabel?: string;
  formatY?: (value: number) => string;
  formatX?: (value: number) => string;
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}): unknown {
  const height = props.height ?? 260;
  const width = 720;
  const padding = { top: props.eventLanes === false ? 24 : 104, right: 16, bottom: 30, left: 56 };
  const plotW = width - padding.left - padding.right;
  /* hover: pointer position (svg units) + the nearest sample index. */
  const [hover, setHover] = useState<{ px: number; py: number; index: number } | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [pan, setPan] = useState<{ startClientX: number; from: number; to: number } | null>(null);
  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ChartMarker | null>(null);
  const [fitData, setFitData] = useState(false);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const svgRef = useRef<Element | null>(null);

  const visibleSeries = props.series.filter((s) => !props.hidden?.has(s.key));
  const allPoints = visibleSeries.flatMap((s) => s.points);
  const allX = [...props.series.flatMap((series) => series.points.map((point) => point.x)), ...(props.markers ?? []).map((marker) => marker.x)];
  const allY = allPoints.filter((p) => range === null || (p.x >= Math.min(range.from, range.to) && p.x <= Math.max(range.from, range.to))).map((p) => p.y);
  const scaleMax = props.scaleMax ?? props.limit?.value;
  if (scaleMax !== undefined && !fitData) allY.push(scaleMax);
  const dataMin = allX.length ? Math.min(...allX) : 0;
  const dataMax = allX.length ? Math.max(Math.min(...allX) + 1e-6, ...allX) : 1;
  const dataSpan = Math.max(1e-9, dataMax - dataMin);
  const xMin = range === null ? dataMin : Math.max(dataMin, Math.min(range.from, range.to));
  const xMax = range === null ? dataMax : Math.min(dataMax, Math.max(range.from, range.to));
  const yMax = Math.max(1, ...allY);
  const unit = 10 ** Math.floor(Math.log10(yMax)) / 2;
  const niceMax = Math.ceil(yMax / unit) * unit;
  const spanX = Math.max(1e-9, xMax - xMin) || 1;

  const toSvgX = (x: number) => padding.left + ((x - xMin) / spanX) * plotW;
  const toSvgY = (y: number) => height - padding.bottom - (y / niceMax) * (height - padding.top - padding.bottom);
  const formatY = props.formatY ?? ((value: number) => formatTokens(value));
  const formatX = props.formatX ?? ((value: number) => String(value));

  const gridY = [0, 0.25, 0.5, 0.75, 1].map((t) => t * niceMax);
  const hoverIndex = hover?.index ?? null;
  const hoverPoints = hoverIndex === null ? [] : visibleSeries
    .map((s) => { const x = visibleSeries[0]?.points[hoverIndex]?.x; return { series: s, point: x === undefined || x < (s.points[0]?.x ?? Infinity) || x > (s.points[s.points.length-1]?.x ?? -Infinity) ? undefined : s.points.reduce<(typeof s.points)[number] | undefined>((best, point) => !best || Math.abs(point.x-x) < Math.abs(best.x-x) ? point : best, undefined) }; })
    .filter((entry) => entry.point !== undefined);

  const pointerPosition = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current as SVGSVGElement | null;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    const svgY = ((event.clientY - rect.top) / rect.height) * height;
    const dataX = xMin + ((svgX - padding.left) / plotW) * spanX;
    if (svgX < padding.left - 4 || svgX > width - padding.right + 4) return null;
    return { svgX, svgY, dataX };
  };

  const nearestIndex = (dataX: number) => {
    let best = -1;
    let bestDist = Infinity;
    const base = visibleSeries[0]?.points ?? [];
    for (let index = 0; index < base.length; index++) {
      const point = base[index]!;
      if (point.x < xMin || point.x > xMax) continue;
      const dist = Math.abs(point.x - dataX);
      if (dist < bestDist) { bestDist = dist; best = index; }
    }
    return best;
  };

  /* Marker clustering: markers whose x overlaps on screen (≈10 svg units) form
   * a bubble when more than 3 overlap (PRD §3.4 交互). */
  const visibleMarkers = (props.markers ?? []).filter((m) => m.x >= xMin && m.x <= xMax)
    .map((marker, index) => ({ marker, key: `${marker.kind}:${marker.x}:${index}` }));
  const effectiveMarker = pinned ? visibleMarkers.find((entry) => entry.marker === pinned)?.key ?? activeMarker : activeMarker;
  const bucketSize = 10;
  const buckets = new Map<string, Array<{ marker: ChartMarker; key: string }>>();
  for (const entry of visibleMarkers) {
    const bucket = `${entry.marker.kind}:${Math.round(toSvgX(entry.marker.x) / bucketSize)}`;
    const list = buckets.get(bucket);
    if (list === undefined) buckets.set(bucket, [entry]);
    else list.push(entry);
  }
  const singles: Array<{ marker: ChartMarker; key: string }> = [];
  const clusters: Array<{ key: string; markers: ChartMarker[]; keys: string[]; cx: number }> = [];
  for (const members of buckets.values()) {
    if (members.length > 3) {
      const cx = members.reduce((sum, entry) => sum + toSvgX(entry.marker.x), 0) / members.length;
      clusters.push({
        key: `cluster:${members[0]!.marker.kind}:${Math.round(cx)}`,
        markers: members.map((entry) => entry.marker),
        keys: members.map((entry) => entry.key),
        cx,
      });
    } else {
      singles.push(...members);
    }
  }
  const hoveredCluster = clusters.find((cluster) => cluster.key === activeMarker);
  const eventDetail = pinned ?? visibleMarkers.find((entry) => entry.key === activeMarker)?.marker
    ?? (hoveredCluster ? { ...hoveredCluster.markers[0]!, title: `${hoveredCluster.markers.length} 条${MARKER_STYLE[hoveredCluster.markers[0]!.kind].label}：${hoveredCluster.markers.slice(0, 3).map((marker) => marker.title).join('；')}。点击气泡展开全部事件。` } : null);
  /** Expand a cluster bubble by zooming to its members' x extent. */
  const expandCluster = (cluster: { markers: ChartMarker[]; cx: number }) => {
    const xsList = cluster.markers.map((m) => m.x);
    const lo = Math.min(...xsList);
    const hi = Math.max(...xsList);
    const pad = Math.max((hi - lo) * 0.5, spanX * 0.12);
    setRange({ from: Math.max(dataMin, lo - pad), to: Math.min(dataMax, hi + pad) });
  };

  return h('div', { style: { position: 'relative', width: '100%' } }, [
    h('svg', {
      key: 'chart',
      ref: svgRef as unknown as string,
      viewBox: `0 0 ${width} ${height}`,
      width: '100%', height: height, preserveAspectRatio: 'none',
      style: { display: 'block', cursor: pan !== null ? 'grabbing' : 'crosshair', touchAction: 'none' },
      onMouseMove: (event: unknown) => {
        const typed = event as { clientX: number; clientY: number; buttons?: number };
        if (selection !== null && typed.buttons === 1) {
          const position = pointerPosition(typed);
          if (position) setSelection({ ...selection, to: Math.max(xMin, Math.min(xMax, position.dataX)) });
          return;
        }
        if (pan !== null && typed.buttons === 1) {
          const svg = svgRef.current as SVGSVGElement | null;
          const rect = svg?.getBoundingClientRect();
          if (rect === undefined || rect.width === 0) return;
          const dxSvg = ((typed.clientX - pan.startClientX) / rect.width) * width;
          const shift = -(dxSvg / plotW) * (pan.to - pan.from);
          let from = pan.from + shift;
          let to = pan.to + shift;
          if (from < dataMin) { to += dataMin - from; from = dataMin; }
          if (to > dataMax) { from -= to - dataMax; to = dataMax; }
          setRange({ from: Math.max(dataMin, from), to: Math.min(dataMax, to) });
          return;
        }
        const position = pointerPosition(typed);
        if (!position) return;
        const index = nearestIndex(position.dataX);
        if (position.svgY < padding.top) { setHover(null); return; }
        if (index >= 0) setHover({ px: position.svgX, py: position.svgY, index });
        else setHover(null);
      },
      onMouseLeave: () => { setHover(null); setPan(null); setSelection(null); },
      onMouseDown: (event: unknown) => {
        const typed = event as { clientX: number; clientY: number; shiftKey: boolean; button: number };
        if (typed.button !== 0) return;
        const position = pointerPosition(typed);
        if (!position) return;
        if (typed.shiftKey) setPan({ startClientX: typed.clientX, from: xMin, to: xMax });
        else setSelection({ from: position.dataX, to: position.dataX });
        setHover(null);
      },
      onMouseUp: () => {
        if (selection !== null && Math.abs(selection.to - selection.from) > spanX * 0.01) {
          setRange({ from: Math.min(selection.from, selection.to), to: Math.max(selection.from, selection.to) });
        }
        setSelection(null); setPan(null);
      },
      onDoubleClick: () => setRange(null),
    }, [
      selection !== null ? h('rect', { key: 'selection', x: toSvgX(Math.min(selection.from, selection.to)), y: padding.top, width: Math.abs(toSvgX(selection.to) - toSvgX(selection.from)), height: height - padding.top - padding.bottom, fill: '#4285f4', opacity: 0.18, pointerEvents: 'none' }) : null,
      ...(props.eventLanes === false ? [] : ['compaction', 'prune', 'injection', 'spike'] as const).map((kind) => h('g', { key: `lane-${kind}` }, [
        h('line', { x1: padding.left, x2: width - padding.right, y1: markerLane(kind), y2: markerLane(kind), stroke: 'currentColor', opacity: 0.06 }),
        h('text', { x: padding.left - 6, y: markerLane(kind) + 3, textAnchor: 'end', fontSize: 9, fill: MARKER_STYLE[kind].color }, MARKER_STYLE[kind].label),
      ])),
      /* Y grid + labels */
      ...gridY.map((value, index) => h('g', { key: `grid-${index}` }, [
        h('line', {
          x1: padding.left, x2: width - padding.right,
          y1: toSvgY(value).toFixed(1), y2: toSvgY(value).toFixed(1),
          stroke: 'color-mix(in srgb, currentColor 10%, transparent)', strokeWidth: '1',
        }),
        h('text', {
          x: padding.left - 6, y: (toSvgY(value) + 3).toFixed(1), textAnchor: 'end', fontSize: '10',
          fill: 'currentColor', opacity: 0.55,
        }, formatY(value)),
      ])),
      /* X labels */
      ...(xTicks(xMin, xMax).map((value, index) => h('text', {
        key: `xtick-${index}`,
        x: toSvgX(value).toFixed(1), y: height - 10, textAnchor: 'middle', fontSize: '10',
        fill: 'currentColor', opacity: 0.55,
      }, formatX(value)))),
      /* Axis labels */
      props.yLabel ? h('text', {
        key: 'ylabel', x: 12, y: padding.top - 8, fontSize: '10', fill: 'currentColor', opacity: 0.55,
      }, props.yLabel) : null,
      props.xLabel ? h('text', {
        key: 'xlabel', x: width - padding.right, y: height - 10, textAnchor: 'end', fontSize: '10', fill: 'currentColor', opacity: 0.55,
      }, props.xLabel) : null,
      /* Window limit line */
      props.limit && props.limit.value <= niceMax ? h('line', {
        key: 'limit',
        x1: padding.left, x2: width - padding.right,
        y1: toSvgY(props.limit.value).toFixed(1), y2: toSvgY(props.limit.value).toFixed(1),
        stroke: 'var(--dsh-eval-red, #e5484d)', strokeWidth: '1.5', strokeDasharray: '6 4',
      }, h('title', null, props.limit.label)) : null,
      /* Series */
      ...visibleSeries.map((series) => {
        const points = sampleLine(series.points.filter((p) => p.x >= xMin && p.x <= xMax))
          .map((p) => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`);
        if (points.length === 0) return null;
        if (points.length === 1) {
          const [cx, cy] = points[0]!.split(',');
          return h('circle', { key: series.key, cx, cy, r: 3, fill: series.color }, h('title', null, series.label));
        }
        return h('polyline', {
          key: series.key,
          points: points.join(' '),
          fill: 'none', stroke: series.color, strokeWidth: '2',
          strokeDasharray: series.dashed ? '5 4' : undefined,
          strokeLinejoin: 'round', strokeLinecap: 'round',
        }, h('title', null, series.label));
      }),
      /* Markers: guides under shapes; shapes dim to 30% unless hovered. */
      ...singles.map((entry) => renderGuide(entry.marker, entry.key, toSvgX, height, padding.top, padding.bottom, effectiveMarker)),
      ...singles.map((entry) => renderMarkerShape(entry.marker, entry.key, toSvgX, toSvgY, niceMax, effectiveMarker, setActiveMarker, setPinned)),
      ...clusters.map((cluster) => renderClusterBubble(cluster, toSvgX, toSvgY, niceMax, effectiveMarker, setActiveMarker, () => setOpenCluster(openCluster === cluster.key ? null : cluster.key))),
      /* Hover crosshair + tooltip anchor */
      hover !== null && hoverPoints.length > 0 && eventDetail === null && openCluster === null ? h(Fragment, { key: 'hover' }, [
        h('line', {
          x1: toSvgX(hoverPoints[0]!.point!.x).toFixed(1), x2: toSvgX(hoverPoints[0]!.point!.x).toFixed(1),
          y1: padding.top, y2: height - padding.bottom,
          stroke: 'currentColor', opacity: 0.3, strokeWidth: '1', pointerEvents: 'none',
        }),
        ...hoverPoints.map((entry) => h('circle', {
          key: `hp-${entry.series.key}`,
          cx: toSvgX(entry.point!.x).toFixed(1), cy: toSvgY(entry.point!.y).toFixed(1),
          r: '3.5', fill: entry.series.color, stroke: 'var(--dsh-eval-surface, Canvas)', strokeWidth: '1.5',
          pointerEvents: 'none',
        })),
      ]) : null,
    ]),
    eventDetail !== null && openCluster === null ? h('div', { key: 'event-detail', role: pinned ? 'region' : 'tooltip', style: { ...(pinned ? { marginTop: 8 } : { position: 'absolute', top: 102, left: `${Math.min(65, Math.max(0, (toSvgX(eventDetail.x) / width) * 100 - 15))}%`, width: 'min(380px, 90%)', zIndex: 8, pointerEvents: 'none', boxShadow: '0 4px 16px #0002' }), padding: '10px 12px', border: `1px solid ${MARKER_STYLE[eventDetail.kind].color}`, borderRadius: 8, fontSize: 12, lineHeight: 1.6, background: 'var(--dsh-eval-surface, Canvas)' } }, [
      h('div', { key: 'header', style: { display: 'flex', gap: 12, alignItems: 'center' } }, [
        h('strong', { key: 'kind', style: { color: MARKER_STYLE[eventDetail.kind].color } }, MARKER_STYLE[eventDetail.kind].label),
        h('span', { key: 'state', style: { opacity: 0.6 } }, pinned ? '已固定选中' : '点击标记固定详情'),
        pinned ? h('button', { key: 'close', type: 'button', onClick: () => { setPinned(null); setActiveMarker(null); }, style: { marginLeft: 'auto', cursor: 'pointer' } }, '取消选中') : null,
      ]),
      h('div', { key: 'body' }, eventDetail.title),
    ]) : null,
    /* Tooltip: follows the pointer, flips near the right/bottom edges. */
    hover !== null && hoverPoints.length > 0 && eventDetail === null && openCluster === null ? h('div', {
      key: 'tooltip',
      style: {
        position: 'absolute',
        left: `${(hover.px / width) * 100}%`,
        top: hover.py,
        transform: `translate(${hover.px > width * 0.62 ? 'calc(-100% - 12px)' : '12px'}, ${hover.py < height * 0.38 ? '10px' : 'calc(-100% - 10px)'})`,
        background: 'var(--dsh-eval-surface, Canvas)',
        color: 'var(--dsh-eval-text, CanvasText)',
        border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
        borderRadius: '8px', padding: '6px 10px', fontSize: '11px', lineHeight: 1.5,
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap',
      },
    }, [
      props.formatX !== undefined
        ? h('div', { key: 'x', style: { fontWeight: 600, marginBottom: '2px' } }, props.formatX(hoverPoints[0]!.point!.x))
        : null,
      ...hoverPoints.map((entry) => h('div', {
        key: entry.series.key,
        style: { display: 'flex', alignItems: 'center', gap: '6px' },
      }, [
        h('span', { key: 'dot', style: { width: '8px', height: '8px', borderRadius: '2px', background: entry.series.color } }),
        h('span', { key: 'label' }, entry.series.label),
        h('span', { key: 'value', style: { fontWeight: 600 } }, formatY(entry.point!.y)),
      ])),
    ]) : null,
    /* Cluster popup: member list + zoom button (PRD §3.4 交互 3). */
    (() => {
      const open = clusters.find((cluster) => cluster.key === openCluster);
      if (open === undefined) return null;
      return h('div', {
        key: 'cluster-popup',
        style: {
          position: 'absolute',
          left: `${Math.min(78, (open.cx / width) * 100)}%`,
          top: '18px',
          transform: 'translate(-50%, 18px)',
          background: 'var(--dsh-eval-surface, Canvas)',
          color: 'var(--dsh-eval-text, CanvasText)',
          border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
          borderRadius: '8px', padding: '6px 10px', fontSize: '11px', lineHeight: 1.5,
          boxShadow: '0 6px 18px rgba(0,0,0,0.22)', zIndex: 6,
          maxWidth: '320px', maxHeight: '160px', overflowY: 'auto', whiteSpace: 'nowrap',
        },
      }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '3px' } }, [
          h('span', { key: 'title' }, `此位置 ${open.markers.length} 条事件`),
          h('button', {
            key: 'zoom', type: 'button',
            style: { marginLeft: 'auto', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', borderRadius: '5px', padding: '0 6px', font: 'inherit', fontSize: '10.5px', cursor: 'pointer', color: 'inherit' },
            onClick: () => { expandCluster(open); setOpenCluster(null); },
          }, '放大此区间'),
          h('button', {
            key: 'close', type: 'button',
            style: { background: 'transparent', border: 'none', font: 'inherit', fontSize: '12px', cursor: 'pointer', color: 'inherit', opacity: 0.6 },
            onClick: () => setOpenCluster(null),
          }, '×'),
        ]),
        ...open.markers.map((marker, index) => h('div', {
          key: `member-${index}`, role: 'button', tabIndex: 0,
          onClick: () => { setPinned(marker); setOpenCluster(null); },
          onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') { setPinned(marker); setOpenCluster(null); } },
          style: { display: 'flex', alignItems: 'baseline', gap: '6px' },
        }, [
          h('span', { key: 'dot', style: { width: '7px', height: '7px', borderRadius: kindDotRadius(marker.kind), background: MARKER_STYLE[marker.kind].color, flexShrink: 0 } }),
          h('span', { key: 'text', style: { opacity: 0.85, whiteSpace: 'normal' } }, marker.title),
        ])),
      ]);
    })(),
    /* Legend + zoom controls */
    h('div', {
      key: 'legend',
      style: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', fontSize: '11px', marginTop: '6px' },
    }, [
      scaleMax !== undefined ? h('button', { key: 'scale', type: 'button', onClick: () => setFitData((value) => !value), style: { cursor: 'pointer', font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid #aaa', borderRadius: 5 } }, fitData ? '纵轴：适配数据（点击显示完整窗口）' : '纵轴：完整窗口（点击适配数据）') : null,
      ...props.series.map((series) => h('button', {
        key: series.key,
        type: 'button',
        onClick: () => props.onToggle?.(series.key),
        'aria-pressed': !props.hidden?.has(series.key),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          font: 'inherit', color: 'inherit',
          opacity: props.hidden?.has(series.key) ? 0.35 : 1,
        },
      }, [
        h('span', { key: 'dot', style: { width: '10px', height: '3px', borderRadius: '2px', background: series.color } }),
        h('span', { key: 'label' }, series.label),
      ])),
      range !== null ? h('button', {
        key: 'reset',
        type: 'button',
        onClick: () => setRange(null),
        style: {
          marginLeft: 'auto', background: 'transparent',
          border: '1px solid color-mix(in srgb, currentColor 25%, transparent)', borderRadius: '6px',
          padding: '1px 8px', font: 'inherit', fontSize: '11px', cursor: 'pointer', color: 'inherit',
        },
      }, '重置缩放') : null,
    ]),
    h('div', { key: 'hint', style: { fontSize: '10px', opacity: 0.45, marginTop: '2px' } },
      props.eventLanes === false ? '拖拽框选缩放 · Shift + 拖拽平移 · 双击重置 · 点击图例显隐 · 悬停比较数值' : '拖拽框选缩放 · Shift + 拖拽平移 · 双击重置 · 悬停查看事件 · 点击固定详情 · 数字气泡展开同类事件'),
  ]);
}

/** Marker visual identity per kind (PRD §3.4 colors/shapes). */
const MARKER_STYLE: Record<ChartMarker['kind'], { color: string; label: string }> = {
  compaction: { color: 'var(--dsh-eval-green, #30a46c)', label: '摘要压缩' },
  prune: { color: '#0891b2', label: '历史修剪' },
  injection: { color: 'var(--dsh-eval-orange, #e8791a)', label: '注入' },
  spike: { color: 'var(--dsh-eval-red, #e5484d)', label: '激增' },
  retry: { color: 'var(--dsh-eval-purple, #9b59b6)', label: '重试' },
};

function kindDotRadius(kind: ChartMarker['kind']): string {
  return kind === 'prune' ? '1px' : '50%';
}

function markerOpacity(key: string, activeKey: string | null): number {
  if (activeKey === null) return 0.95;
  return activeKey === key ? 1 : 0.3;
}

/** Guide lines (vertical event spines) — drawn under all shapes. */
function renderGuide(
  marker: ChartMarker,
  key: string,
  toSvgX: (x: number) => number,
  height: number,
  paddingTop: number,
  paddingBottom: number,
  activeKey: string | null,
): unknown {
  const x = toSvgX(marker.x).toFixed(1);
  const dim = markerOpacity(key, activeKey) * (activeKey === null ? 1 : 0.4);
  const guide = marker.kind === 'compaction' || marker.kind === 'prune'
    ? {
      x1: x, x2: x,
      y1: markerLane(marker.kind), y2: height - paddingBottom,
      stroke: MARKER_STYLE[marker.kind].color, strokeWidth: '1',
      strokeDasharray: '3 3', opacity: 0.35 * (activeKey === null ? 1 : dim),
    }
    : marker.kind === 'injection'
      ? {
        x1: x, x2: x,
        y1: markerLane(marker.kind), y2: height - paddingBottom,
        stroke: 'var(--dsh-eval-orange, #e8791a)', strokeWidth: '1',
        strokeDasharray: '2 4', opacity: 0.22 * (activeKey === null ? 1 : dim),
      }
      : activeKey === key ? { x1: x, x2: x, y1: markerLane(marker.kind), y2: height - paddingBottom, stroke: MARKER_STYLE[marker.kind].color, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.6 } : null;
  if (guide === null) return null;
  return h('line', { key: `guide-${key}`, ...guide, pointerEvents: 'none' });
}

/** Marker shapes: 压缩=绿色三角, 注入=橙色圆, 激增=红色菱形. Hovering one dims
 * the rest to 30% (PRD §3.4 交互 2). */
function renderMarkerShape(
  marker: ChartMarker,
  key: string,
  toSvgX: (x: number) => number,
  toSvgY: (y: number) => number,
  yMax: number,
  activeKey: string | null,
  setActiveKey: (value: string | null) => void,
  onSelect: (marker: ChartMarker) => void,
): unknown {
  const x = toSvgX(marker.x);
  const y = markerLane(marker.kind);
  const color = MARKER_STYLE[marker.kind].color;
  const attrs: Record<string, string | number> = marker.kind === 'compaction'
    ? { d: `M ${x - 7} ${y + 6} L ${x + 7} ${y + 6} L ${x} ${y - 8} Z` }
    : marker.kind === 'injection'
      ? { cx: +x.toFixed(1), cy: +y.toFixed(1), r: 5.5 }
      : marker.kind === 'spike'
        ? { d: `M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z` }
        : { x: +((x - 4.5).toFixed(1)), y: +((y - 4.5).toFixed(1)), width: 9, height: 9, rx: 2 };
  const shape = h(marker.kind === 'injection' || marker.kind === 'retry' || marker.kind === 'prune' ? (marker.kind === 'injection' ? 'circle' : 'rect') : 'path', {
    key: `marker-${key}`, role: 'button', tabIndex: 0, 'aria-label': marker.title, style: { cursor: 'pointer' },
    onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onClick: () => onSelect(marker),
    onKeyDown: (event: { key: string; preventDefault: () => void }) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(marker); } },
    ...attrs,
    fill: color,
    stroke: 'var(--dsh-eval-surface, Canvas)',
    strokeWidth: activeKey === key ? '2' : '1',
    opacity: markerOpacity(key, activeKey),
  });
  return h('g', { key: `hit-${key}`, onMouseEnter: () => setActiveKey(key), onMouseLeave: () => setActiveKey(null) }, [
    h('rect', { key: 'hit-area', x: x - 10, y: y - 10, width: 20, height: 20, fill: 'transparent', style: { cursor: 'pointer' }, onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(), onClick: () => onSelect(marker) }),
    shape,
  ]);
}

/** Cluster bubble for >3 overlapping markers: 「N 条激增」, click to zoom in. */
function renderClusterBubble(
  cluster: { key: string; markers: ChartMarker[]; cx: number },
  toSvgX: (x: number) => number,
  toSvgY: (y: number) => number,
  yMax: number,
  activeKey: string | null,
  setActiveKey: (value: string | null) => void,
  onOpen: () => void,
): unknown {
  const counts = new Map<ChartMarker['kind'], number>();
  for (const marker of cluster.markers) counts.set(marker.kind, (counts.get(marker.kind) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const color = MARKER_STYLE[dominant[0]].color;
  const label = dominant[1] === cluster.markers.length
    ? `${cluster.markers.length} 条${MARKER_STYLE[dominant[0]].label}`
    : `${cluster.markers.length} 条事件`;
  const cy = markerLane(dominant[0]);
  const opacity = markerOpacity(cluster.key, activeKey);
  return h('g', {
    key: `cluster-${cluster.key}`,
    style: { cursor: 'pointer' },
    onMouseEnter: () => setActiveKey(cluster.key),
    onMouseLeave: () => setActiveKey(null),
    onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onClick: onOpen,
  }, [
    h('circle', {
      key: 'bubble',
      cx: +cluster.cx.toFixed(1), cy: +cy.toFixed(1), r: '9',
      fill: color, opacity, stroke: 'var(--dsh-eval-surface, Canvas)', strokeWidth: activeKey === cluster.key ? '2' : '1',
    }),
    h('text', {
      key: 'count', x: +cluster.cx.toFixed(1), y: +((cy + 3).toFixed(1)),
      textAnchor: 'middle', fontSize: '9', fontWeight: '700', fill: '#fff', opacity,
      pointerEvents: 'none',
    }, String(cluster.markers.length)),

  ]);
}

/* ------------------------------------------------------------------ */
/* Bar chart (tools distribution, compare)                             */
/* ------------------------------------------------------------------ */

export function BarChart(props: {
  bars: Array<{ label: string; value: number; secondary?: number; title?: string }>;
  height?: number;
  formatValue?: (value: number) => string;
  formatSecondary?: (value: number) => string;
  onSelect?: (label: string) => void;
  selected?: string | null;
}): unknown {
  const height = props.height ?? 200;
  const width = 720;
  const padding = { top: 14, right: 12, bottom: 42, left: 56 };
  const [hover, setHover] = useState<number | null>(null);
  const bars = props.bars.filter((bar) => bar.value > 0 || (bar.secondary ?? 0) > 0);
  if (bars.length === 0) {
    return h('div', { style: { display: 'grid', placeItems: 'center', height, opacity: 0.55, fontSize: '12px' } }, '暂无数据');
  }
  const maxValue = Math.max(1, ...bars.map((bar) => bar.value + (bar.secondary ?? 0)));
  const niceMax = niceCeil(maxValue);
  const bandWidth = (width - padding.left - padding.right) / bars.length;
  const barWidth = Math.min(48, bandWidth * 0.62);
  const formatValue = props.formatValue ?? ((value: number) => formatTokens(value));
  return h('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height: height, role: 'img',
    'aria-label': bars.map((bar) => `${bar.label} ${formatValue(bar.value)}`).join(', '),
  }, [
    ...[0, 0.5, 1].map((t, index) => {
      const value = t * niceMax;
      const y = height - padding.bottom - (value / niceMax) * (height - padding.top - padding.bottom);
      return h('g', { key: `grid-${index}` }, [
        h('line', {
          x1: padding.left, x2: width - padding.right, y1: y.toFixed(1), y2: y.toFixed(1),
          stroke: 'color-mix(in srgb, currentColor 10%, transparent)', strokeWidth: '1',
        }),
        h('text', { x: padding.left - 6, y: (y + 3).toFixed(1), textAnchor: 'end', fontSize: '10', fill: 'currentColor', opacity: 0.55 }, formatValue(value)),
      ]);
    }),
    ...bars.map((bar, index) => {
      const x = padding.left + bandWidth * index + (bandWidth - barWidth) / 2;
      const plotHeight = height - padding.top - padding.bottom;
      const mainHeight = (bar.value / niceMax) * plotHeight;
      const secondaryHeight = ((bar.secondary ?? 0) / niceMax) * plotHeight;
      const baseY = height - padding.bottom;
      const isSelected = props.selected === bar.label;
      return h('g', {
        key: bar.label,
        onMouseEnter: () => setHover(index),
        onMouseLeave: () => setHover(null),
        onClick: () => props.onSelect?.(bar.label),
        style: { cursor: props.onSelect ? 'pointer' : 'default', opacity: hover === index || isSelected ? 1 : 0.88 },
      }, [
        h('rect', {
          x: x.toFixed(1), y: (baseY - mainHeight).toFixed(1),
          width: barWidth.toFixed(1), height: Math.max(bar.value > 0 ? 2 : 0, mainHeight).toFixed(1),
          rx: '3', fill: isSelected ? 'var(--dsh-eval-blue, #4285f4)' : 'color-mix(in srgb, var(--dsh-eval-blue, #4285f4) 78%, transparent)',
        }),
        bar.secondary !== undefined && bar.secondary > 0 ? h('rect', {
          x: x.toFixed(1), y: (baseY - mainHeight - secondaryHeight).toFixed(1),
          width: barWidth.toFixed(1), height: Math.max(2, secondaryHeight).toFixed(1),
          rx: '2', fill: 'var(--dsh-eval-red, #e5484d)', opacity: 0.85,
        }) : null,
        h('text', {
          x: (x + barWidth / 2).toFixed(1), y: (baseY + 13).toFixed(1),
          textAnchor: 'middle' as const, fontSize: '9.5', fill: 'currentColor', opacity: 0.8,
        }, truncateLabel(bar.label, Math.max(6, Math.floor(bandWidth / 6)))),
        hover === index ? h('text', {
          x: (x + barWidth / 2).toFixed(1), y: (baseY - mainHeight - secondaryHeight - 5).toFixed(1),
          textAnchor: 'middle' as const, fontSize: '10', fontWeight: '600', fill: 'currentColor',
        }, `${formatValue(bar.value)}${bar.secondary !== undefined && bar.secondary > 0 ? ` (+${props.formatSecondary?.(bar.secondary) ?? formatValue(bar.secondary)})` : ''}`) : null,
        bar.title ? h('title', { key: 't' }, bar.title) : null,
      ]);
    }),
  ]);
}

function truncateLabel(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, Math.max(1, max - 1))}…`;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function xTicks(min: number, max: number): number[] {
  const count = 6;
  if (max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

/** Preserve each bucket's extrema so compaction drops survive downsampling. */
function sampleLine(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 1200) return points;
  const result = [points[0]!];
  const size = Math.ceil(points.length / 500);
  for (let start = 1; start < points.length - 1; start += size) {
    const bucket = points.slice(start, Math.min(points.length - 1, start + size));
    let low = 0, high = 0;
    bucket.forEach((point, index) => {
      if (point.y < bucket[low]!.y) low = index;
      if (point.y > bucket[high]!.y) high = index;
    });
    for (const index of [...new Set([low, high])].sort((a, b) => a - b)) result.push(bucket[index]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

function markerLane(kind: ChartMarker['kind']): number {
  return kind === 'compaction' ? 16 : kind === 'prune' ? 38 : kind === 'injection' ? 60 : 82;
}

/** Category charts enlarge horizontally; drag the enlarged viewport to pan. */
export function ChartViewport(props: { children?: unknown }): unknown {
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; left: number } | null>(null);
  return h('div', { style: { display: 'grid', gap: 6 } }, [
    h('div', { key: 'controls', style: { display: 'flex', gap: 8, fontSize: 11 } }, [
      h('button', { key: 'out', disabled: zoom <= 1, onClick: () => setZoom((value) => Math.max(1, value - .5)) }, '缩小'),
      h('button', { key: 'in', disabled: zoom >= 4, onClick: () => setZoom((value) => Math.min(4, value + .5)) }, '放大'),
      h('button', { key: 'reset', onClick: () => setZoom(1) }, '重置'),
      h('span', { key: 'hint' }, `${zoom.toFixed(1)}× · 放大后拖拽查看`),
    ]),
    h('div', { key: 'viewport', style: { overflowX: 'auto', cursor: zoom > 1 ? 'grab' : 'default' },
      onMouseDown: (event: {clientX: number; currentTarget: HTMLElement}) => { if (zoom > 1) drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft }; },
      onMouseMove: (event: {clientX: number; buttons: number; currentTarget: HTMLElement}) => { if (drag.current && event.buttons === 1) event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x); },
      onMouseUp: () => { drag.current = null; }, onMouseLeave: () => { drag.current = null; },
    }, h('div', { style: { width: `${zoom * 100}%` } }, props.children)),
  ]);
}
