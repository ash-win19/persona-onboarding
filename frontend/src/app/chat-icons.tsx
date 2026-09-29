import type { SVGProps } from "react";

const paths = {
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
