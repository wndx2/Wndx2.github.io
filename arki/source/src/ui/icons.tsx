import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="5" width="15" height="10" rx="2.5" />
    <path d="M5.5 8.25h.01M8.5 8.25h.01M11.5 8.25h.01M14.5 8.25h.01M5.5 11.75h.01M14.5 11.75h.01M8 11.75h4" />
  </Icon>
);

// Arrows out from the centre: move in any direction.
export const MoveIcon = () => (
  <Icon>
    <path d="M10 3v14M3 10h14M7.75 5.25 10 3l2.25 2.25M7.75 14.75 10 17l2.25-2.25M5.25 7.75 3 10l2.25 2.25M14.75 7.75 17 10l-2.25 2.25" />
  </Icon>
);

export const TagIcon = () => (
  <Icon>
    <path d="M3.5 4.75v4.4a1.5 1.5 0 0 0 .44 1.06l6.1 6.1a1.5 1.5 0 0 0 2.12 0l4.15-4.15a1.5 1.5 0 0 0 0-2.12l-6.1-6.1a1.5 1.5 0 0 0-1.06-.44h-4.4A1.25 1.25 0 0 0 3.5 4.75Z" />
    <path d="M7 7h.01" />
  </Icon>
);

export const TableIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2.5" />
    <path d="M3 8h14M3 12h14M9 4v12" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M4.9 15.1l1.05-1.05M14.05 5.95l1.05-1.05" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M16 11.6A6.5 6.5 0 0 1 8.4 4a6.5 6.5 0 1 0 7.6 7.6z" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M4.5 10h11" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M7 4.75v10.5L15.5 10 7 4.75Z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M7 5v10M13 5v10" strokeWidth="2.4" />
  </Icon>
);

// Two tracks with a knob on each: settings that are a matter of degree.
export const TuneIcon = () => (
  <Icon>
    <path d="M3.5 6.5h5M12.5 6.5h4M3.5 13.5h3M10.5 13.5h6" />
    <circle cx="10.5" cy="6.5" r="2" />
    <circle cx="8.5" cy="13.5" r="2" />
  </Icon>
);

// f(x), set as maths: an expression.
export const FunctionIcon = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <text
      x="10"
      y="14"
      textAnchor="middle"
      fill="currentColor"
      fontFamily="'KaTeX_Math', 'Times New Roman', serif"
      fontStyle="italic"
      fontSize="11.5"
      letterSpacing="-0.3"
    >
      f(x)
    </text>
  </svg>
);

export const FolderIcon = () => (
  <Icon>
    <path d="M2.75 6.25A1.75 1.75 0 0 1 4.5 4.5h3.1c.46 0 .9.18 1.24.51l.9.9c.33.33.78.51 1.24.51h4.52a1.75 1.75 0 0 1 1.75 1.75v5.58a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75v-7.5Z" />
  </Icon>
);

// Points right; turned to point down when what it belongs to is open.
export const ChevronIcon = () => (
  <Icon>
    <path d="M7.75 5.5 12.25 10l-4.5 4.5" />
  </Icon>
);

export const EyeIcon = () => (
  <Icon>
    <path d="M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5Z" />
    <circle cx="10" cy="10" r="2.25" />
  </Icon>
);

export const EyeOffIcon = () => (
  <Icon>
    <path d="M4.6 6.9C3.2 8.2 2.5 10 2.5 10s2.75 5 7.5 5c1.1 0 2.1-.27 3-.68M8 5.3A6.9 6.9 0 0 1 10 5c4.75 0 7.5 5 7.5 5s-.56 1.02-1.6 2.1M3.5 3.5l13 13" />
  </Icon>
);

// One sheet over another: a copy.
export const CopyIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2.25" />
    <path d="M4.75 13H4.5A1.75 1.75 0 0 1 2.75 11.25V5.25A1.75 1.75 0 0 1 4.5 3.5h6A1.75 1.75 0 0 1 12.25 5.25v.25" />
  </Icon>
);

export const WrenchIcon = () => (
  <Icon>
    <path d="M12.6 3.1a4.1 4.1 0 0 0-4.9 5.3l-4.3 4.3a1.75 1.75 0 0 0 2.47 2.47l4.3-4.3a4.1 4.1 0 0 0 5.3-4.9l-2.4 2.4-2.1-.6-.6-2.1 2.4-2.4Z" />
  </Icon>
);

// Lines of writing: a note.
export const NoteIcon = () => (
  <Icon>
    <path d="M4.5 6h11M4.5 10h11M4.5 14h6.5" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="10" r="1.1" fill="currentColor" />
    <circle cx="10" cy="10" r="1.1" fill="currentColor" />
    <circle cx="15" cy="10" r="1.1" fill="currentColor" />
  </Icon>
);

export const HomeIcon = () => (
  <Icon>
    <path d="M3.5 9.5L10 4l6.5 5.5M5.5 8.5V16h9V8.5" />
  </Icon>
);

export const SidebarIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="3" />
    <path d="M8 4v12" />
  </Icon>
);

export const WarningIcon = () => (
  <Icon>
    <path d="M10 3.5l7 12.5H3L10 3.5zM10 8.5v3.5" />
    <circle cx="10" cy="14" r="0.4" fill="currentColor" />
  </Icon>
);

// Two links of a chain: a link to share.
export const LinkIcon = () => (
  <Icon>
    <path d="M8.5 11.5a3.25 3.25 0 0 0 4.6 0l2.65-2.65a3.25 3.25 0 0 0-4.6-4.6L10.1 5.3" />
    <path d="M11.5 8.5a3.25 3.25 0 0 0-4.6 0L4.25 11.15a3.25 3.25 0 0 0 4.6 4.6L9.9 14.7" />
  </Icon>
);

// A framed picture: a copy of the graph as an image.
export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2.25" />
    <circle cx="7.5" cy="8.25" r="1.25" />
    <path d="M3.5 14.5l4-4 3 3 2-2 4 4" />
  </Icon>
);

// d/dx, for a derivative.
export const DerivativeIcon = () => (
  <Icon>
    <text x="10" y="13.5" textAnchor="middle" fontSize="8.5" fontStyle="italic" fill="currentColor" stroke="none">
      d/dx
    </text>
  </Icon>
);

// An integral sign, for an antiderivative.
export const IntegralIcon = () => (
  <Icon>
    <path d="M13 4.2c-.5-.6-1.2-.8-1.9-.5-.8.4-1 1.3-1.1 2.2l-.6 8.4c-.1.9-.3 1.8-1.1 2.2-.7.3-1.4.1-1.9-.5" />
  </Icon>
);

// A curved arrow back, and forward.
export const UndoIcon = () => (
  <Icon>
    <path d="M7.5 6.5 4.5 9.5l3 3" />
    <path d="M4.75 9.5h7.25a3.75 3.75 0 0 1 0 7.5H10" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m12.5 6.5 3 3-3 3" />
    <path d="M15.25 9.5H8a3.75 3.75 0 0 0 0 7.5h2" />
  </Icon>
);

// A question mark in a circle: help.
export const HelpIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M8.1 8.1a2 2 0 0 1 3.85.65c0 1.35-1.95 1.75-1.95 3" />
    <path d="M10 14.25h.01" />
  </Icon>
);
