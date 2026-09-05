export default {
  title: 'MAD DOM',
  description: 'A fast native DOM for Bun. Rust-powered HTML parsing, queries, and serialization with a happy-dom-style API.',
  lang: 'en-US',
  base: '/mad-dom/',
  themeConfig: {
    nav: [
      { text: 'Quick start', link: '/quick-start' },
      { text: 'Guides', link: '/testing' },
      { text: 'API', link: '/window' },
      { text: 'Performance', link: '/performance' },
      { text: 'Compatibility', link: '/compat-report' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Why MAD DOM', link: '/why-mad-dom' },
          { text: 'Quick start', link: '/quick-start' },
          { text: 'Migrate from happy-dom', link: '/migration' },
          { text: 'Platforms & troubleshooting', link: '/platforms' },
        ],
      },
      {
        text: 'Guides & API',
        items: [
          { text: 'Testing with Bun', link: '/testing' },
          { text: 'Window & GlobalWindow', link: '/window' },
          { text: 'DOM operations', link: '/dom' },
          { text: 'Templates & web components', link: '/web-components' },
          { text: 'Browser, pages & frames', link: '/browser' },
          { text: 'Async work & cleanup', link: '/async' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Examples & recipes', link: '/examples' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Performance', link: '/performance' },
          { text: 'Compatibility report', link: '/compat-report' },
          { text: 'Release manual', link: '/release' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhy0216/mad-dom' },
    ],
  },
}
