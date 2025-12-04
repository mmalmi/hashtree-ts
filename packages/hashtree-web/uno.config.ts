import { defineConfig, presetUno, presetIcons } from 'unocss';
import presetTypography from '@unocss/preset-typography';

export default defineConfig({
  safelist: ['animate-pulse-live', 'animate-pulse-bg'],
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
    presetTypography({
      cssExtend: {
        'p,li,td,th': {
          color: '#c9d1d9',
        },
        'h1,h2,h3,h4,h5,h6': {
          color: '#c9d1d9',
        },
        'a': {
          color: '#58a6ff',
        },
        'code': {
          color: '#c9d1d9',
          background: '#21262d',
          padding: '0.2em 0.4em',
          'border-radius': '4px',
        },
        'pre': {
          background: '#161b22',
          'border-radius': '6px',
        },
        'pre code': {
          background: 'transparent',
          padding: '0',
        },
        'blockquote': {
          'border-left-color': '#30363d',
          color: '#8b949e',
        },
        'hr': {
          'border-color': '#30363d',
        },
        'table': {
          'border-color': '#30363d',
        },
        'th,td': {
          'border-color': '#30363d',
        },
        'strong': {
          color: '#c9d1d9',
        },
      },
    }),
  ],
  theme: {
    colors: {
      // GitHub dark theme colors
      surface: {
        0: '#0d1117',
        1: '#161b22',
        2: '#21262d',
        3: '#30363d',
      },
      text: {
        1: '#c9d1d9',
        2: '#8b949e',
        3: '#484f58',
      },
      accent: '#58a6ff',
      success: '#238636',
      danger: '#f85149',
      warning: '#d29922',
    },
    borderRadius: {
      DEFAULT: '6px',
      sm: '4px',
      lg: '8px',
    },
  },
  shortcuts: {
    // Layout
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',

    // Card/Panel
    'card': 'bg-surface-1 rounded overflow-hidden',
    'card-header': 'p-3 border-b border-surface-3 flex-between',

    // Buttons
    'btn': 'px-3 py-1.5 rounded-sm cursor-pointer border-none text-sm',
    'btn-primary': 'btn bg-accent text-white hover:bg-accent/90',
    'btn-success': 'btn bg-success text-white hover:bg-success/90',
    'btn-danger': 'btn bg-danger text-white hover:bg-danger/90',
    'btn-ghost': 'btn bg-surface-2 border border-surface-3 text-text-1 hover:bg-surface-3',

    // Form
    'input': 'px-3 py-2 bg-surface-0 border border-surface-3 rounded text-text-1 outline-none focus:border-accent',

    // Text
    'text-muted': 'text-text-2',
    'text-subtle': 'text-text-3',

    // Live indicator
    'badge-live': 'bg-danger text-white text-xs px-1.5 py-0.5 rounded-sm font-semibold animate-pulse',

    // Pulse animation for recently changed files
    'animate-pulse-live': 'animate-pulse-bg',
  },
  rules: [
    // Custom pulse animation for file rows - gentle background glow
    ['animate-pulse-bg', {
      animation: 'pulse-bg 3s ease-in-out infinite',
    }],
    // Hide scrollbar while keeping scroll functionality
    ['scrollbar-hide', {
      '-ms-overflow-style': 'none',
      'scrollbar-width': 'none',
    }],
  ],
  preflights: [
    {
      getCSS: () => `
        @keyframes pulse-bg {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(88, 166, 255, 0.08); }
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `,
    },
  ],
});
