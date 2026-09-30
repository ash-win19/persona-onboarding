import { Suspense } from "react";
import { Experience } from "../experience";
export default function ExperienceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense>
        <Experience />
      </Suspense>
      {children}
    </>
  );
}
