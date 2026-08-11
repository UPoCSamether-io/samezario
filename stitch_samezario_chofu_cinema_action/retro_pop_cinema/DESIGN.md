---
name: Retro Pop Cinema
colors:
  surface: '#f7faf9'
  surface-dim: '#d8dbda'
  surface-bright: '#f7faf9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f4f3'
  surface-container: '#eceeee'
  surface-container-high: '#e6e9e8'
  surface-container-highest: '#e0e3e2'
  on-surface: '#181c1c'
  on-surface-variant: '#3f4949'
  inverse-surface: '#2d3131'
  inverse-on-surface: '#eef1f1'
  outline: '#6f7979'
  outline-variant: '#bec9c8'
  surface-tint: '#0d696a'
  primary: '#006263'
  on-primary: '#ffffff'
  primary-container: '#2a7b7c'
  on-primary-container: '#c8ffff'
  inverse-primary: '#87d3d4'
  secondary: '#805600'
  on-secondary: '#ffffff'
  secondary-container: '#fdbe5b'
  on-secondary-container: '#734d00'
  tertiary: '#595753'
  on-tertiary: '#ffffff'
  tertiary-container: '#726f6b'
  on-tertiary-container: '#f8f3ee'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a3f0f0'
  primary-fixed-dim: '#87d3d4'
  on-primary-fixed: '#002020'
  on-primary-fixed-variant: '#004f50'
  secondary-fixed: '#ffddb0'
  secondary-fixed-dim: '#fabb59'
  on-secondary-fixed: '#291800'
  on-secondary-fixed-variant: '#614000'
  tertiary-fixed: '#e6e2dd'
  tertiary-fixed-dim: '#cac6c1'
  on-tertiary-fixed: '#1d1b19'
  on-tertiary-fixed-variant: '#484643'
  background: '#f7faf9'
  on-background: '#181c1c'
  surface-variant: '#e0e3e2'
typography:
  headline-xl:
    fontFamily: beVietnamPro
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: beVietnamPro
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: beVietnamPro
    fontSize: 28px
    fontWeight: '800'
    lineHeight: '1.2'
  body-lg:
    fontFamily: plusJakartaSans
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.6'
  body-md:
    fontFamily: plusJakartaSans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-bold:
    fontFamily: spaceGrotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: '1.0'
  display-numeral:
    fontFamily: spaceGrotesk
    fontSize: 56px
    fontWeight: '700'
    lineHeight: '1.0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-margin: 24px
  gutter: 16px
  film-sprocket-size: 12px
---

## Brand & Style

The design system is a vibrant fusion of mid-century cinema nostalgia and high-energy "Pop Brutalism." Designed for the game *Samezario*, it evokes the charm of a vintage movie theater in Chofu city, blending aquatic themes with the structured energy of film production. 

The aesthetic is defined by heavy, expressive strokes, "sticker-like" UI elements, and a tactile sense of play. It balances the professional structure of a movie set (clapperboards, film strips) with the inviting warmth of a retro diner. The emotional goal is to feel celebratory, nostalgic, and physically responsive, as if the user is interacting with a mechanical cinema display.

**Design Style: Retro-Brutalism**
- **Heavy Outlines:** All interactive elements feature thick #2D2D2D borders to ensure high contrast and a comic-book pop.
- **Graphic Motifs:** Frequent use of dot patterns (Ben-Day dots) for shadows and film-sprocket cutouts for containers.
- **Angular Energy:** Drawing from the Chofu map's geometric irregularity, shapes are bold and slightly off-kilter.

## Colors

The palette is rooted in a "Modern-Vintage" spectrum that reflects both the "Underwater" game setting and the "Cinema" theme.

