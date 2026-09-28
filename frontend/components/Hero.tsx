import Image from "next/image";
import Link from "next/link";
import TypingAnimation from "./TypingAnimation";

export default function Hero() {
  return (
    <section className="relative min-h-screen pt-20 sm:pt-28 pb-20 sm:pb-32 overflow-hidden">
      {/* Background with blurred nature photo */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-[#f8fbff] to-[#eef5fe]" />
        <div className="absolute inset-0 opacity-40">
          <Image
            src="/backgrounds/hero-bg.webp"
            alt=""
            fill
            className="object-cover blur-[100px] scale-150"
            priority
            quality={90}
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
            <div className="relative aspect-[9/19]" style={{ filter: "drop-shadow(0 25px 50px rgba(0,0,0,0.15))" }}>
              {/* iPhone Frame */}
              <Image
                src="/brand/iphone-17-pro-silver.svg"
                alt="iPhone"
                fill
                className="object-contain relative z-10"
                priority
              />
              
              {/* iPhone Screen Content */}
              <div className="absolute inset-[3.8%] top-[4%] bottom-[4%] overflow-hidden rounded-[36px] sm:rounded-[44px] bg-white">
                {/* Status Bar */}
                <div className="absolute top-0 left-0 right-0 h-12 bg-white z-20 flex items-center justify-between px-6 text-xs font-semibold">
                  <span>9:41</span>
                  <div className="flex gap-1 items-center">
                    <div className="w-4 h-3 border border-black rounded-sm" />
                    <div className="w-4 h-3 border border-black rounded-sm" />
                    <div className="w-4 h-3 border border-black rounded-sm" />
                  </div>
                </div>

                {/* iMessage Header */}
                <div className="absolute top-12 left-0 right-0 h-11 bg-[#f6f6f6] border-b border-black/10 flex items-center justify-center">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00D856] to-[#00C851] flex items-center justify-center">
                      <span className="text-white text-sm font-bold">P</span>
                    </div>
                    <span className="text-sm font-semibold">Persona</span>
                  </div>
                </div>

                {/* Chat Area */}
                <div className="absolute top-[92px] left-0 right-0 bottom-[52px] overflow-hidden bg-white px-4 py-3">
                  <div className="space-y-3">
                    {/* Previous messages (gray bubbles) */}
                    <div className="flex justify-start">
                      <div className="bg-[#e9e9eb] text-black px-4 py-2 rounded-[18px] max-w-[75%] text-sm">
                        Hey! How can I help?
                      </div>
                    </div>

                    {/* User message (blue bubble with typing) */}
                    <div className="flex justify-end">
                      <div className="bg-[#007AFF] text-white px-4 py-2 rounded-[18px] max-w-[75%] text-sm">
                        <TypingAnimation />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Keyboard */}
                <div className="absolute bottom-0 left-0 right-0 h-[52px]">
                  <Image
                    src="/brand/ios/keyboard.svg"
                    alt=""
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Link
              href="/onboarding"
              className="relative group inline-flex items-center gap-2 px-8 py-4 bg-[#00D8A5] text-white rounded-full text-lg font-semibold transition-all shadow-lg hover:shadow-2xl hover:scale-[1.03] active:scale-[0.98] overflow-hidden"
            >
              {/* Animated glow orb */}
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-white/30 rounded-full blur-xl animate-glow" />
              </span>
              
              {/* Shimmer effect */}
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="absolute inset-[-100%] bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_ease-in-out]" />
              </span>
              
              <span className="relative z-10">Get Started</span>
              <svg
                className="relative z-10"
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
              className="text-[#0a84ff] text-base font-medium hover:underline transition-all hover:text-[#0051D5]"
            >
              Log in to the dashboard
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
