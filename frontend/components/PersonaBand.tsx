import Image from "next/image";
import Link from "next/link";

export default function PersonaBand() {
  return (
    <section className="relative py-20 sm:py-28 bg-white overflow-hidden">
      <div className="max-w-[1260px] mx-auto px-6 sm:px-8">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Product Images */}
          <div className="flex-1 flex justify-center items-center gap-4 sm:gap-8 flex-wrap sm:flex-nowrap">
            <div className="relative w-[180px] sm:w-[240px] lg:w-[280px] h-[180px] sm:h-[240px] lg:h-[280px] group">
              <div className="absolute inset-0 bg-gradient-to-br from-[#007AFF]/5 to-transparent rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <Image
                src="/products/seal-1.png"
                alt="Persona Band - Brown"
                fill
                className="object-contain drop-shadow-2xl transform transition-transform duration-500 group-hover:scale-105"
                priority
              />
            </div>
            <div className="relative w-[180px] sm:w-[240px] lg:w-[280px] h-[180px] sm:h-[240px] lg:h-[280px] group">
              <div className="absolute inset-0 bg-gradient-to-br from-[#007AFF]/5 to-transparent rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <Image
                src="/products/seal-3.png"
                alt="Persona Band - White"
                fill
                className="object-contain drop-shadow-2xl transform transition-transform duration-500 group-hover:scale-105"
                priority
              />
            </div>
          </div>

          {/* Text Content */}
          <div className="flex-1 text-center lg:text-left">
            <h2 className="text-[clamp(31px,4.6vw,60px)] leading-[1.15] font-bold tracking-[-0.022em] text-ink mb-4">
              Persona Band
            </h2>
            <p className="text-[clamp(19px,5.6vw,28px)] leading-[1.35] text-ink-soft mb-8">
              Personal intelligence, on your wrist.
            </p>
            <Link
              href="/onboarding"
              className="relative group inline-flex items-center gap-2 px-6 py-3 bg-ink text-white rounded-full text-base font-semibold transition-all hover:shadow-lg hover:scale-105 active:scale-95 overflow-hidden"
            >
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="absolute inset-[-100%] bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.5s_ease-in-out]" />
              </span>
              <span className="relative z-10">Learn more</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
