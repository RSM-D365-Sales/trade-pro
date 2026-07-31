/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces & ink resolve from CSS custom properties (see index.css)
        // so light/dark swap in exactly one place.
        plane: 'var(--plane)',
        surface: 'var(--surface-1)',
        raised: 'var(--surface-2)',
        sunken: 'var(--surface-0)',
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        hairline: 'var(--hairline)',
        grid: 'var(--gridline)',
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
        },
        good: 'var(--status-good)',
        warning: 'var(--status-warning)',
        serious: 'var(--status-serious)',
        critical: 'var(--status-critical)',
        s1: 'var(--series-1)',
        s2: 'var(--series-2)',
        s3: 'var(--series-3)',
        s4: 'var(--series-4)',
        s5: 'var(--series-5)',
        s6: 'var(--series-6)',
        s7: 'var(--series-7)',
        s8: 'var(--series-8)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { xs: '3px' },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 1px rgba(11,11,11,0.03)',
        pop: '0 8px 28px -6px rgba(11,11,11,0.18), 0 2px 6px rgba(11,11,11,0.08)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
      },
    },
  },
  plugins: [],
}
