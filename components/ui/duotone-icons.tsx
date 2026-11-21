import type { ReactNode, SVGProps } from 'react';

/**
 * Two-tone icon set: a light cyan back shape with a deeper indigo front shape
 * offset over it, flat fills and rounded corners. Every icon is a 24×24 SVG
 * that takes a className, so it scales to whatever size the surrounding
 * control already sets (size-4, h-5 w-5, …). Presentation only.
 */

// Brand teal (back) and brand navy/deep teal (front), set per theme in globals.css.
const BACK = 'fill-(--duo-back)';
const FRONT = 'fill-(--duo-front)';
const FRONT_ALT = 'fill-(--duo-front)';

export type DuoProps = SVGProps<SVGSVGElement> & { size?: number | string };

function Svg({ size, children, ...props }: DuoProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={props['aria-label'] ? undefined : true}
      focusable="false"
      {...(size !== undefined ? { width: size, height: size } : {})}
      {...props}
    >
      {children}
    </svg>
  );
}

export function DuoDashboard(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="14" height="10" rx="2.5" className={BACK} />
      <rect x="9" y="9" width="13" height="12" rx="3" className={FRONT} />
      <rect x="12" y="15" width="1.8" height="3.5" rx="0.9" className={BACK} />
      <rect x="15.6" y="12.5" width="1.8" height="6" rx="0.9" className={BACK} />
      <rect x="19.2" y="14" width="1.8" height="4.5" rx="0.9" className={BACK} />
    </Svg>
  );
}

export function DuoProjects(props: DuoProps) {
  return (
    <Svg {...props}>
      <path d="M2 7a2.5 2.5 0 0 1 2.5-2.5h3.2a2 2 0 0 1 1.5.7l1 1.1H15a2.5 2.5 0 0 1 2.5 2.5v6.7A2.5 2.5 0 0 1 15 18H4.5A2.5 2.5 0 0 1 2 15.5Z" className={BACK} />
      <rect x="9" y="10" width="13" height="11" rx="3" className={FRONT} />
      <rect x="12" y="14" width="7" height="1.8" rx="0.9" className={BACK} />
      <rect x="12" y="17.4" width="4.5" height="1.8" rx="0.9" className={BACK} />
    </Svg>
  );
}

export function DuoUsers(props: DuoProps) {
  return (
    <Svg {...props}>
      <circle cx="8.5" cy="7.5" r="4" className={BACK} />
      <path d="M1.5 19.5a7 7 0 0 1 14 0v.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1Z" className={BACK} />
      <circle cx="16.5" cy="10.5" r="3.5" className={FRONT} />
      <path d="M10.5 21v-1a6 6 0 0 1 12 0v1Z" className={FRONT} />
    </Svg>
  );
}

export function DuoDatabase(props: DuoProps) {
  return (
    <Svg {...props}>
      <path d="M2 6c0-2 3.6-3.5 7.5-3.5S17 4 17 6v8c0 2-3.6 3.5-7.5 3.5S2 16 2 14Z" className={BACK} />
      <path d="M8 11c0-2 3.1-3 7-3s7 1 7 3v7.5c0 2-3.1 3-7 3s-7-1-7-3Z" className={FRONT} />
      <path d="M8 14.5c0 1.6 3.1 2.6 7 2.6s7-1 7-2.6" className="stroke-(--duo-back)" strokeWidth="1.6" />
      <ellipse cx="15" cy="11" rx="7" ry="2.4" className={FRONT_ALT} />
    </Svg>
  );
}

export function DuoCalculator(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="13" height="13" rx="3" className={BACK} />
      <rect x="8" y="8" width="14" height="14" rx="3" className={FRONT} />
      <rect x="10.5" y="10.5" width="9" height="3" rx="1" className={BACK} />
      <circle cx="12" cy="17" r="1.1" className={BACK} />
      <circle cx="15" cy="17" r="1.1" className={BACK} />
      <circle cx="18" cy="17" r="1.1" className={BACK} />
      <circle cx="12" cy="19.6" r="1.1" className={BACK} />
      <circle cx="15" cy="19.6" r="1.1" className={BACK} />
      <circle cx="18" cy="19.6" r="1.1" className={BACK} />
    </Svg>
  );
}

export function DuoTable(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="14" height="10" rx="2.5" className={BACK} />
      <rect x="7" y="8" width="15" height="13" rx="3" className={FRONT} />
      <rect x="7" y="12" width="15" height="1.6" className={BACK} />
      <rect x="7" y="16.2" width="15" height="1.6" className={BACK} />
      <rect x="13.6" y="8" width="1.6" height="13" className={BACK} />
    </Svg>
  );
}

