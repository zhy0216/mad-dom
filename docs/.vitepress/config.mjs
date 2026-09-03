export default {
  title: 'MAD DOM',
  description: 'A native DOM for Bun, written in Rust. A drop-in replacement for happy-dom.',
  base: '/mad-dom/',
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Compatibility', link: '/compat-report' },
      { text: 'Release', link: '/release' },
      { text: 'Stable gate', link: '/stable-gate-report' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Quick start', link: '/quick-start' },
        ],
      },
      {
        text: 'Reports',
        items: [
          { text: 'Compatibility report', link: '/compat-report' },
          { text: 'Stable gate report', link: '/stable-gate-report' },
          { text: 'Release manual', link: '/release' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhy0216/mad-dom' },
    ],
  },
}
