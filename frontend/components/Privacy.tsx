"use client";

import Image from "next/image";
import { useState } from "react";

const privacyFeatures = [
  {
    icon: (
      <svg className="w-10 h-10 text-[#007AFF]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Independently audited",
    subtitle: "Checked by outside auditors",
    description:
      "Third-party security experts regularly review our systems to verify that your data is protected to the highest standards.",
  },
  {
    icon: (
      <svg className="w-10 h-10 text-[#007AFF]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Encrypted at rest",
    subtitle: "Sealed before it's stored",
    description:
      "Every message, document and recap is sealed with envelope encryption before it reaches our storage, and travels over TLS on the way. Each record gets its own key, and those keys are locked again with a master key kept apart from the data.",
  },
  {
    icon: (
      <svg className="w-10 h-10 text-[#007AFF]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
        <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Never sold, never traded",
    subtitle: "Not a product, not to anyone",
    description:
      "Your personal data is never sold to third parties or used for advertising. We make money by providing value to you, not by selling your information.",
  },
  {
    icon: (
      <svg className="w-10 h-10 text-[#007AFF]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m3 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
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
              className="group bg-white rounded-[28px] p-6 sm:p-8 shadow-sm border border-black/5 transition-all duration-300 hover:shadow-lg hover:scale-[1.01] cursor-pointer relative overflow-hidden"
              onClick={() =>
                setExpandedIndex(expandedIndex === index ? null : index)
              }
            >
              {/* Hover glow effect */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-[#007AFF]/5 rounded-full blur-2xl" />
              </div>

              <div className="relative">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="mb-3 transform transition-transform group-hover:scale-110">
                      {feature.icon}
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold text-ink mb-1">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-ink-soft">{feature.subtitle}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedIndex(expandedIndex === index ? null : index);
                    }}
                    className="flex-shrink-0 w-9 h-9 rounded-full bg-step-100 flex items-center justify-center text-ink text-xl hover:bg-step-200 transition-all hover:scale-110 active:scale-95"
                    aria-label={
                      expandedIndex === index ? "Collapse" : "Expand"
                    }
                  >
                    {expandedIndex === index ? "−" : "+"}
                  </button>
                </div>
                {expandedIndex === index && (
                  <p className="text-sm sm:text-base text-ink-soft leading-relaxed mt-4 animate-fade-in">
                    {feature.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
