import React from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

/** Scalable outlines rebuilt from the supplied Codex UI reference crops. */
export type ReferenceIconName =
  | 'mic' | 'wave' | 'search' | 'chevron-right' | 'chevron-left' | 'chevron-down'
  | 'folder' | 'clock' | 'compose' | 'check' | 'plus' | 'close'
  | 'hand' | 'shield-check' | 'shield-lock' | 'warning' | 'settings'
  | 'menu' | 'arrow-up' | 'account';

export function ReferenceIcon({ name, size = 24, color = '#fff', strokeWidth = 2 }: {
  name: ReferenceIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const ink = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let drawing: React.ReactNode;
  switch (name) {
    case 'mic':
      drawing = <><Rect x="8" y="2.5" width="8" height="13" rx="4" {...ink}/><Path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22" {...ink} fill="none"/></>;
      break;
    case 'wave':
      drawing = <><Line x1="4" y1="10" x2="4" y2="14" {...ink}/><Line x1="9" y1="6" x2="9" y2="18" {...ink}/><Line x1="14" y1="8" x2="14" y2="16" {...ink}/><Line x1="19" y1="10" x2="19" y2="14" {...ink}/></>;
      break;
    case 'search': drawing = <><Circle cx="10.8" cy="10.8" r="6.6" {...ink} fill="none"/><Path d="m16 16 5 5" {...ink}/></>; break;
    case 'chevron-right': drawing = <Path d="m9 5 7 7-7 7" {...ink}/>; break;
    case 'chevron-left': drawing = <Path d="m15 5-7 7 7 7" {...ink}/>; break;
    case 'chevron-down': drawing = <Path d="m5 9 7 7 7-7" {...ink}/>; break;
    case 'folder': drawing = <><Path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2.3 2.3H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...ink}/><Line x1="3" y1="10.2" x2="21" y2="10.2" {...ink}/></>; break;
    case 'clock': drawing = <><Circle cx="12" cy="12" r="9" {...ink}/><Path d="M12 6.5v5.8l3.8 2.1" {...ink}/></>; break;
    case 'compose': drawing = <><Path d="M13.8 4.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" {...ink}/><Path d="m9.5 14.5 1.5-4.2L19 2.5a2 2 0 0 1 2.8 2.8l-8 8-4.3 1.2z" {...ink}/></>; break;
    case 'check': drawing = <Path d="m4.5 12.5 5 5 10-11" {...ink}/>; break;
    case 'plus': drawing = <Path d="M12 4v16M4 12h16" {...ink}/>; break;
    case 'close': drawing = <Path d="M5 5 19 19M19 5 5 19" {...ink}/>; break;
    case 'hand':
      drawing = <Path d="M8 11V5.5a1.7 1.7 0 0 1 3.4 0V9M11.4 9V4a1.7 1.7 0 0 1 3.4 0v5M14.8 9V5.5a1.7 1.7 0 0 1 3.4 0v6.6M18.2 10.5a1.7 1.7 0 0 1 3.4 0V15a8.4 8.4 0 0 1-8.4 8.4H11A8.7 8.7 0 0 1 3 16V9a1.7 1.7 0 0 1 3.4 0v5" {...ink}/>;
      break;
    case 'shield-check': drawing = <><Path d="M12 2 21 6v6.5c0 5.2-4.2 8.5-9 9.8-4.8-1.3-9-4.6-9-9.8V6z" {...ink}/><Path d="m7.5 12 3.1 3.1 6-6.5" {...ink}/></>; break;
    case 'shield-lock': drawing = <><Path d="M12 2 21 6v6.5c0 5.2-4.2 8.5-9 9.8-4.8-1.3-9-4.6-9-9.8V6z" {...ink}/><Rect x="8.4" y="11" width="7.2" height="6" rx="1.3" {...ink}/><Path d="M10 11V9.7a2 2 0 0 1 4 0V11" {...ink}/></>; break;
    case 'warning': drawing = <><Path d="M10 3.7a2.3 2.3 0 0 1 4 0l8.2 14.5a2.3 2.3 0 0 1-2 3.4H3.8a2.3 2.3 0 0 1-2-3.4z" {...ink}/><Path d="M12 9v5" {...ink}/><Circle cx="12" cy="17.6" r=".65" fill={color}/></>; break;
    case 'settings': drawing = <><Path d="M10 2.8h4l.6 2.2a7.5 7.5 0 0 1 2 .8l2-.9 2.8 2.8-.9 2a7.5 7.5 0 0 1 .8 2l2.2.6v4l-2.2.6a7.5 7.5 0 0 1-.8 2l.9 2-2.8 2.8-2-.9a7.5 7.5 0 0 1-2 .8L14 24h-4l-.6-2.2a7.5 7.5 0 0 1-2-.8l-2 .9-2.8-2.8.9-2a7.5 7.5 0 0 1-.8-2L.5 14.5v-4l2.2-.6a7.5 7.5 0 0 1 .8-2l-.9-2 2.8-2.8 2 .9a7.5 7.5 0 0 1 2-.8z" transform="translate(0 -1) scale(1 .94)" {...ink}/><Circle cx="12" cy="12" r="3.4" {...ink}/></>; break;
    case 'menu': drawing = <Path d="M4 8h16M4 16h10" {...ink}/>; break;
    case 'arrow-up': drawing = <Path d="M12 20V4m-7 7 7-7 7 7" {...ink}/>; break;
    case 'account': drawing = <><Circle cx="12" cy="12" r="9" {...ink}/><Circle cx="12" cy="12" r="6.6" {...ink}/></>; break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...ink}>{drawing}</Svg>;
}
