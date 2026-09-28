import Link from "next/link";
import Image from "next/image";

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#f8fbff] to-[#eef5fe] flex flex-col items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mb-8">
          <Image
            src="/icon.svg"
            alt="Persona"
            width={80}
            height={80}
            className="mx-auto"
          />
        </div>
        <h1 className="text-4xl font-bold text-ink mb-4">
          Onboarding Coming Soon
        </h1>
        <p className="text-lg text-ink-soft mb-8">
          The conversational onboarding experience will be available here soon.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-white rounded-full text-base font-semibold hover:bg-ink/90 transition-colors"
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