export function DuoSigma(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="14" height="14" rx="3.5" className={BACK} />
      <rect x="8" y="8" width="14" height="14" rx="3.5" className={FRONT} />
      <path d="M17.6 11.2H11.4v1.6l2.9 2.7-2.9 2.7V19.8h6.2v-1.5h-3.7l2.4-2.2-2.4-2.2h3.7Z" className={BACK} />
    </Svg>
  );
}

export function DuoCompare(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="10" height="14" rx="2.5" className={BACK} />
      <rect x="10" y="7" width="12" height="14" rx="3" className={FRONT} />
      <rect x="13" y="14.5" width="2" height="3.5" rx="1" className={BACK} />
      <rect x="16.5" y="11" width="2" height="7" rx="1" className={BACK} />
      <rect x="5" y="9" width="2" height="4.5" rx="1" className={FRONT} />
    </Svg>
  );
}

export function DuoLightbulb(props: DuoProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="10" r="8" className={BACK} />
      <rect x="8" y="14.5" width="9" height="7.5" rx="2.5" className={FRONT} />
      <rect x="10" y="17" width="5" height="1.6" rx="0.8" className={BACK} />
      <rect x="10.8" y="19.6" width="3.4" height="1.4" rx="0.7" className={BACK} />
    </Svg>
  );
}

export function DuoSettings(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="15" height="15" rx="5" className={BACK} />
      <circle cx="15.5" cy="15.5" r="6.5" className={FRONT} />
      <circle cx="15.5" cy="15.5" r="2.3" className={BACK} />
    </Svg>
  );
}

export function DuoPreferences(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="4.5" width="20" height="3.4" rx="1.7" className={BACK} />
      <rect x="2" y="15.5" width="20" height="3.4" rx="1.7" className={BACK} />
      <circle cx="8" cy="6.2" r="3.6" className={FRONT} />
      <circle cx="16" cy="17.2" r="3.6" className={FRONT} />
    </Svg>
  );
}

export function DuoBuilding(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="18" rx="2.5" className={BACK} />
      <rect x="10" y="9" width="12" height="12.5" rx="3" className={FRONT} />
      <rect x="13" y="12" width="2" height="2" rx="0.6" className={BACK} />
      <rect x="17" y="12" width="2" height="2" rx="0.6" className={BACK} />
      <rect x="13" y="16" width="2" height="2" rx="0.6" className={BACK} />
      <rect x="17" y="16" width="2" height="2" rx="0.6" className={BACK} />
    </Svg>
  );
}

export function DuoGrid(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="9" height="9" rx="2.5" className={BACK} />
      <rect x="13" y="2" width="9" height="9" rx="2.5" className={FRONT} />
      <rect x="2" y="13" width="9" height="9" rx="2.5" className={FRONT} />
      <rect x="13" y="13" width="9" height="9" rx="2.5" className={BACK} />
    </Svg>
  );
}

export function DuoHelp(props: DuoProps) {
  return (
    <Svg {...props}>
      <path d="M9 2.5a7 7 0 0 1 5.8 10.9L16 16.5l-3.4-1.2A7 7 0 1 1 9 2.5Z" className={BACK} />
      <circle cx="15.5" cy="15.5" r="6.5" className={FRONT} />
      <path d="M13.6 13.7a1.9 1.9 0 1 1 2.7 1.7c-.5.3-.8.6-.8 1.2v.2" className="stroke-(--duo-back)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15.5" cy="19" r="1" className={BACK} />
    </Svg>
  );
}

export function DuoInfo(props: DuoProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="8" className={BACK} />
      <circle cx="15.5" cy="15.5" r="6.5" className={FRONT} />
      <circle cx="15.5" cy="12.4" r="1.1" className={BACK} />
      <rect x="14.6" y="14.4" width="1.8" height="5" rx="0.9" className={BACK} />
    </Svg>
  );
}

export function DuoLogOut(props: DuoProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="11" height="18" rx="2.5" className={BACK} />
      <path d="M10 10h6V6.2c0-.7.8-1 1.3-.6l5.2 5.4c.4.4.4 1.2 0 1.6l-5.2 5.4c-.5.5-1.3.1-1.3-.6V14h-6Z" className={FRONT} />
    </Svg>
  );
}
