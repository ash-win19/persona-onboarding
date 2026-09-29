import type { SVGProps } from "react";

const paths = {
  arrowUp: "m6 12 6-6 6 6M12 6v12",
  arrowDown: "m6 12 6 6 6-6M12 6v12",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  mail: "M4 5h16v14H4zM4 6l8 6 8-6",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  headphones: "M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v7h4v-7zm16 0h1v7h-4v-7z",
  stop: "M7 7h10v10H7z",
  check: "m5 12 4 4L19 6",
  memory: "M9 3H5v4m10-4h4v4M5 17v4h4m10-4v4h-4M9 8h6M9 12h6M9 16h3",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
  briefcase: "M8 6V3h8v3M3 6h18v14H3zM3 11a20 20 0 0 0 18 0M12 11v3",
  idea: "M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2",
  calendar: "M4 5h16v16H4zM8 2v6m8-6v6M4 11h16M8 15h2m4 0h2",
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

export function PersonaMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16 3c3.4 0 5.1 6.3 5.1 7.9C22.7 10.9 29 12.6 29 16s-6.3 5.1-7.9 5.1c0 1.6-1.7 7.9-5.1 7.9s-5.1-6.3-5.1-7.9C9.3 21.1 3 19.4 3 16s6.3-5.1 7.9-5.1C10.9 9.3 12.6 3 16 3Z" />
    </svg>
  );
}
