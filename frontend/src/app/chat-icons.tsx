import type { SVGProps } from "react";

const paths = {
  plus: "M12 5v14M5 12h14",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  band: "M8 7 9 2h6l1 5M8 17l1 5h6l1-5M7 7h10v10H7zM10 12h4",
  plug: "M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0zm5 8v5",
  settings:
    "M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",

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
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
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
