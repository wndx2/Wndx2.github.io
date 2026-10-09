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