- **Underwater Blue (#2A7B7C):** Used for primary actions, header backgrounds, and large thematic blocks.
- **Cinema Yellow (#F3B553):** Used for "Star" moments, highlights, call-to-action buttons, and warning states.
- **Retro White (#F4EFEA):** The primary canvas color, providing a warm, paper-like texture that reduces eye strain compared to pure white.
- **Jindaiji Navy (#213052):** Used for deep backgrounds, footer sections, and heavy shadow accents.
- **Clapperboard Black (#2D2D2D):** The structural ink. Used for all outlines, primary text, and iconic silhouettes.

## Typography

This design system uses a triple-font approach to manage hierarchy and tone:

1. **Titles & Headlines (Be Vietnam Pro):** Chosen for its heavy weights and friendly, rounded terminals that mimic the "Rounded M+" Japanese aesthetic. It feels cinematic and impactful.
2. **Body Text (Plus Jakarta Sans):** A soft, modern sans-serif that ensures readability across descriptions and game lore. Its optimistic curves match the "Pop" personality.
3. **Labels & UI Metadata (Space Grotesk):** A technical, geometric font used for "clapperboard" data, film reel lengths, and numbers. It provides a "production-ready" futuristic contrast to the retro fonts.

**Styling Rules:**
- Apply a 2px Clapperboard Black outline to Headline-XL when used on bright backgrounds.
- Use uppercase for all labels to mimic vintage signage.

## Layout & Spacing

The layout philosophy is a **Structured Fluid Grid** inspired by the frames of a 35mm film strip. 

- **The "Film Strip" Column:** Containers should use a 12-column grid. On desktop, side margins are fixed at 120px to focus action in the center "screen."
- **Breakpoints:** 
  - Mobile (<600px): 4 columns, 16px margins. 
  - Tablet (600-1024px): 8 columns, 24px margins.
  - Desktop (>1024px): 12 columns, fluid gutters.
- **Rhythm:** Spacing follows an 8px base unit. Component internal padding should favor "fat" margins (24px or 32px) to allow the heavy outlines room to breathe.

## Elevation & Depth

This system rejects soft, realistic shadows in favor of **Hard Graphic Shadows** and **Tonal Stacking**.

- **Hard Shadows:** Use a 4px or 8px offset shadow with 100% opacity in `Clapperboard Black` or `Jindaiji Navy`. This creates a "cut-out" look where elements feel physically stuck onto the UI.
- **Dot Dithering:** For mid-level elevation, use a Ben-Day dot pattern overlay instead of a blur.
- **The "Backlight" Effect:** For active states or "Neon" elements, use a 0-spread glow in `Cinema Yellow` to simulate a lightbox behind the UI element.

## Shapes

The shape language is "Geometric-Organic," taking cues from the Chofu city map provided. 

- **Primary Radius:** A consistent 0.5rem (8px) is used for standard buttons and cards.
- **The "Chofu Crop":** Occasionally, large containers or images should use irregular, slightly skewed corners (5-degree tilts) to reference the map's jagged, energetic perimeter.
- **Film Perforations:** Linear elements (dividers, progress bars) should feature repeating square cutouts on the top and bottom edges to mimic a film strip.

## Components

### Buttons (The Clapperboard)
- **Base:** Thick 3px black outline, solid `Cinema Yellow` fill.
- **Header:** A decorative "clapper" top bar with alternating diagonal black and white stripes.
- **State:** On press, the element shifts 4px down and right, hiding its hard shadow to simulate a physical click.

### Progress Bars (The Film Reel)
- **Track:** `Jindaiji Navy` with `Retro White` square "sprocket" holes along the edges.
- **Fill:** `Underwater Blue` solid fill. As it fills, a small "projector light" icon follows the leading edge.

### Input Fields
- **Style:** `Retro White` background with a 2px `Clapperboard Black` border. 
- **Focus:** Border thickens to 4px and shifts to `Underwater Blue`.

### Cards (The Lobby Card)
- **Construction:** Heavy `Clapperboard Black` border, `Retro White` content area, and a 8px hard shadow.
- **Header:** Title text is always set in `Headline-LG` with a slight tilt (2 degrees).

### Neon Signage (The Logo/Special Alerts)
- **Visuals:** Use a high-contrast combination of `Underwater Blue` and `Cinema Yellow` text with a thick outer stroke and a faint "inner glow" to mimic gas-discharge tubes.