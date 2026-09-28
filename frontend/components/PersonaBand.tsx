import Image from "next/image";
import Link from "next/link";

export default function PersonaBand() {
  return (
    <section className="relative py-20 sm:py-28 bg-white overflow-hidden">
      <div className="max-w-[1260px] mx-auto px-6 sm:px-8">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Product Images */}
          <div className="flex-1 flex justify-center items-center gap-4 sm:gap-8 flex-wrap sm:flex-nowrap">
            <div className="relative w-[180px] sm:w-[240px] lg:w-[280px] h-[180px] sm:h-[240px] lg:h-[280px] drop-shadow-lg">
              <Image
                src="/products/seal-1.png"
                alt="Persona Band - Brown"
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="relative w-[180px] sm:w-[240px] lg:w-[280px] h-[180px] sm:h-[240px] lg:h-[280px] drop-shadow-lg">
              <Image
                src="/products/seal-3.png"
                alt="Persona Band - White"
                fill
                className="object-contain"
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
              className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-white rounded-full text-base font-semibold hover:bg-ink/90 transition-colors"
            >
              Learn more
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
