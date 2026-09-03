export default {
  title: 'MAD DOM',
  description: 'A native DOM for Bun, written in Rust. A drop-in replacement for happy-dom.',
  base: '/mad-dom/',
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Examples', link: '/examples' },
      { text: 'Performance', link: '/performance' },
      { text: 'Compatibility', link: '/compat-report' },
      { text: 'Platforms', link: '/platforms' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Quick start', link: '/quick-start' },
          { text: 'Examples', link: '/examples' },
          { text: 'Performance', link: '/performance' },
          { text: 'Compatibility report', link: '/compat-report' },
          { text: 'Platforms', link: '/platforms' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhy0216/mad-dom' },
    ],
  },
}
