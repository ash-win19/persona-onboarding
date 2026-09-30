import type { SVGProps } from "react";

const paths = {
  panel: "M3 4h18v16H3zM9 4v16",
  chevrons: "m9 8 3-3 3 3m-6 8 3 3 3-3",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  home: "m3 10 9-7 9 7v10H3zM9 20v-7h6v7",
  message: "M4 4h16v12H9l-5 4z",
  user: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  logout: "M9 4H4v16h5m6-13 5 5-5 5m-7-5h12",
  arrowUp: "m6 12 6-6 6 6M12 6v12",
  arrowDown: "m6 12 6 6 6-6M12 6v12",
  mail: "M4 5h16v14H4zM4 6l8 6 8-6",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  headphones: "M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v7h4v-7zm16 0h1v7h-4v-7z",
  stop: "M7 7h10v10H7z",
  check: "m5 12 4 4L19 6",
} as const;

export function ChatIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
