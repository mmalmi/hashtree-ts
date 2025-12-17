import { defineConfig, presetUno, presetIcons } from 'unocss';
import presetTypography from '@unocss/preset-typography';

export default defineConfig({
  safelist: [
    'animate-pulse-live',
    'animate-pulse-bg',
    'animate-fade-in',
    // YjsDocument toolbar icons
    'i-lucide-bold',
    'i-lucide-italic',
    'i-lucide-strikethrough',
    'i-lucide-code',
    'i-lucide-heading-1',
    'i-lucide-heading-2',
    'i-lucide-heading-3',
    'i-lucide-list',
    'i-lucide-list-ordered',
    'i-lucide-quote',
    'i-lucide-file-code',
    'i-lucide-minus',
    'i-lucide-undo',
    'i-lucide-redo',
    // CollaboratorsModal and QRScanner icons
    'i-lucide-qr-code',
    'i-lucide-search',
    'i-lucide-share',
    'i-lucide-users',
    'i-lucide-x',
    'i-lucide-user',
    // VisibilityIcon icons
    'i-lucide-globe',
    'i-lucide-link',
    'i-lucide-lock',
  ],
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
    'card-header': 'p-3 b-b-1 b-b-solid b-b-surface-3 flex-between',

    // Buttons
    'btn': 'px-3 py-1.5 rounded-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-accent text-white hover:bg-accent/90 disabled:hover:bg-accent',
    'btn-success': 'btn bg-success text-white hover:bg-success/90 disabled:hover:bg-success',
    'btn-danger': 'btn bg-danger text-white hover:bg-danger/90 disabled:hover:bg-danger',
    'btn-ghost': 'btn bg-surface-2 b-1 b-solid b-surface-3 text-text-1 hover:bg-surface-3 disabled:hover:bg-surface-2',

    // Form
    'input': 'px-3 py-2 bg-surface-0 b-1 b-solid b-surface-3 rounded text-text-1 outline-none focus:b-accent',

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
    // Fade-in animation for delayed loading indicator
    ['animate-fade-in', {
      animation: 'fade-in 0.3s ease-in',
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
        /* Reset button defaults */
        button {
          border: none;
          background: transparent;
          cursor: pointer;
          font: inherit;
          color: inherit;
        }
        @keyframes pulse-bg {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(88, 166, 255, 0.08); }
        }
        @keyframes fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `,
    },
  ],
});
