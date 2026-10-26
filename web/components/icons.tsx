import type { ReactNode } from "react";

// Line icons on a 24px grid, drawn in the text color.
type IconProps = { className?: string };

function Svg({ className = "size-5", filled, children }: IconProps & { filled?: boolean; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** The PodEcho mark: a sound wave. */
export const LogoMark = ({ className = "size-7" }: IconProps) => (
  <span className={`grid shrink-0 place-items-center rounded-[30%] bg-foreground text-background ${className}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 7.5v9M20 10.5v3" />
    </svg>
  </span>
);

export const IconShows = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="13" rx="3.5" />
    <path d="M10.5 8.6v4.8l4-2.4z" fill="currentColor" />
    <path d="M8.5 20.5h7" />
  </Svg>
);
export const IconCards = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7.5" width="13" height="13" rx="3" />
    <path d="M8 4h9a3.5 3.5 0 0 1 3.5 3.5V16" />
  </Svg>
);
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11.5" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);
export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 19V5.5A2.5 2.5 0 0 1 8 3h11v14H8a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 8 22h11" />
    <path d="M9.5 7.5h5.5" />
  </Svg>
);
export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 20v-6M12 20V5M19 20v-9M3 20h18" />
  </Svg>
);
const STAR = "M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z";
export const IconStar = (p: IconProps) => <Svg {...p}><path d={STAR} /></Svg>;
export const IconStarFilled = (p: IconProps) => <Svg {...p} filled><path d={STAR} /></Svg>;
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </Svg>
);
export const IconChevronLeft = (p: IconProps) => <Svg {...p}><path d="m14.5 18-6-6 6-6" /></Svg>;
export const IconChevronRight = (p: IconProps) => <Svg {...p}><path d="m9.5 18 6-6-6-6" /></Svg>;
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconArrowUp = (p: IconProps) => <Svg {...p}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></Svg>;
export const IconArrowRight = (p: IconProps) => <Svg {...p}><path d="M5 12h14M12.5 5.5 19 12l-6.5 6.5" /></Svg>;
export const IconPlay = (p: IconProps) => (
  <Svg {...p} filled>
    <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z" />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p} filled>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </Svg>
);
export const IconPrev = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66l-8.4-5.8a.8.8 0 0 1 0-1.32l8.4-5.8A.8.8 0 0 1 18 6.2z" fill="currentColor" stroke="none" />
    <path d="M6 5.5v13" strokeWidth={2.2} />
  </Svg>
);
export const IconNext = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.4-5.8a.8.8 0 0 0 0-1.32l-8.4-5.8A.8.8 0 0 0 6 6.2z" fill="currentColor" stroke="none" />
    <path d="M18 5.5v13" strokeWidth={2.2} />
  </Svg>
);
export const IconReplay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6" />
  </Svg>
);
export const IconStop = (p: IconProps) => (
  <Svg {...p} filled>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Svg>
);
export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const IconX = (p: IconProps) => <Svg {...p}><path d="M17.5 6.5l-11 11M6.5 6.5l11 11" /></Svg>;
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M10 11v5.5M14 11v5.5M6 7l.9 11.2A2 2 0 0 0 8.9 20h6.2a2 2 0 0 0 2-1.8L18 7M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
);
export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 5 6.5 8.5H4v7h2.5L11 19z" />
    <path d="M15 9a4 4 0 0 1 0 6M17.8 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
export const IconRepeat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 3.5 20 6.5l-3 3" />
    <path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5l-3-3 3-3" />
    <path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" />
  </Svg>
);
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16.5 14.5 12 10 7.5M14.5 12H4" />
  </Svg>
);
export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Svg>
);
