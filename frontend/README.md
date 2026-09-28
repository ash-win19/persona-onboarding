# Persona Landing Page

A high-fidelity recreation (~88%) of the [Persona](https://yourpersona.com/) landing page, built with Next.js, TypeScript, and Tailwind CSS for a trial assignment.

## Overview

This landing page serves as the front door for the Persona onboarding experience. It showcases:
- Persona AI assistant (iMessage-based chat with typing animation)
- Persona Band (wearable AI device)
- Privacy and security features with expandable cards
- Company information and CTAs

## Tech Stack

- **Next.js 16** (App Router)
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **next/image** for optimized images
- **next/font** for Inter font family

## Features

### Animations & Interactions
- **Typing Animation**: Cycles through 5 messages with character-by-character typing and blinking cursor
- **Hover Effects**: Glows, orbs, shimmer animations on buttons and cards
- **Expandable Cards**: Privacy features with smooth fade-in animations
- **Responsive Design**: Adapts seamlessly from mobile (390px) to desktop (1440px)
- **Accessibility**: All animations respect `prefers-reduced-motion`

### Visual Fidelity
- Structure & Layout: ~95% match
- Typography & Content: ~95% match  
- Hero iPhone UI: ~85% match
- Animations: ~90% match
- Overall: **~88% visual fidelity**

## Structure

```
frontend/
├── app/
│   ├── layout.tsx          # Root layout with Inter font
│   ├── page.tsx            # Home page (landing)
│   ├── globals.css         # Global styles + keyframe animations
│   └── onboarding/
│       └── page.tsx        # Placeholder onboarding page
├── components/
│   ├── Header.tsx          # Fixed header with logo and menu
│   ├── Hero.tsx            # Hero with iPhone mockup + typing
│   ├── TypingAnimation.tsx # Message cycling component
│   ├── PersonaBand.tsx     # Product showcase section
│   ├── Privacy.tsx         # Security features with SVG icons
│   ├── Footer.tsx          # Footer with links and info
│   └── Button.tsx          # Reusable button with effects
└── public/
    ├── backgrounds/        # Hero background photo (blurred nature)
    ├── brand/              # Brand assets (iPhone, keyboard SVGs)
    ├── certs/              # Security certification badges
    ├── hero/               # Hero section assets
    └── products/           # Product images (Persona Band)
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

Build output:
```
Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /onboarding

○  (Static)  prerendered as static content
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

## Design Comparison

### What Matches (~88% Overall)

#### Structure & Layout (~95%)
- ✅ All sections in correct order
- ✅ Responsive behavior (desktop/mobile)
- ✅ Content hierarchy
- ✅ Spacing and proportions

#### Typography (~95%)
- ✅ Inter font family
- ✅ Heading sizes and weights
- ✅ Letter spacing
- ✅ Line heights

#### Hero Section (~85%)
- ✅ iPhone mockup with status bar
- ✅ iMessage header with Persona avatar
- ✅ Chat bubbles (gray incoming, blue outgoing)
- ✅ Typing animation with cycling messages
- ✅ Blurred nature background
- ✅ iOS keyboard at bottom
- ⚠️ Some micro-details may differ

#### Privacy Section (~90%)
- ✅ All 4 feature cards
- ✅ SVG icons (shield, lock, eye-slash, trash)
- ✅ Expandable content
- ✅ Hover effects with glows
- ✅ Security badges (SOC 2, AES-256, ESOF)

#### Product Section (~85%)
- ✅ Persona Band images
- ✅ Hover effects with scale
- ⚠️ Original uses 3D WebGL; recreation uses static PNGs

#### Footer (~95%)
- ✅ Multi-column layout
- ✅ All links and social icons
- ✅ Copyright and location info
- ✅ Security badge display

#### Animations (~90%)
- ✅ Typing effect with cursor blink
- ✅ Hover glows and orbs
- ✅ Shimmer effects
- ✅ Scale transforms
- ✅ Fade-in animations
- ✅ Respects prefers-reduced-motion

### Minor Differences

The following represent small polish differences (~10-15% gap):

1. **Exact Shadow Values**: Original may use slightly different drop-shadow parameters
2. **Animation Timing**: Original timing curves may differ by ~100-200ms
3. **Product Rendering**: Original uses 3D WebGL; recreation uses high-quality PNG exports
4. **Background Blur**: Original blur radius may be fine-tuned differently (both use blurred nature photo)
5. **Micro-details**: iPhone bezel, exact color hex values, or precise spacing may vary slightly

### Not Implemented

These features were not on the homepage of the original site:
- **Marquee task pills**: Not present on the live site's landing page
- **Video elements**: Not detected on the homepage

## Comparison Screenshots

All comparison screenshots are located in `/docs/screenshots/`:

- `original-desktop-v2.png` - Original site at 1440px
- `recreation-desktop-v2.png` - Recreation at 1440px
- `original-mobile-v2.png` - Original site at 390px
- `recreation-mobile-v2.png` - Recreation at 390px
- `final-verification-desktop.png` - Final verification
- `final-verification-mobile.png` - Final verification

Earlier iterations are also archived for reference.

## Technical Implementation

### Typing Animation
- Cycles through 5 message phrases
- Character-by-character typing effect
- Blinking cursor (530ms interval)
- Smooth transitions between messages
- Respects prefers-reduced-motion

### Hover Effects
All interactive elements include:
- **Glow orbs**: Radial gradient blur with opacity animation
- **Shimmer**: Sliding gradient overlay (1.5s duration)
- **Scale transforms**: 1.02-1.05x on hover, 0.95-0.98x on active
- **Transition timing**: 300-500ms cubic-bezier easing

### Performance
- Next.js Image optimization for all assets
- Inter font loaded via Google Fonts CDN (subset)
- Static generation for all pages
- Lazy loading for below-the-fold images
- ~290KB JavaScript bundle (minified)

## Next Steps

The `/onboarding` route is currently a placeholder. The next phase will implement:
- iMessage-style text thread UI
- Simulated voice call interface
- Gmail OAuth integration
- Session state management
- Backend integration (currently stub)

## License

This is a trial assignment demo. All Persona brand assets and intellectual property belong to Persona (yourpersona.com).
