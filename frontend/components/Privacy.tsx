"use client";

import Image from "next/image";
import { useState } from "react";

const privacyFeatures = [
  {
    icon: "🛡️",
    title: "Independently audited",
    subtitle: "Checked by outside auditors",
    description:
      "Third-party security experts regularly review our systems to verify that your data is protected to the highest standards.",
  },
  {
    icon: "🔒",
    title: "Encrypted at rest",
    subtitle: "Sealed before it's stored",
    description:
      "Every message, document and recap is sealed with envelope encryption before it reaches our storage, and travels over TLS on the way. Each record gets its own key, and those keys are locked again with a master key kept apart from the data.",
  },
  {
    icon: "👁️‍🗨️",
    title: "Never sold, never traded",
    subtitle: "Not a product, not to anyone",
    description:
      "Your personal data is never sold to third parties or used for advertising. We make money by providing value to you, not by selling your information.",
  },
  {
    icon: "🗑️",
    title: "Yours to delete",
    subtitle: "Gone means gone",
    description:
      "You have complete control over your data. When you delete something, it's permanently removed from our systems—no backups, no archives.",
  },
];

export default function Privacy() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <section className="relative py-20 sm:py-28 bg-step-100">
      <div className="max-w-[1260px] mx-auto px-6 sm:px-8">
        {/* Section Header */}
        <h2 className="text-center text-[clamp(31px,4.6vw,60px)] leading-[1.15] font-bold tracking-[-0.022em] text-ink mb-6">
          The most personal AI
          <br />
          is the most private one.
        </h2>

        {/* Certification Badges */}
        <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-8 mb-12 sm:mb-16">
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/certs/soc2.png"
              alt="SOC 2 Type I certified"
              width={80}
              height={80}
              className="w-16 h-16 sm:w-20 sm:h-20"
            />
            <p className="text-xs sm:text-sm text-ink-soft text-center">
              SOC 2 Type I
              <br />
              certified
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/certs/aes-256.svg"
              alt="AES-256 Encrypted"
              width={80}
              height={80}
              className="w-16 h-16 sm:w-20 sm:h-20"
            />
            <p className="text-xs sm:text-sm text-ink-soft text-center">
              AES-256
              <br />
              Encrypted
            </p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Image
              src="/certs/esof.png"
              alt="ESOF verified and secured"
              width={80}
              height={80}
              className="w-16 h-16 sm:w-20 sm:h-20"
            />
            <p className="text-xs sm:text-sm text-ink-soft text-center">
              ESOF verified
              <br />
              and secured
            </p>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[980px] mx-auto">
          {privacyFeatures.map((feature, index) => (
            <div
              key={index}
              className="bg-white rounded-[28px] p-6 sm:p-8 shadow-sm border border-black/5 transition-all hover:shadow-md"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-4xl mb-2">{feature.icon}</div>
                  <h3 className="text-lg sm:text-xl font-semibold text-ink mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-ink-soft">{feature.subtitle}</p>
                </div>
                <button
                  onClick={() =>
                    setExpandedIndex(expandedIndex === index ? null : index)
                  }
                  className="flex-shrink-0 w-8 h-8 rounded-full bg-step-100 flex items-center justify-center text-ink hover:bg-step-200 transition-colors"
                  aria-label={
                    expandedIndex === index ? "Collapse" : "Expand"
                  }
                >
                  {expandedIndex === index ? "−" : "+"}
                </button>
              </div>
              {expandedIndex === index && (
                <p className="text-sm sm:text-base text-ink-soft leading-relaxed mt-4 animate-slide-up">
                  {feature.description}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
