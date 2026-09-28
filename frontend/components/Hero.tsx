import Image from "next/image";
import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative min-h-screen pt-20 sm:pt-28 pb-20 sm:pb-32 overflow-hidden">
      {/* Background with blur effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-white via-[#f8fbff] to-[#eef5fe]">
        <div className="absolute inset-0 opacity-30">
          <Image
            src="/products/photo.webp"
            alt=""
            fill
            className="object-cover blur-3xl scale-110"
            priority
          />
        </div>
      </div>

      <div className="relative max-w-[1260px] mx-auto px-6 sm:px-8">
        <div className="flex flex-col items-center text-center">
          {/* Hero Heading */}
          <h1 className="text-[clamp(44px,13vw,80px)] leading-[1.05] font-bold tracking-[-0.025em] text-ink mb-8 sm:mb-12">
            Your personal
            <br />
            intelligence
          </h1>

          {/* iPhone Mockup with Messages */}
          <div className="relative w-full max-w-[400px] mx-auto mb-10 sm:mb-14">
            <div className="relative aspect-[9/19] drop-shadow-2xl">
              <Image
                src="/brand/iphone-17-pro-silver.svg"
                alt="iPhone with Persona"
                fill
                className="object-contain"
                priority
              />
              <div className="absolute inset-[3.5%] overflow-hidden rounded-[38px] sm:rounded-[48px]">
                <Image
                  src="/hero/imessage.svg"
                  alt="Persona conversation"
                  fill
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#00D8A5] text-white rounded-full text-lg font-semibold hover:bg-[#00C294] transition-all shadow-lg hover:shadow-xl hover:scale-105"
            >
              Get Started
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7.5 15L12.5 10L7.5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link
              href="/onboarding"
              className="text-[#0a84ff] text-base font-medium hover:underline"
            >
              Log in to the dashboard
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
