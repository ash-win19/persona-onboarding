import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="relative py-16 sm:py-20 bg-ink text-white">
      <div className="max-w-[1260px] mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr_1fr_auto] gap-12 lg:gap-16 mb-12">
          {/* Left Column - Main CTA */}
          <div>
            <div className="mb-6">
              <Image
                src="/icon.svg"
                alt="Persona"
                width={40}
                height={40}
                className="mb-4 invert"
              />
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold mb-3">
              Create your Persona today.
            </h3>
            <p className="text-base sm:text-lg text-white/70 mb-6 max-w-[360px]">
              First AI assistant you can wear. Made to get it done.
            </p>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#00AA7A] text-white rounded-full text-base font-semibold hover:bg-[#009668] transition-colors mb-8"
            >
              Start on iMessage
            </Link>

            {/* Social Links */}
            <div className="flex items-center gap-4 mb-8">
              <a
                href="mailto:hello@yourpersona.com"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Email"
              >
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="m2 5 8 5 8-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <a
                href="https://twitter.com/yourpersona"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Twitter"
              >
                <svg
                  width="18"
                  height="18"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M13.5 2h2.5l-5.5 6.3L16 16h-5l-4-5.2L2.5 16H0l5.9-6.7L0 2h5.2l3.6 4.8L13.5 2zm-.9 12.5h1.4L5 3.5H3.5l9.1 11z" />
                </svg>
              </a>
              <a
                href="https://instagram.com/yourpersona"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Instagram"
              >
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    x="2"
                    y="2"
                    width="16"
                    height="16"
                    rx="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="10"
                    cy="10"
                    r="3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle cx="15" cy="5" r="1" fill="currentColor" />
                </svg>
              </a>
            </div>

            <div className="text-sm text-white/50">
              <p className="mb-1">© 2026 Persona. All rights reserved.</p>
              <p>Made in Miami, USA</p>
            </div>
          </div>

          {/* Product Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white/70 mb-4">
              Product
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/onboarding"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  Persona App
                </Link>
              </li>
              <li>
                <Link
                  href="/onboarding"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  Persona Band
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white/70 mb-4">
              Resources
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/onboarding"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/onboarding"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  Terms
                </Link>
              </li>
              <li>
                <Link
                  href="/onboarding"
                  className="text-white/80 hover:text-white transition-colors"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Security Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white/70 mb-4">
              Security & Privacy
            </h4>
            <div className="flex flex-col gap-4 mb-4">
              <Image
                src="/certs/soc2.png"
                alt="SOC 2"
                width={48}
                height={48}
                className="w-12 h-12"
              />
              <Image
                src="/certs/aes-256.svg"
                alt="AES-256"
                width={48}
                height={48}
                className="w-12 h-12 invert"
              />
            </div>
            <p className="text-sm text-white/70 mb-4 max-w-[240px]">
              Encrypted at rest and in transit. Your data stays yours.
            </p>
            <Link
              href="/onboarding"
              className="text-sm text-white/80 hover:text-white transition-colors underline"
            >
              Report a Security Issue
            </Link>
          </div>
        </div>

        {/* Bottom Watermark */}
        <div className="text-center pt-8 border-t border-white/10">
          <p className="text-6xl sm:text-8xl font-bold text-white/5 tracking-tight">
            Persona
          </p>
        </div>
      </div>
    </footer>
  );
}
