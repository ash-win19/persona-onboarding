import { Experience } from "../experience";
export default function ExperienceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Experience />
      {children}
    </>
  );
}
