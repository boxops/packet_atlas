/** The single shortcut map, shown by the "?" overlay and mirrored in docs/UX_SPEC.md. */
import { modKey } from './dom';

export interface Shortcut {
  keys: string[];
  label: string;
}

export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Find & navigate',
    items: [
      { keys: [`${modKey}+K`, '/'], label: 'Command palette: search or ask' },
      { keys: ['Click'], label: 'Select & focus' },
      { keys: ['Double-click', 'Enter'], label: 'Zoom into selection' },
      { keys: ['Esc'], label: 'Close / clear / step out one level' },
      { keys: ['H'], label: 'Home: global overview' },
      { keys: ['1–9'], label: 'Jump to site 1–9' },
      { keys: ['[', ']'], label: 'Previous / next device at this level' },
      { keys: ['F'], label: 'Frame selection' },
      { keys: ['B'], label: 'Bookmark current view' },
    ],
  },
  {
    group: 'Act on selection',
    items: [
      { keys: ['Right-click', 'Long-press'], label: 'Radial quick actions' },
      { keys: ['T'], label: 'Trace path from selection' },
      { keys: ['N'], label: 'Show neighbours' },
      { keys: ['C'], label: 'Run show command' },
      { keys: ['Y'], label: 'Copy IP address' },
    ],
  },
  {
    group: 'Incidents',
    items: [
      { keys: ['I'], label: 'Incident mode: tour active alarms' },
      { keys: ['←', '→'], label: 'Previous / next alarm' },
      { keys: ['Space'], label: 'Auto-play incidents' },
    ],
  },
  {
    group: 'View & settings',
    items: [
      { keys: ['L'], label: 'Legend' },
      { keys: ['W'], label: 'Wallboard mode' },
      { keys: ['S'], label: 'Settings' },
      { keys: ['E'], label: 'Cycle effects level' },
      { keys: ['A'], label: 'Accessibility mode' },
      { keys: ['G'], label: 'Scanline / grain overlay' },
      { keys: ['M'], label: 'Sound on / off' },
      { keys: ['?'], label: 'This overlay' },
    ],
  },
  {
    group: 'Camera',
    items: [
      { keys: ['Drag'], label: 'Orbit' },
      { keys: ['Right-drag', 'Shift+Drag'], label: 'Pan' },
      { keys: ['Scroll', 'Pinch'], label: 'Zoom' },
    ],
  },
];
