# Persona Landing Page

A high-fidelity recreation of the [Persona](https://yourpersona.com/) landing page, built with Next.js, TypeScript, and Tailwind CSS for a trial assignment.

## Overview

This landing page serves as the front door for the Persona onboarding experience. It showcases:
- Persona AI assistant (iMessage-based chat)
- Persona Band (wearable AI device)
- Privacy and security features
- Company information and CTAs

## Tech Stack

- **Next.js 16** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **next/image** for optimized images
- **next/font** for Inter font family

## Structure

```
frontend/
├── app/
│   ├── layout.tsx          # Root layout with Inter font
│   ├── page.tsx            # Home page (landing)
│   ├── globals.css         # Global styles and custom animations
│   └── onboarding/
│       └── page.tsx        # Placeholder onboarding page
├── components/
│   ├── Header.tsx          # Fixed header with logo and menu
│   ├── Hero.tsx            # Hero section with iPhone mockup
│   ├── PersonaBand.tsx     # Product showcase section
│   ├── Privacy.tsx         # Security & privacy features
│   └── Footer.tsx          # Footer with links and info
└── public/
    ├── brand/              # Brand assets (iPhone, keyboard SVGs)
    ├── certs/              # Security certification badges
    ├── hero/               # Hero section assets (iMessage UI)
    ├── products/           # Product images (Persona Band)
    └── *.svg, *.png        # Icons and favicons
```

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the landing page.

## Building for Production

```bash
npm run build
npm start
```

## Deployment

This app is configured to deploy on Vercel:
1. Set the **Root Directory** to `frontend` in Vercel project settings
2. Connect your GitHub repository
3. Deploy

Alternatively, use the Vercel CLI:
```bash
cd frontend
vercel --prod
```

## Assets & Licensing

### Downloaded Assets
All visual assets (logos, images, icons, SVGs) were downloaded from the live https://yourpersona.com/ site for this demo recreation. These assets belong to Persona and are used here solely for the purpose of demonstrating design fidelity in a trial assignment.

### Fonts
- **Inter**: Open-source Google Font (SIL Open Font License 1.1), loaded via `next/font/google`
- **Apple System Fonts**: SF Pro Display and SF Pro Text are referenced as fallbacks in the font stack. These are system fonts on Apple devices.
  - **Licensing note**: SF Pro is a commercial font licensed by Apple. For production use outside of Apple platforms, either ensure proper licensing or replace with an open alternative (e.g., Inter, -apple-system, or BlinkMacSystemFont for native rendering).

### Open Font Alternatives
If SF Pro cannot be licensed for production:
- **Inter** (already included) is a high-quality open alternative
- **System UI fonts** (`-apple-system`, `BlinkMacSystemFont`) render natively on each platform
- The current font stack gracefully falls back to system fonts

## Design Notes

### What Was Matched
- Overall layout and section structure
- Typography hierarchy (headings, body text)
- Color palette (ink, step colors, mint green accent)
- Responsive behavior (mobile and desktop)
- Component organization (Header, Hero, Product, Privacy, Footer)
- Security badges and certifications display
- CTA buttons and navigation links

### Known Visual Differences
Due to time and asset constraints, the following differ from the original:
1. **Hero background**: Original has a high-resolution blurred nature photo; recreation uses a simplified gradient with the product photo
2. **Animations**: Original includes marquee scrolls, floating elements, and typing effects; recreation has basic transitions
3. **iPhone UI details**: Original shows detailed iMessage bubbles with text and keyboard; recreation uses the SVG provided but may lack some detail
4. **Product photography lighting**: Original has professional studio lighting and shadows; recreation uses the provided PNGs
5. **Micro-interactions**: Original has hover states, glow effects, and animated orbs; recreation has simpler hover transitions
6. **3D effects**: Original may have depth and parallax; recreation is flat

### Future Enhancements
- Add smooth scroll animations and parallax effects
- Implement typing animation in the iPhone mockup
- Add marquee sections if present in the original
- Enhance hover states and micro-interactions
- Add animated gradient backgrounds

## Next Steps

The `/onboarding` route is currently a placeholder. The next phase will implement:
- iMessage-style text thread UI
- Simulated voice call interface
- Gmail OAuth integration
- Session state management

## License

This is a trial assignment demo. All Persona brand assets and intellectual property belong to Persona (yourpersona.com).
